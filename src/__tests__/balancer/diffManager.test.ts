import { expect } from 'chai';
import { DiffManager } from '../../balancer/diffManager';
import { DesiredWallet } from '../../types.d';
import { promises as fs } from 'fs';
import path from 'path';

describe('DiffManager', () => {
  let diffManager: DiffManager;
  const testAccountId = 'test_account';
  const testDate = '2024-01-15';

  beforeEach(async () => {
    diffManager = DiffManager.getInstance();
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

  describe('loadDiffData', () => {
    it('should return null when no data exists', async () => {
      const data = await diffManager.loadDiffData(testAccountId, testDate);
      expect(data).to.be.null;
    });

    it('should load saved data from disk', async () => {
      const testData = {
        date: testDate,
        accountId: testAccountId,
        snapshots: {
          '00:00': { TGLD: 50, TMOS: 50 }
        }
      };

      await diffManager.saveDiffData(testAccountId, testData);
      const loadedData = await diffManager.loadDiffData(testAccountId, testDate);

      expect(loadedData).to.deep.equal(testData);
    });

    it('should use memory cache on second load', async () => {
      const testData = {
        date: testDate,
        accountId: testAccountId,
        snapshots: {
          '00:00': { TGLD: 50, TMOS: 50 }
        }
      };

      await diffManager.saveDiffData(testAccountId, testData);

      // First load from disk
      const firstLoad = await diffManager.loadDiffData(testAccountId, testDate);
      expect(firstLoad).to.deep.equal(testData);

      // Second load should come from memory cache (we can't directly test this,
      // but we can verify it returns the same data)
      const secondLoad = await diffManager.loadDiffData(testAccountId, testDate);
      expect(secondLoad).to.deep.equal(testData);
    });
  });

  describe('storeSnapshot', () => {
    it('should store iteration snapshot', async () => {
      const desiredWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 30,
        TRUR: 30
      };

      await diffManager.storeSnapshot(testAccountId, desiredWallet, 'iteration');

      const data = await diffManager.loadDiffData(testAccountId);
      expect(data).to.not.be.null;
      expect(data!.snapshots['iteration_1']).to.deep.equal(desiredWallet);
    });

    it('should increment iteration numbers', async () => {
      const wallet1: DesiredWallet = { TGLD: 40, TMOS: 60 };
      const wallet2: DesiredWallet = { TGLD: 45, TMOS: 55 };
      const wallet3: DesiredWallet = { TGLD: 50, TMOS: 50 };

      await diffManager.storeSnapshot(testAccountId, wallet1, 'iteration');
      await diffManager.storeSnapshot(testAccountId, wallet2, 'iteration');
      await diffManager.storeSnapshot(testAccountId, wallet3, 'iteration');

      const data = await diffManager.loadDiffData(testAccountId);
      expect(data!.snapshots['iteration_1']).to.deep.equal(wallet1);
      expect(data!.snapshots['iteration_2']).to.deep.equal(wallet2);
      expect(data!.snapshots['iteration_3']).to.deep.equal(wallet3);
    });

    it('should store day snapshot with timestamp', async () => {
      const desiredWallet: DesiredWallet = {
        TGLD: 40,
        TMOS: 30,
        TRUR: 30
      };

      await diffManager.storeSnapshot(testAccountId, desiredWallet, 'day');

      const data = await diffManager.loadDiffData(testAccountId);
      expect(data).to.not.be.null;
      // Should have at least one snapshot (could be "00:00" or a timestamp)
      expect(Object.keys(data!.snapshots).length).to.be.greaterThan(0);
    });
  });

  describe('getReferenceSnapshot', () => {
    it('should return null for off mode', async () => {
      const snapshot = await diffManager.getReferenceSnapshot(testAccountId, 'off');
      expect(snapshot).to.be.null;
    });

    it('should return null when no data exists', async () => {
      const snapshot = await diffManager.getReferenceSnapshot(testAccountId, 'iteration');
      expect(snapshot).to.be.null;
    });

    it('should return 00:00 snapshot for day mode', async () => {
      const testWallet: DesiredWallet = { TGLD: 50, TMOS: 50 };
      const testData = {
        date: new Date().toISOString().split('T')[0],
        accountId: testAccountId,
        snapshots: {
          '00:00': testWallet,
          'iteration_1': { TGLD: 45, TMOS: 55 }
        }
      };

      await diffManager.saveDiffData(testAccountId, testData);
      const snapshot = await diffManager.getReferenceSnapshot(testAccountId, 'day');

      expect(snapshot).to.deep.equal(testWallet);
    });

    it('should return latest iteration snapshot for iteration mode', async () => {
      const wallet1: DesiredWallet = { TGLD: 40, TMOS: 60 };
      const wallet2: DesiredWallet = { TGLD: 45, TMOS: 55 };
      const wallet3: DesiredWallet = { TGLD: 50, TMOS: 50 };

      const testData = {
        date: new Date().toISOString().split('T')[0],
        accountId: testAccountId,
        snapshots: {
          'iteration_1': wallet1,
          'iteration_2': wallet2,
          'iteration_3': wallet3
        }
      };

      await diffManager.saveDiffData(testAccountId, testData);
      const snapshot = await diffManager.getReferenceSnapshot(testAccountId, 'iteration');

      expect(snapshot).to.deep.equal(wallet3);
    });
  });

  describe('cleanupOldData', () => {
    it('should delete old files', async () => {
      const oldDate = '2023-01-01';
      const recentDate = new Date().toISOString().split('T')[0];

      // Create an old file
      const oldData = {
        date: oldDate,
        accountId: testAccountId,
        snapshots: { '00:00': { TGLD: 50, TMOS: 50 } }
      };
      await diffManager.saveDiffData(testAccountId, oldData);

      // Create a recent file
      const recentData = {
        date: recentDate,
        accountId: 'recent_account',
        snapshots: { '00:00': { TGLD: 50, TMOS: 50 } }
      };
      await diffManager.saveDiffData('recent_account', recentData);

      // Clean up with 0 days to keep (should delete all old files)
      await diffManager.cleanupOldData(0);

      // Old file should be gone, recent file might still exist
      const oldDataLoaded = await diffManager.loadDiffData(testAccountId, oldDate);
      expect(oldDataLoaded).to.be.null;
    });
  });
});