import { promises as fs } from 'fs';
import path from 'path';
import { DiffData, DesiredWallet, DiffMode } from '../types.d';

const debug = require('debug')('bot').extend('diffManager');

export class DiffManager {
  private static instance: DiffManager;
  private diffDataDir: string;
  private memoryCache: Map<string, DiffData>;

  private constructor() {
    this.diffDataDir = path.resolve(process.cwd(), 'diff_data');
    this.memoryCache = new Map();
  }

  public static getInstance(): DiffManager {
    if (!DiffManager.instance) {
      DiffManager.instance = new DiffManager();
    }
    return DiffManager.instance;
  }

  /**
   * Ensures the diff_data directory exists
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.diffDataDir, { recursive: true });
      debug(`Ensured diff_data directory exists at: ${this.diffDataDir}`);
    } catch (error) {
      debug(`Error creating diff_data directory: ${error}`);
      throw error;
    }
  }

  /**
   * Gets the current date in YYYY-MM-DD format
   */
  private getCurrentDate(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Gets the current time in HH:mm:ss format
   */
  private getCurrentTime(): string {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
  }

  /**
   * Generates a cache key for memory storage
   */
  private getCacheKey(accountId: string, date: string): string {
    return `${accountId}_${date}`;
  }

  /**
   * Generates a file path for disk storage
   */
  private getFilePath(accountId: string, date: string): string {
    return path.join(this.diffDataDir, `${accountId}_${date}.json`);
  }

  /**
   * Loads diff data from disk or memory
   */
  public async loadDiffData(accountId: string, date?: string): Promise<DiffData | null> {
    const targetDate = date || this.getCurrentDate();
    const cacheKey = this.getCacheKey(accountId, targetDate);

    // Check memory cache first
    if (this.memoryCache.has(cacheKey)) {
      debug(`Loaded diff data from memory cache for ${accountId} on ${targetDate}`);
      return this.memoryCache.get(cacheKey)!;
    }

    // Try to load from disk
    const filePath = this.getFilePath(accountId, targetDate);
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const diffData = JSON.parse(fileContent) as DiffData;

      // Store in memory cache
      this.memoryCache.set(cacheKey, diffData);

      debug(`Loaded diff data from disk for ${accountId} on ${targetDate}`);
      return diffData;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        debug(`No diff data file found for ${accountId} on ${targetDate}`);
        return null;
      }
      debug(`Error loading diff data: ${error}`);
      throw error;
    }
  }

  /**
   * Saves diff data to disk and memory
   */
  public async saveDiffData(accountId: string, diffData: DiffData): Promise<void> {
    await this.ensureDirectory();

    const cacheKey = this.getCacheKey(accountId, diffData.date);
    const filePath = this.getFilePath(accountId, diffData.date);

    // Save to memory cache
    this.memoryCache.set(cacheKey, diffData);

    // Save to disk
    try {
      const jsonContent = JSON.stringify(diffData, null, 2);
      await fs.writeFile(filePath, jsonContent, 'utf-8');
      debug(`Saved diff data for ${accountId} on ${diffData.date}`);
    } catch (error) {
      debug(`Error saving diff data: ${error}`);
      throw error;
    }
  }

  /**
   * Stores a snapshot of the desired wallet
   */
  public async storeSnapshot(
    accountId: string,
    desiredWallet: DesiredWallet,
    snapshotType: 'iteration' | 'day'
  ): Promise<void> {
    const currentDate = this.getCurrentDate();
    const currentTime = this.getCurrentTime();

    // Load existing data or create new
    let diffData = await this.loadDiffData(accountId, currentDate);
    if (!diffData) {
      diffData = {
        date: currentDate,
        accountId,
        snapshots: {}
      };
    }

    // Determine snapshot key
    let snapshotKey: string;
    if (snapshotType === 'day' && currentTime.startsWith('00:0')) {
      // If it's close to midnight (00:00-00:09), store as "00:00"
      snapshotKey = '00:00';
    } else if (snapshotType === 'iteration') {
      // Find the next iteration number
      const iterationKeys = Object.keys(diffData.snapshots)
        .filter(key => key.startsWith('iteration_'))
        .map(key => parseInt(key.replace('iteration_', ''), 10))
        .filter(num => !isNaN(num));

      const nextIteration = iterationKeys.length > 0
        ? Math.max(...iterationKeys) + 1
        : 1;

      snapshotKey = `iteration_${nextIteration}`;
    } else {
      // For day mode but not at midnight, store with timestamp
      snapshotKey = currentTime;
    }

    // Store the snapshot
    diffData.snapshots[snapshotKey] = desiredWallet;

    // Save updated data
    await this.saveDiffData(accountId, diffData);
    debug(`Stored ${snapshotType} snapshot for ${accountId} at ${snapshotKey}`);
  }

  /**
   * Gets the reference snapshot for diff calculation
   */
  public async getReferenceSnapshot(
    accountId: string,
    diffMode: DiffMode
  ): Promise<DesiredWallet | null> {
    if (diffMode === 'off') {
      return null;
    }

    const currentDate = this.getCurrentDate();
    const diffData = await this.loadDiffData(accountId, currentDate);

    if (!diffData) {
      debug(`No diff data available for ${accountId} on ${currentDate}`);
      return null;
    }

    if (diffMode === 'day') {
      // Look for 00:00 snapshot
      if (diffData.snapshots['00:00']) {
        debug(`Found 00:00 snapshot for ${accountId}`);
        return diffData.snapshots['00:00'];
      }
      debug(`No 00:00 snapshot found for ${accountId}`);
      return null;
    } else if (diffMode === 'iteration') {
      // Find the latest iteration snapshot
      const iterationKeys = Object.keys(diffData.snapshots)
        .filter(key => key.startsWith('iteration_'))
        .map(key => ({
          key,
          num: parseInt(key.replace('iteration_', ''), 10)
        }))
        .filter(item => !isNaN(item.num))
        .sort((a, b) => b.num - a.num);

      if (iterationKeys.length > 0) {
        const latestKey = iterationKeys[0].key;
        debug(`Found latest iteration snapshot for ${accountId}: ${latestKey}`);
        return diffData.snapshots[latestKey];
      }

      debug(`No iteration snapshots found for ${accountId}`);
      return null;
    }

    return null;
  }

  /**
   * Cleans up old diff data files (optional, for maintenance)
   */
  public async cleanupOldData(daysToKeep: number = 7): Promise<void> {
    await this.ensureDirectory();

    const now = new Date();
    const cutoffTime = now.getTime() - (daysToKeep * 24 * 60 * 60 * 1000);

    try {
      const files = await fs.readdir(this.diffDataDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.diffDataDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          debug(`Deleted old diff data file: ${file}`);
        }
      }
    } catch (error) {
      debug(`Error during cleanup: ${error}`);
    }
  }
}

// Export singleton instance
export const diffManager = DiffManager.getInstance();