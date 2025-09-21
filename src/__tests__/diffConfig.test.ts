import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ConfigLoader } from '../configLoader';
import { AccountConfig } from '../types.d';
import { promises as fs } from 'fs';
import path from 'path';

describe('Diff Configuration Validation', () => {
  let configLoader: ConfigLoader;
  let testConfigPath: string;

  beforeEach(async () => {
    // Create a temporary test config file
    testConfigPath = 'CONFIG.diff.test.json';
    ConfigLoader.resetInstance();
    configLoader = ConfigLoader.getInstance(testConfigPath);
  });

  afterEach(async () => {
    // Clean up test config file
    try {
      await fs.unlink(testConfigPath);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    ConfigLoader.resetInstance();
  });

  const createTestConfig = (accountOverrides: Partial<AccountConfig> = {}) => {
    return {
      accounts: [
        {
          id: 'test_account',
          name: 'Test Account',
          t_invest_token: 'test_token',
          account_id: 'test_acc_id',
          desired_wallet: {
            TGLD: 50,
            TMOS: 50
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
          ...accountOverrides
        }
      ]
    };
  };

  describe('Valid configurations', () => {
    it('should accept diff off mode', async () => {
      const config = createTestConfig({
        diff: 'off',
        diff_multiplier: 0
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff).toBe('off');
      expect(loadedConfig.accounts[0].diff_multiplier).toBe(0);
    });

    it('should accept diff iteration mode', async () => {
      const config = createTestConfig({
        diff: 'iteration',
        diff_multiplier: 50
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff).toBe('iteration');
      expect(loadedConfig.accounts[0].diff_multiplier).toBe(50);
    });

    it('should accept diff day mode', async () => {
      const config = createTestConfig({
        diff: 'day',
        diff_multiplier: 75
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff).toBe('day');
      expect(loadedConfig.accounts[0].diff_multiplier).toBe(75);
    });

    it('should set default values when diff fields are not provided', async () => {
      const config = createTestConfig({});  // No diff fields

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff).toBe('off');
      expect(loadedConfig.accounts[0].diff_multiplier).toBe(0);
    });

    it('should accept diff_multiplier of 0', async () => {
      const config = createTestConfig({
        diff: 'iteration',
        diff_multiplier: 0
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff_multiplier).toBe(0);
    });

    it('should accept diff_multiplier of 100', async () => {
      const config = createTestConfig({
        diff: 'day',
        diff_multiplier: 100
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));
      const loadedConfig = configLoader.loadConfig();

      expect(loadedConfig.accounts[0].diff_multiplier).toBe(100);
    });
  });

  describe('Invalid configurations', () => {
    it('should reject invalid diff mode', async () => {
      const config = createTestConfig({
        diff: 'invalid_mode' as any,
        diff_multiplier: 50
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));

      expect(() => configLoader.loadConfig()).toThrow(
        'diff must be one of: off, iteration, day'
      );
    });

    it('should reject negative diff_multiplier', async () => {
      const config = createTestConfig({
        diff: 'iteration',
        diff_multiplier: -10
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));

      expect(() => configLoader.loadConfig()).toThrow(
        'diff_multiplier must be between 0 and 100'
      );
    });

    it('should reject diff_multiplier greater than 100', async () => {
      const config = createTestConfig({
        diff: 'day',
        diff_multiplier: 150
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));

      expect(() => configLoader.loadConfig()).toThrow(
        'diff_multiplier must be between 0 and 100'
      );
    });

    it('should reject non-numeric diff_multiplier', async () => {
      const config = createTestConfig({
        diff: 'iteration',
        diff_multiplier: 'fifty' as any
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));

      expect(() => configLoader.loadConfig()).toThrow(
        'diff_multiplier must be a number'
      );
    });

    // Note: Infinity and NaN cannot be directly tested through JSON since JSON doesn't support them
    // They would cause JSON parse errors before reaching validation
  });

  describe('Warnings', () => {
    it('should warn when diff_multiplier is set but diff is off', async () => {
      const config = createTestConfig({
        diff: 'off',
        diff_multiplier: 50
      });

      await fs.writeFile(testConfigPath, JSON.stringify(config));

      // Capture console output
      const originalConsoleLog = console.log;
      let capturedOutput = '';
      console.log = (message: string) => {
        capturedOutput += message;
      };

      try {
        configLoader.loadConfig();
        expect(capturedOutput).toContain('Warning');
        expect(capturedOutput).toContain('diff_multiplier set to 50');
        expect(capturedOutput).toContain('but diff is \'off\'');
      } finally {
        console.log = originalConsoleLog;
      }
    });
  });
});