/* global process */
/* eslint no-console: 0 */
const hre = require('hardhat');
const fs = require('fs');
const SuperfluidSDK = require('@superfluid-finance/js-sdk');
const deployFramework = require('@superfluid-finance/ethereum-contracts/scripts/deploy-framework');

const { verify } = require('./verify');

const deploy = JSON.parse(
  fs.readFileSync('utils/mumbai_data.json', 'utf8')
)

const main = async function () {
  const contract = await (await hre.ethers.getContractFactory('PiToken')).deploy()
  await contract.deployed();
   const errorHandler = err => {
    if (err) throw err;
  };

  // await verify('PiToken', contract.address)
  await deployFramework(errorHandler, { web3: web3 });

  let sf = new SuperfluidSDK.Framework({ web3: web3, version: 'test' })
  await sf.initialize();

  const superTokenFactory = await sf.contracts.ISuperTokenFactory.at(
    await sf.host.getSuperTokenFactory.call()
  );

  await superTokenFactory.initializeCustomSuperToken(contract.address);

  await contract.init()

  deploy.PiToken = contract.address

  fs.writeFileSync('utils/deploy.json', JSON.stringify(deploy, undefined, 2))
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
