import { describe, it, expect } from 'bun:test';
import { ConfigLoader } from '../configLoader';
import { AccountConfig, ProjectConfig } from '../types.d';

describe('Confirmation Configuration Validation', () => {
  // Helper function to create basic valid account config
  const createBaseAccountConfig = (): AccountConfig => ({
    id: 'test_account',
    name: 'Test Account',
    t_invest_token: 'test_token',
    account_id: 'test_account_id',
    desired_wallet: { TGLD: 50, TRUR: 50 },
    desired_mode: 'manual',
    balance_interval: 3600000,
    sleep_between_orders: 3000,
    margin_trading: {
      enabled: false,
      multiplier: 2,
      free_threshold: 5000,
      max_margin_size: 5000,
      balancing_strategy: 'keep_if_small'
    },
    exchange_closure_behavior: {
      mode: 'dry_run',
      update_iteration_result: true
    }
  });

  describe('confirmationThresholdRub Validation', () => {
    it('should accept valid positive numbers', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 50000;

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should accept zero as threshold', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 0;

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should reject negative threshold values', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = -1000;

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('confirmationThresholdRub must be positive');
    });

    it('should reject non-numeric threshold values', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      (account as any).confirmationThresholdRub = 'invalid';

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('confirmationThresholdRub must be a number');
    });

    it('should reject infinite threshold values', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = Infinity;

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('confirmationThresholdRub must be a finite number');
    });

    it('should reject NaN threshold values', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = NaN;

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('confirmationThresholdRub must be a finite number');
    });
  });

  describe('Analysis Configuration Validation', () => {
    it('should accept valid analysis configuration with confirmation enabled', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: 'test-api-key'
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should accept valid analysis configuration with confirmation disabled', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: false
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should accept analysis configuration without confirmation setting', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          apiKey: 'test-api-key'
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should reject non-boolean confirmation setting', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: 'invalid' as any
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('requireConfirmationForLargeOrders must be a boolean');
    });

    it('should reject non-string API key', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: 12345 as any
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).toThrow('apiKey must be a string');
    });

    it('should accept empty analysis configuration', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {};

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });
  });

  describe('Configuration Consistency Warnings', () => {
    // Note: These tests would need to capture console.log output to verify warnings
    // For now, we test that no errors are thrown for these scenarios

    it('should not throw error when threshold is set but confirmation is disabled', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 50000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: false
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should not throw error when threshold is set but no analysis config exists', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 50000;
      // No analysis configuration

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should not throw error when confirmation is enabled but no threshold is set', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true
        }
      };
      // No confirmationThresholdRub

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });
  });

  describe('Complete Configuration Examples', () => {
    it('should validate complete configuration with confirmation enabled', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 50000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: 'sk-or-test-key-123456'
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should validate conservative configuration with low threshold', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 10000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should validate automated configuration with high threshold', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 1000000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: false
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });

    it('should validate configuration with environment variable API key pattern', () => {
      const configLoader = new (ConfigLoader as any)('test-config.json');
      const account = createBaseAccountConfig();
      account.confirmationThresholdRub = 50000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: '${OPENROUTER_API_KEY}'
        }
      };

      expect(() => {
        (configLoader as any).validateConfirmationConfiguration(account);
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should ensure AccountConfig includes confirmation fields', () => {
      const account: AccountConfig = createBaseAccountConfig();

      // These should be available due to optional fields in interface
      account.confirmationThresholdRub = 50000;
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: 'test-key'
        }
      };

      expect(account.confirmationThresholdRub).toBe(50000);
      expect(account.analysis.openrouter?.requireConfirmationForLargeOrders).toBe(true);
      expect(account.analysis.openrouter?.apiKey).toBe('test-key');
    });

    it('should work with minimal analysis configuration', () => {
      const account: AccountConfig = createBaseAccountConfig();
      account.analysis = {
        openrouter: {
          requireConfirmationForLargeOrders: true
        }
      };

      expect(account.analysis.openrouter?.requireConfirmationForLargeOrders).toBe(true);
      expect(account.analysis.openrouter?.apiKey).toBeUndefined();
    });

    it('should work without any confirmation configuration', () => {
      const account: AccountConfig = createBaseAccountConfig();

      expect(account.confirmationThresholdRub).toBeUndefined();
      expect(account.analysis).toBeUndefined();
    });
  });
});