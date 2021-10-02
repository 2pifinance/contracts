/* global process */
/* eslint no-console: 0 */
const hre = require('hardhat');
const fs = require('fs');
const SuperfluidSDK = require('@superfluid-finance/js-sdk');
const deployFramework = require('@superfluid-finance/ethereum-contracts/scripts/deploy-framework');

const deploy = JSON.parse(
  fs.readFileSync('utils/mumbai_data.json', 'utf8')
)

const main = async function () {
  const contract = await (await hre.ethers.getContractFactory('PiToken')).deploy()
  await contract.deployed();
   const errorHandler = err => {
    if (err) throw err;
  };

  await deployFramework(errorHandler, { web3: web3 });

  let sf = new SuperfluidSDK.Framework({ web3: web3, version: 'test' })
  await sf.initialize();

  const superTokenFactory = await sf.contracts.ISuperTokenFactory.at(
    await sf.host.getSuperTokenFactory.call()
  );

  await superTokenFactory.initializeCustomSuperToken(contract.address);

  await contract.init()
  await contract.initRewardsOn((await hre.ethers.provider.getBlock()).number + 1)
  let owner = (await ethers.getSigners())[0]
  await contract.addMinter(owner.address)

  console.log(`PITOKEN: ${contract.address}`)
  eth = await (await hre.ethers.getContractFactory('WETHMock')).deploy()
  stk = await (await hre.ethers.getContractFactory('PiVault')).deploy('0xF47b68068794A952467737871888c3F8d22a561b', 1632886585, 1632886585)
  pi_eth = await (await hre.ethers.getContractFactory('LP')).deploy(eth.address, '0xF47b68068794A952467737871888c3F8d22a561b')
  usdt_eth = await (await hre.ethers.getContractFactory('LP')).deploy(eth.address, eth.address)
  await pi_eth.setReserves(1, 35937)
  await usdt_eth.setReserves('42937595689571403195538', '123466218552959')

  console.log(`eth: ${eth.address}`)
  console.log(`stk: ${stk.address}`)
  console.log(`usdt_eth: ${usdt_eth.address}`)
  console.log(`pi_eth: ${pi_eth.address}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
