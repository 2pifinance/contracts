const fs = require('fs')
const hre = require("hardhat");
const { verify } = require('./verify');

const deploy = JSON.parse(
  fs.readFileSync('utils/deploy.json', 'utf8')
)

async function main() {
  const owner = (await hre.ethers.getSigners())[0]
  const onlyCurrency = process.env.CURRENCY
  const pools = deploy.aavePools

  let pool
  const archimedes = await (
    await hre.ethers.getContractFactory('Archimedes')
  ).attach(deploy.Archimedes)

  let args

  for (pool of pools) {
    let ctrollerArgs = [
      pool.address, deploy.Archimedes, deploy.FeeManager
    ]
    let controller = await (
      await hre.ethers.getContractFactory('Controller')
    ).deploy(...ctrollerArgs);

    await controller.deployed();

    await verify('Controller', controller.address, ctrollerArgs)

    args = [
      pool.address,
      pool.rate, // rate
      pool.aave_rate_max, // rate max
      pool.depth, // depth
      pool.min_leverage, // min leverage
      controller.address,
      deploy.exchange,  // sushiswap Exchange
      deploy.FeeManager
    ]

    let strategy = await (
      await hre.ethers.getContractFactory('ControllerAaveStrat')
    ).deploy(...args);

    await strategy.deployed();

    console.log('Strategy ' + pool.currency + ':')

    await verify('ControllerAaveStrat', strategy.address, args)

    await (await controller.setStrategy(strategy.address)).wait()

    await (await archimedes.addNewPool(pool.address, controller.address, 5, false)).wait()

    let pid = await controller.pid()
    console.log(`Configured ${pool.currency} in ${pid}`)

    deploy[`strat-aave-${pool.currency}`] = {
      controller: controller.address,
      strategy:   strategy.address,
      pid:        pid.toBigInt().toString(),
      tokenAddr:  pool.address
    }
  }

  fs.writeFileSync('utils/deploy.json', JSON.stringify(deploy, undefined, 2))
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
