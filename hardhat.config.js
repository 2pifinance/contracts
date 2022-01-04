require('@nomiclabs/hardhat-waffle')
require('@tenderly/hardhat-tenderly')
require('@nomiclabs/hardhat-etherscan')
require('@nomiclabs/hardhat-web3')
require('@nomiclabs/hardhat-truffle5')
require('solidity-coverage')
require('hardhat-gas-reporter')
require('hardhat-preprocessor')

const fs            = require('fs')
const accounts      = JSON.parse(fs.readFileSync('.accounts'))
const isIntegration = process.env.HARDHAT_INTEGRATION_TESTS

const hardhatNetwork = () => {
  if (isIntegration) {
    switch (parseInt(process.env.HARDHAT_INTEGRATION_CHAIN, 10)) {
      case 56:
        return {
          network_id: 56,
          chainId: 56,
          gasMultiplier: 5,
          forking:    {
            url:         `https://speedy-nodes-nyc.moralis.io/${process.env.MORALIS_API_KEY}/bsc/mainnet/archive`,
            // url:         `http://localhost:8545`,
            gasMultiplier: 5,
            blockNumber:  14051137
          }
        }

      default:
        return {
          network_id: 137,
          chainId: 137,
          gasMultiplier: 10,
          forking:    {
            url:         `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
            // url:         `http://localhost:8545`,
            gasMultiplier: 10,
            blockNumber: 19880876
          }
        }
    }
  }

  return { hardfork: 'berlin', network_id: 31337 }
}

const getStringReplacements = (hre) => {
  const chainId = hre.network.config.network_id

  if (chainId)
    return JSON.parse(
      fs.readFileSync(`./utils/addr_replacements.${chainId}.json`)
    )
}

let stringReplacements

const mochaSettings = JSON.parse(fs.readFileSync('.mocharc.json'))
const transformLine = (hre, line) => {
  let newLine = line

  if (hre.network.config.network_id) {
    stringReplacements = stringReplacements || getStringReplacements(hre)

    for (let [string, replacement] of Object.entries(stringReplacements)) {
      newLine = newLine.replace(string, replacement)
    }
  }

  return newLine
}

const preProcessSettings = {
  eachLine: hre => ({ transform: line => transformLine(hre, line) })
}

if (isIntegration) {
  mochaSettings.timeout = 300000 // 5 minutes
}

module.exports = {
  etherscan: {
    apiKey: process.env.POLYGON_API_KEY
  },
  tenderly: {
    project:  process.env.TENDERLY_PROJECT,
    username: process.env.TENDERLY_USER
  },
  solidity: {
    compilers: [
      {
        version:  '0.8.9',
        settings: {
          optimizer: {
            enabled: true,
            runs:    10000
          }
        },
      },
      {
        version:  '0.6.6',
        settings: {
          optimizer: {
            enabled: true,
            runs:    10000
          }
        },
      }
    ],
    overrides: {
      "@uniswap/lib/contracts/libraries/Babylonian.sol": { version: "0.6.6" },
      "@uniswap/lib/contracts/libraries/BitMath.sol": { version: "0.6.6" },
      "@uniswap/lib/contracts/libraries/FixedPoint.sol": { version: "0.6.6" },
      "@uniswap/lib/contracts/libraries/FullMath.sol": { version: "0.6.6" },
    }
  },
  networks: {
    hardhat: hardhatNetwork(),
    polygon: {
      url:      'https://polygon-rpc.com',
      accounts: accounts,
      network_id: 137,
    },
    mumbai: {
      url:        'https://rpc-mumbai.maticvigil.com',
      accounts:   accounts,
      network_id: 80001,
    },
    kovan: {
      url:      process.env.KOVAN_URL || '',
      accounts: accounts
    },
    rinkeby: {
      url:      process.env.RINKEBY_URL || '',
      accounts: accounts
    },
    arbrinkeby: {
      url:      'https://rinkeby.arbitrum.io/rpc',
      accounts: accounts
    },
    avax_test: {
      url:        'https://api.avax-test.network/ext/bc/C/rpc',
      network_id: 43113,
      chainId:    43113,
      accounts:   accounts,
      timeout:    60000
    },
    ganache: {
      url:        'http://localhost:8545',
      network_id: 137,
      accounts:   accounts
    }
  },
  gasReporter: {
    enabled:       !!process.env.REPORT_GAS,
    currency:      'USD',
    coinmarketcap: 'dd4b2cc6-a407-42a0-bc5d-ef6fc5a5a813',
    gasPrice:      1 // to compare between tests
  },
  paths: {
    tests: isIntegration ? './test/integration' : './test/contracts'
  },
  mocha:      mochaSettings,
  preprocess: preProcessSettings
}
