import { expect } from 'chai';
import { calculateDiffAdjustedWallet } from '../../balancer/diffCalculator';
import { diffManager } from '../../balancer/diffManager';
import { AccountConfig, DesiredWallet } from '../../types.d';
import { promises as fs } from 'fs';
import path from 'path';

describe('DiffCalculator', () => {
  const testAccountConfig: AccountConfig = {
    id: 'test_account',
    name: 'Test Account',
    t_invest_token: 'test_token',
    account_id: 'test_acc_id',
    desired_wallet: {
      TGLD: 33.33,
      TMOS: 33.33,
      TRUR: 33.34
    },
    desired_mode: 'manual',
    balance_interval: 3600,
    sleep_between_orders: 1000,
    margin_trading: {
      enabled: false,
      multiplier: 1,
      free_threshold: 1000,
      max_margin_size: 5000,
      balancing_strategy: 'keep'
    },
    exchange_closure_behavior: {
      mode: 'skip_iteration',
      update_iteration_result: false
    },
    diff: 'off',
    diff_multiplier: 0
  };

  beforeEach(async () => {
    // Clean up any existing test data
    const diffDataDir = path.resolve(process.cwd(), 'diff_data');
    try {
      await fs.rm(diffDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore error if directory doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test data after each test
    const diffDataDir = path.resolve(process.cwd(), 'diff_data');
    try {
      await fs.rm(diffDataDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore error if directory doesn't exist
    }
  });

  describe('calculateDiffAdjustedWallet', () => {
    it('should return base wallet when diff is off', async () => {
      const baseWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 30,
        TRUR: 30
      };

      const config = { ...testAccountConfig, diff: 'off' as const };
      const result = await calculateDiffAdjustedWallet(config, baseWallet);

      expect(result.adjustedWallet).to.deep.equal(baseWallet);
      expect(result.diffPercentages).to.deep.equal({});
      expect(result.referenceWallet).to.be.null;
      expect(result.appliedMultiplier).to.equal(0);
    });

    it('should use current as baseline when no reference exists', async () => {
      const baseWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 30,
        TRUR: 30
      };

      const config = {
        ...testAccountConfig,
        diff: 'iteration' as const,
        diff_multiplier: 50
      };

      const result = await calculateDiffAdjustedWallet(config, baseWallet);

      // Should return base wallet as no reference exists
      expect(result.adjustedWallet).to.deep.equal(baseWallet);
      expect(result.referenceWallet).to.be.null;
      expect(result.appliedMultiplier).to.equal(0);

      // Verify that snapshot was stored
      const storedSnapshot = await diffManager.getReferenceSnapshot(config.id, 'iteration');
      expect(storedSnapshot).to.deep.equal(baseWallet);
    });

    it('should calculate and apply diff for iteration mode', async () => {
      const referenceWallet: DesiredWallet = {
        TGLD: 50,
        TMOS: 30,
        TRUR: 20
      };

      const currentWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 35,
        TRUR: 25
      };

      const config = {
        ...testAccountConfig,
        diff: 'iteration' as const,
        diff_multiplier: 50  // 50% influence
      };

      // Store reference snapshot
      await diffManager.storeSnapshot(config.id, referenceWallet, 'iteration');

      // Calculate adjusted wallet
      const result = await calculateDiffAdjustedWallet(config, currentWallet);

      // The diff percentages should be calculated
      expect(result.diffPercentages).to.have.property('TGLD');
      expect(result.diffPercentages).to.have.property('TMOS');
      expect(result.diffPercentages).to.have.property('TRUR');

      // Reference wallet should be returned
      expect(result.referenceWallet).to.deep.equal(referenceWallet);

      // Multiplier should be applied
      expect(result.appliedMultiplier).to.equal(50);

      // Adjusted wallet should be normalized to sum to 100
      const totalWeight = Object.values(result.adjustedWallet).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).to.be.closeTo(100, 0.01);
    });

    it('should handle zero weights correctly', async () => {
      const referenceWallet: DesiredWallet = {
        TGLD: 100,
        TMOS: 0,
        TRUR: 0
      };

      const currentWallet: DesiredWallet = {
        TGLD: 33.33,
        TMOS: 33.33,
        TRUR: 33.34
      };

      const config = {
        ...testAccountConfig,
        diff: 'iteration' as const,
        diff_multiplier: 100
      };

      // Store reference snapshot
      await diffManager.storeSnapshot(config.id, referenceWallet, 'iteration');

      // Calculate adjusted wallet
      const result = await calculateDiffAdjustedWallet(config, currentWallet);

      // Should handle zero reference weights
      expect(result.diffPercentages.TMOS).to.equal(33.33);  // Absolute difference
      expect(result.diffPercentages.TRUR).to.equal(33.34);  // Absolute difference

      // Total should still be 100
      const totalWeight = Object.values(result.adjustedWallet).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).to.be.closeTo(100, 0.01);

      // No weight should be negative
      Object.values(result.adjustedWallet).forEach(weight => {
        expect(weight).to.be.at.least(0);
      });
    });

    it('should normalize weights to 100%', async () => {
      const referenceWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 40,
        TRUR: 20
      };

      const currentWallet: DesiredWallet = {
        TGLD: 50,
        TMOS: 50,
        TRUR: 50  // Sum is 150, not 100
      };

      const config = {
        ...testAccountConfig,
        diff: 'iteration' as const,
        diff_multiplier: 30
      };

      // Store reference snapshot
      await diffManager.storeSnapshot(config.id, referenceWallet, 'iteration');

      // Calculate adjusted wallet
      const result = await calculateDiffAdjustedWallet(config, currentWallet);

      // Total should be normalized to 100
      const totalWeight = Object.values(result.adjustedWallet).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).to.be.closeTo(100, 0.01);
    });

    it('should handle day mode with 00:00 snapshot', async () => {
      const midnightWallet: DesiredWallet = {
        TGLD: 45,
        TMOS: 30,
        TRUR: 25
      };

      const currentWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 35,
        TRUR: 25
      };

      const config = {
        ...testAccountConfig,
        diff: 'day' as const,
        diff_multiplier: 75
      };

      // Store 00:00 snapshot
      const currentDate = new Date().toISOString().split('T')[0];
      const diffData = {
        date: currentDate,
        accountId: config.id,
        snapshots: {
          '00:00': midnightWallet
        }
      };
      await diffManager.saveDiffData(config.id, diffData);

      // Calculate adjusted wallet
      const result = await calculateDiffAdjustedWallet(config, currentWallet);

      // Should use 00:00 snapshot as reference
      expect(result.referenceWallet).to.deep.equal(midnightWallet);
      expect(result.appliedMultiplier).to.equal(75);

      // Total should be 100
      const totalWeight = Object.values(result.adjustedWallet).reduce((sum, w) => sum + w, 0);
      expect(totalWeight).to.be.closeTo(100, 0.01);
    });

    it('should return current wallet when day mode has no 00:00 snapshot and API fails', async () => {
      const currentWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 35,
        TRUR: 25
      };

      const config = {
        ...testAccountConfig,
        diff: 'day' as const,
        diff_multiplier: 50
      };

      // Calculate without any stored snapshots (and API will return null in tests)
      const result = await calculateDiffAdjustedWallet(config, currentWallet);

      // Should return current wallet unchanged
      expect(result.adjustedWallet).to.deep.equal(currentWallet);
      expect(result.referenceWallet).to.be.null;
      expect(result.appliedMultiplier).to.equal(0);
    });
  });
});