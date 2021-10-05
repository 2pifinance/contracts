// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
// import "hardhat/console.sol";

import "../interfaces/IPiToken.sol";
import "../interfaces/IUniswapRouter.sol";

interface IReferral {
    function recordReferral(address, address referrer) external;
    function referralPaid(address user, uint amount) external;
    function getReferrer(address user) external view returns (address);
}

interface IController {
    function strategy() external view returns (address);
    function totalSupply() external view returns (uint);
    function balance() external view returns (uint);
    function balanceOf(address _user) external view returns (uint);
    function decimals() external view returns (uint);
    function farm() external view returns (address);
    function deposit(address _depositor, uint _amount) external;
    function withdraw(address _depositor, uint _shares) external;
}

contract ArchimedesAPI is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeERC20 for IPiToken;

    address public handler;
    address public exchange;
    mapping(uint => address[]) public piTokenToWantRoute;

    // Info of each pool.
    struct PoolInfo {
        IERC20 want;             // Address of token contract.
        uint weighing;           // How much weighing assigned to this pool. PIes to distribute per block.
        uint lastRewardBlock;    // Last block number that PIes distribution occurs.
        uint accPiTokenPerShare; // Accumulated PIes per share, times SHARE_PRECISION. See below.
        address controller;      // Token controller
    }

    // IPiToken already have safe transfer from SuperToken
    IPiToken public piToken;
    bytes private constant txData = new bytes(0); // just to support SuperToken mint

    // Used to made multiplications and divitions over shares
    uint public constant SHARE_PRECISION = 1e18;

    // PI tokens created per block for community, 31.4M / 3 minted in 2 years
    uint public apiLeftToMint = 1.05e25;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Pool existence mapping to prevent duplication
    // mapping(IERC20 => uint) public poolExistence; // anti duplication?
    // Info of each user that stakes tokens.
    mapping(uint => mapping(address => uint)) public userPaidRewards;
    // Total weighing. Must be the sum of all pools weighing.
    uint public totalWeighing;
    // The block number when PI mining starts.
    uint public startBlock;

    // PiToken referral contract address.
    IReferral public referralMgr;
    // Referral commission rate in basis points.
    uint16 public referralCommissionRate = 10; // 1%
    // Max referral commission rate: 5%.
    uint16 public constant MAXIMUM_REFERRAL_COMMISSION_RATE = 50; // 5%
    uint16 public constant COMMISSION_RATE_PRECISION = 1000;

    event Deposit(uint indexed pid, address indexed user, uint amount);
    event Withdraw(uint indexed pid, address indexed user, uint amount);
    event EmergencyWithdraw(uint indexed pid, address indexed user, uint amount);

    constructor(IPiToken _piToken, uint _startBlock, address _handler) {
        require(address(_piToken) != address(0), "Pi address can't be zero address");
        require(_startBlock > blockNumber(), "StartBlock should be in the future");
        require(_handler != address(0), "Handler can't be zero address");

        piToken = _piToken;
        startBlock = _startBlock;
        handler = _handler;
    }

    modifier onlyHandler() {
        require(msg.sender == handler, "Only handler");
        _;
    }

    function setExchange(address _newExchange) external onlyOwner {
        exchange = _newExchange;
    }

    function setRoute(uint _pid, address[] memory _route) external onlyOwner {
        // Last address in path shoyuld be the same than pool.want
        require(_route[0] == address(piToken), "First token is not PiToken");
        require(_route[_route.length - 1] == address(poolInfo[_pid].want), "Last token is not want");

        piTokenToWantRoute[_pid] = _route;
    }

    function setHandler(address _newHandler) external onlyOwner {
        require(_newHandler != address(0), "Can't be 0 address");
        handler = _newHandler;
    }

    // Add a new want token to the pool. Can only be called by the owner.
    function addNewPool(IERC20 _want, address _ctroller, uint _weighing, bool _massUpdate) external onlyOwner {
        require(address(_want) != address(0), "Address zero not allowed");
        require(IController(_ctroller).farm() == address(this), "Not a farm controller");
        require(IController(_ctroller).strategy() != address(0), "Controller without strategy");

        // Update pools before a weighing change
        if (_massUpdate) {
            massUpdatePools();
        }

        uint lastRewardBlock = blockNumber() > startBlock ? blockNumber() : startBlock;

        totalWeighing += _weighing;

        poolInfo.push(PoolInfo({
            want: _want,
            weighing: _weighing,
            lastRewardBlock: lastRewardBlock,
            accPiTokenPerShare: 0,
            controller: _ctroller
        }));
    }

    // Update the given pool's PI allocation point and deposit fee. Can only be called by the owner.
    function changePoolWeighing(uint _pid, uint _weighing, bool _massUpdate) external onlyOwner {
        // Update pools before a weighing change
        if (_massUpdate) {
            massUpdatePools();
        } else {
            updatePool(_pid);
        }

        totalWeighing = (totalWeighing - poolInfo[_pid].weighing) + _weighing;
        poolInfo[_pid].weighing = _weighing;
    }

    // Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint _from, uint _to) internal pure returns (uint) {
        return _to - _from;
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        for (uint pid = 0; pid < poolInfo.length; ++pid) {
            updatePool(pid);
        }
    }

    // Mint api tokens for a given pool pid
    function updatePool(uint _pid) public {
        PoolInfo storage pool = poolInfo[_pid];

        // If same block as last update return
        if (blockNumber() <= pool.lastRewardBlock) { return; }
        // If community Mint is already finished
        if (apiLeftToMint <= 0) { return; }

        uint sharesTotal = controller(_pid).totalSupply();

        if (sharesTotal <= 0 || pool.weighing <= 0) {
            pool.lastRewardBlock = blockNumber();
            return;
        }

        uint multiplier = getMultiplier(pool.lastRewardBlock, blockNumber());
        uint piTokenReward = (multiplier * piTokenPerBlock() * pool.weighing) / totalWeighing;

        // No rewards =( update lastRewardBlock
        if (piTokenReward <= 0) {
            pool.lastRewardBlock = blockNumber();
            return;
        }

        // If the reward is greater than the left to mint
        if (piTokenReward > apiLeftToMint) {
            piTokenReward = apiLeftToMint;
        }

        apiLeftToMint -= piTokenReward;
        piToken.mint(address(this), piTokenReward, txData);

        pool.accPiTokenPerShare += (piTokenReward * SHARE_PRECISION) / sharesTotal;
        pool.lastRewardBlock = blockNumber();
    }

    // Deposit want token to Archimedes for PI allocation.
    function deposit(uint _pid, address _user, uint _amount, address _referrer) external nonReentrant onlyHandler {
        require(_amount > 0, "Insufficient deposit");

        // Update pool rewards
        updatePool(_pid);

        // Record referral if it's needed
        _recordReferral(_pid, _user, _referrer);

        uint _before = wantBalance(poolInfo[_pid].want);

        // Pay rewards
        calcPendingAndSwapRewards(_pid, _user);

        // Transfer from user => Archimedes
        // This is the only line that should transfer from msg.sender to Archimedes
        // And in case of swap rewards will be included in the deposit
        poolInfo[_pid].want.safeTransferFrom(msg.sender, address(this), _amount);

        uint _balance = wantBalance(poolInfo[_pid].want) - _before;

        // Deposit in the controller
        _depositInController(_pid, _user, _balance);
    }

    // Withdraw want token from Archimedes.
    function withdraw(uint _pid, address _user, uint _shares) external nonReentrant onlyHandler {
        require(_shares > 0, "0 shares");
        require(userShares(_pid, _user) >= _shares, "withdraw: not sufficient founds");

        updatePool(_pid);

        PoolInfo storage pool = poolInfo[_pid];

        uint _before = wantBalance(pool.want);

        // Pay rewards
        calcPendingAndSwapRewards(_pid, _user);

        // this should burn shares and control the amount
        controller(_pid).withdraw(_user, _shares);


        uint _wantBalance = wantBalance(pool.want) - _before;


        pool.want.safeTransfer(_user, _wantBalance);

        // This is to "save" like the new amount of shares was paid
        userPaidRewards[_pid][_user] = (userShares(_pid, _user) * pool.accPiTokenPerShare) / SHARE_PRECISION;

        emit Withdraw(_pid, _user, _shares);
    }

    // Claim rewards for a pool
    function harvest(uint _pid, address _user) public nonReentrant {
        if (userShares(_pid, _user) <= 0) {
            return;
        }

        updatePool(_pid);

        uint _before = wantBalance(poolInfo[_pid].want);

        calcPendingAndSwapRewards(_pid, _user);

        uint _balance = wantBalance(poolInfo[_pid].want) - _before;

        if (_balance > 0) {
            _depositInController(_pid, _user, _balance);
        }
    }

    function harvestAll(address _user) external {
        uint length = poolInfo.length;
        for (uint pid = 0; pid < length; ++pid) {
            harvest(pid, _user);
        }
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint _pid, address _user) external nonReentrant {
        require(msg.sender == _user || msg.sender == owner() || msg.sender == handler, "Not autorized");
        IERC20 want = poolInfo[_pid].want;

        userPaidRewards[_pid][_user] = 0;

        uint _shares = userShares(_pid, _user);

        uint _before = wantBalance(want);
        // this should burn shares and control the amount
        controller(_pid).withdraw(_user, _shares);

        uint _wantBalance = wantBalance(want) - _before;
        want.safeTransfer(_user, _wantBalance);

        emit EmergencyWithdraw(_pid, _user, _shares);
    }

    function wantBalance(IERC20 _want) internal view returns (uint) {
        return _want.balanceOf(address(this));
    }

    // Record referral in referralMgr contract if needed
    function _recordReferral(uint _pid, address _user, address _referrer) internal {
        // only if it's the first deposit
        if (userShares(_pid, _user) <= 0 && _referrer != address(0) &&
            _referrer != _user && address(referralMgr) != address(0)) {

            referralMgr.recordReferral(_user, _referrer);
        }
    }

    function _depositInController(uint _pid, address _user, uint _amount) internal {
        // Archimedes => controller transfer & deposit
        poolInfo[_pid].want.safeIncreaseAllowance(poolInfo[_pid].controller, _amount);
        controller(_pid).deposit(_user, _amount);

        // This is to "save" like the new amount of shares was paid
        userPaidRewards[_pid][_user] = (userShares(_pid, _user) * poolInfo[_pid].accPiTokenPerShare) / SHARE_PRECISION;

        emit Deposit(_pid, _user, _amount);
    }

    // Pay rewards
    function calcPendingAndSwapRewards(uint _pid, address _user) internal returns (uint pending) {
        uint _shares = userShares(_pid, _user);

        if (_shares > 0) {
            pending = ((_shares * poolInfo[_pid].accPiTokenPerShare) / SHARE_PRECISION) - paidRewards(_pid, _user);

            if (pending > 0) {
                swapForWant(_pid, pending);
                payReferralCommission(_pid, _user, pending);
            }
        }
    }

    // Safe piToken transfer function, just in case if rounding error causes pool to not have enough PI.
    function swapForWant(uint _pid, uint _amount) internal returns (uint swapped) {
        uint piTokenBal = piToken.balanceOf(address(this));

        // piToken.transfer is safe
        if (_amount > piTokenBal) { _amount = piTokenBal; }

        if (_amount > 0) {
            piToken.safeApprove(exchange, _amount);
            uint[] memory outAmounts = IUniswapRouter(exchange).swapExactTokensForTokens(
                _amount, 1, piTokenToWantRoute[_pid], address(this), block.timestamp + 60
            );

            // Only last amount is needed
            swapped = outAmounts[outAmounts.length - 1];
        }
    }

    // Update the referral contract address by the owner
    function setReferralAddress(IReferral _newReferral) external onlyOwner {
        referralMgr = _newReferral;
    }

    // Update referral commission rate by the owner
    function setReferralCommissionRate(uint16 _referralCommissionRate) external onlyOwner {
        require(_referralCommissionRate <= MAXIMUM_REFERRAL_COMMISSION_RATE, "setReferralCommissionRate: invalid referral commission rate basis points");
        referralCommissionRate = _referralCommissionRate;
    }

    // Pay referral commission to the referrer who referred this user.
    function payReferralCommission(uint _pid, address _user, uint _pending) internal {
        if (address(referralMgr) != address(0) && referralCommissionRate > 0) {
            address referrer = referralMgr.getReferrer(_user);

            uint commissionAmount = (_pending * referralCommissionRate) / COMMISSION_RATE_PRECISION;

            if (referrer != address(0) && commissionAmount > 0) {
                // Instead of mint to the user, we call mint, swap and transfer
                if (apiLeftToMint < commissionAmount) {
                    commissionAmount = apiLeftToMint;
                }

                if (commissionAmount > 0) {
                    apiLeftToMint -= commissionAmount;
                    piToken.mint(address(this), commissionAmount, txData);

                    uint _reward = swapForWant(_pid, commissionAmount);

                    poolInfo[_pid].want.safeTransfer(referrer, _reward);

                    referralMgr.referralPaid(referrer, commissionAmount); // sum paid
                }
            }
        }
    }

    // View functions
    function poolLength() external view returns (uint) {
        return poolInfo.length;
    }

    function userShares(uint _pid, address _user) internal view returns (uint) {
        return controller(_pid).balanceOf(_user);
    }

    function paidRewards(uint _pid, address _user) public view returns (uint) {
        return userPaidRewards[_pid][_user];
    }
    function controller(uint _pid) internal view returns (IController) {
        return IController(poolInfo[_pid].controller);
    }

    // old vault functions
    function getPricePerFullShare(uint _pid) external view returns (uint) {
        uint _totalSupply = controller(_pid).totalSupply();
        uint precision = 10 ** decimals(_pid);

        return _totalSupply <= 0 ? precision : ((controller(_pid).balance() * precision) / _totalSupply);
    }
    function decimals(uint _pid) public view returns (uint) {
        return controller(_pid).decimals();
    }
    function balance(uint _pid) external view returns (uint) {
        return controller(_pid).balance();
    }
    function balanceOf(uint _pid, address _user) external view returns (uint) {
        return controller(_pid).balanceOf(_user);
    }

    function piTokenPerBlock() public view returns (uint) {
        // Skip 1% of minting per block for Referrals
        return piToken.apiMintPerBlock() * 99 / 100;
    }

    // Only to be mocked
    function blockNumber() internal view virtual returns (uint) {
        return block.number;
    }

    // In case of stucketd 2Pi tokens after 2 years
    // check if any holder has pending tokens then call this fn
    // E.g. in case of a few EmergencyWithdraw the rewards will be stucked
    function redeemStuckedPiTokens() external onlyOwner {
        require(apiLeftToMint <= 0, "still minting");
        require(piToken.totalSupply() == piToken.MAX_SUPPLY(), "PiToken still minting");

        uint _balance = piToken.balanceOf(address(this));

        if (_balance > 0)
            piToken.transfer(owner(), _balance);
    }
}
