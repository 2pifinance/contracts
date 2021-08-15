const BigNumber = require('bignumber.js')

const MINT_DATA = [
  {
    community: 0.29074e18,
    expected:  (new BigNumber(1622333e18)),
    founders:  0.35844e18,
    investors: 0.71689e18,
    treasury:  0.11948e18,
    blocks:    1.25e6
  },
  {
    community: 0.58148e18,
    expected:  (new BigNumber(5.495e24)),
    founders:  0.35844e18,
    investors: 0.71689e18,
    treasury:  0.11948e18,
    blocks:    3.8e6
  },
  {
    community: 0.72685e18,
    expected:  (new BigNumber(1.6e25)),
    founders:  0.35844e18,
    investors: 0.71689e18,
    treasury:  0.11948e18,
    blocks:    1.2e7
  },
  {
    community: 1.24603e18,
    expected:  (new BigNumber(2.3e25)),
    founders:  0.35844e18,
    investors: 0.71689e18,
    treasury:  0.11948e18,
    blocks:    1.6e7
  },
  {
    community: 1.24603e18,
    expected:  (new BigNumber(3e25)),
    founders:  0.35844e18,
    investors: 0,
    treasury:  0,
    blocks:    2.1e7
  },
  {
    community: 1.81713e18,
    expected:  (new BigNumber(4.239e25)), // community + initial_supply
    founders:  0.35844e18,
    investors: 0,
    treasury:  0,
    blocks:    3.5e7
  }
]

module.exports = { MINT_DATA }
