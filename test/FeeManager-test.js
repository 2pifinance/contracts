const { createPiToken, deploy, waitFor, MAX_UINT } = require('./helpers')

describe('FeeManager setup', () => {
  let piToken
  let piVault

  beforeEach(async () => {
    let now = (await hre.ethers.provider.getBlock()).timestamp
    let tomorrow = now + 86400

    piToken = await createPiToken()
    piVault = await deploy('PiVault', piToken.address, tomorrow, tomorrow)
  })

  describe('Deploy', async () => {
    it('should be reverted for not piToken', async () => {
      await expect(
        deploy('FeeManager', owner.address, piVault.address, global.exchange.address)
      ).to.be.revertedWith(
        'Not PiToken vault'
      )
    })
  })
})

describe('FeeManager', () => {
  let tomorrow
  let nextWeek
  let piVault
  let piToken
  let feeMgr
  let bob

  before(async () => {
    [, bob] = await ethers.getSigners()
    piToken = global.PiToken
  })

  beforeEach(async () => {
    let now = (await hre.ethers.provider.getBlock()).timestamp
    tomorrow = now + 86400
    nextWeek = now + (86400 * 7)

    piVault = await deploy('PiVault', piToken.address, tomorrow, nextWeek)
    feeMgr = await deploy('FeeManager', owner.address, piVault.address, global.exchange.address)
  })

  describe('harvest', async () => {
    it('should be reverted for not harvest user', async () => {
      await expect(feeMgr.connect(bob).harvest(WMATIC.address, 0)).to.be.revertedWith('Only harvest role')
    })

    it('should execute harvest and send to vault', async () => {
      // This is because harvest need balance to swap
      await waitFor(WMATIC.deposit({ value: 1 }))
      await waitFor(WMATIC.transfer(feeMgr.address, 1))

      expect(await piToken.balanceOf(piVault.address)).to.be.equal(0)

      await waitFor(piToken.transfer(feeMgr.address, 100))
      await waitFor(feeMgr.harvest(WMATIC.address, 0))

      const max = await feeMgr.MAX()
      const amount = max.sub(await feeMgr.TREASURY_PART())

      expect(amount).to.be.above(1)
      expect(await piToken.balanceOf(piVault.address)).to.be.equal(
        amount.mul(100).div(max)
      )
    })

    it('should execute harvest and send to vault with non-wNative', async () => {
      // This is because harvest need balance to swap
      const otherW = await deploy('WETHMock')

      await waitFor(otherW.deposit({ value: 100 }))
      await waitFor(otherW.transfer(feeMgr.address, 100))

      expect(await piToken.balanceOf(piVault.address)).to.be.equal(0)

      await waitFor(piToken.transfer(exchange.address, 100))
      await waitFor(feeMgr.harvest(otherW.address, 1e9))

      const max = await feeMgr.MAX()
      const amount = max.sub(await feeMgr.TREASURY_PART())

      expect(amount).to.be.above(1)
      expect(await piToken.balanceOf(piVault.address)).to.be.equal(
        amount.mul(100).div(max)
      )
    })

    it('should do nothing without balance', async () => {
      const balance = await piToken.balanceOf(owner.address)
      await waitFor(feeMgr.harvest(WMATIC.address, 0))

      expect(await piToken.balanceOf(owner.address)).to.be.equal(balance)
    })

    it('should exchange for other token', async () => {
      // This is because harvest need balance to swap
      await waitFor(piToken.transfer(exchange.address, 100))
      expect(await piToken.balanceOf(piVault.address)).to.be.equal(0)

      await waitFor(WMATIC.deposit({ value: 100 }))
      await waitFor(WMATIC.transfer(feeMgr.address, 100))
      await waitFor(feeMgr.harvest(WMATIC.address, 1e9)) // 1-1 ratio

      const max = await feeMgr.MAX()
      const amount = max.sub(await feeMgr.TREASURY_PART())

      expect(amount).to.be.above(1)
      expect(await piToken.balanceOf(piVault.address)).to.be.equal(
        amount.mul(100).div(max)
      )
    })
  })

  describe('setTreasury', async () => {
    it('should revert for non-admin', async () => {
      await expect(feeMgr.connect(bob).setTreasury(owner.address)).to.be.revertedWith('Only Admin')
    })

    it('should change treasury', async () => {
      await expect(
        feeMgr.setTreasury(bob.address)
      ).to.emit(
        feeMgr, 'NewTreasury'
      ).withArgs(
        owner.address, bob.address
      )

      expect(await feeMgr.treasury()).to.be.equal(bob.address)
    })
  })

  describe('setExchange', async () => {
    it('should revert for non-admin', async () => {
      await expect(feeMgr.connect(bob).setExchange(bob.address)).to.be.revertedWith('Only Admin')
    })

    it('should change exchange', async () => {
      await expect(
        feeMgr.setExchange(bob.address)
      ).to.emit(
        feeMgr, 'NewExchange'
      ).withArgs(
        global.exchange.address, bob.address
      )

      expect(await feeMgr.exchange()).to.be.equal(bob.address)
    })
  })
})
