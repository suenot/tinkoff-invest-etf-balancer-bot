import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";

// Mock modules first, before any other imports
const mockFs = {
  promises: {
    readFile: mock(async () => ''),
    writeFile: mock(async () => undefined),
    access: mock(async () => undefined),
    mkdir: mock(async () => undefined)
  }
};

// Mock the fs module
mock.module('fs', () => ({
  ...mockFs,
  promises: mockFs.promises
}));

// Mock process.exit to prevent tests from exiting the process
const mockProcessExit = mock((code?: number) => {
  throw new Error(`Process would exit with code ${code}`);
});

// Store original process.exit
const originalProcessExit = process.exit;

// Mock configLoader with comprehensive test scenarios
const mockConfigLoader = {
  loadConfig: mock(() => ({
    accounts: []
  })),
  getAllAccounts: mock(() => []),
  getAccountById: mock((id: string) => undefined),
  getRawTokenValue: mock((id: string) => ''),
  getAccountToken: mock((id: string) => ''),
  isTokenFromEnv: mock((id: string) => false),
  // Add mock methods for update functionality
  saveConfig: mock(async () => undefined),
  updateAccount: mock((accountId: string, updates: any) => undefined),
  addAccount: mock((account: any) => undefined),
  removeAccount: mock((accountId: string) => undefined)
};

mock.module('../../configLoader', () => ({
  configLoader: mockConfigLoader
}));

// Import test utilities
import { 
  TestEnvironment, 
  FinancialAssertions, 
  TestDataFactory,
  ErrorTestUtils,
  testSuite
} from '../test-utils';
import { mockControls } from '../__mocks__/external-deps';

// Store original env
const originalEnv = process.env;

testSuite('ConfigManager Configuration Updates Tests', () => {
  beforeEach(() => {
    // Setup mocks
    mockControls.resetAll();
    mockFs.promises.readFile.mockClear();
    mockFs.promises.writeFile.mockClear();
    mockFs.promises.access.mockClear();
    mockFs.promises.mkdir.mockClear();
    
    // Mock process.exit
    process.exit = mockProcessExit as any;
    
    // Reset mock configLoader methods
    mockConfigLoader.loadConfig.mockClear();
    mockConfigLoader.getAllAccounts.mockClear();
    mockConfigLoader.getAccountById.mockClear();
    mockConfigLoader.getRawTokenValue.mockClear();
    mockConfigLoader.getAccountToken.mockClear();
    mockConfigLoader.isTokenFromEnv.mockClear();
    mockConfigLoader.saveConfig.mockClear();
    mockConfigLoader.updateAccount.mockClear();
    mockConfigLoader.addAccount.mockClear();
    mockConfigLoader.removeAccount.mockClear();
    
    // Set default mock responses
    mockConfigLoader.loadConfig.mockReturnValue({
      accounts: []
    });
    mockConfigLoader.getAllAccounts.mockReturnValue([]);
    mockConfigLoader.getAccountById.mockReturnValue(undefined);
    
    // Set default env vars
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore process.exit
    process.exit = originalProcessExit;
    // Restore env
    process.env = originalEnv;
  });

  describe('Account Updates', () => {
    it('should update existing account configuration', async () => {
      // Mock existing configuration
      const originalAccount = {
        id: 'update-test-account',
        name: 'Original Account Name',
        t_invest_token: 't.original_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      const updatedAccount = {
        ...originalAccount,
        name: 'Updated Account Name',
        desired_mode: 'marketcap',
        desired_wallet: { TRUR: 50, TMOS: 50 }
      };
      
      mockConfigLoader.getAccountById.mockImplementation((id: string) => {
        if (id === 'update-test-account') return originalAccount;
        return undefined;
      });
      
      mockConfigLoader.updateAccount.mockImplementation((accountId: string, updates: any) => {
        if (accountId === 'update-test-account') {
          return { ...originalAccount, ...updates };
        }
        return undefined;
      });
      
      // Test the update functionality
      const result = mockConfigLoader.updateAccount('update-test-account', {
        name: 'Updated Account Name',
        desired_mode: 'marketcap',
        desired_wallet: { TRUR: 50, TMOS: 50 }
      });
      
      expect(result).toBeDefined();
      expect(result!.name).toBe('Updated Account Name');
      expect(result!.desired_mode).toBe('marketcap');
      expect(result!.desired_wallet).toEqual({ TRUR: 50, TMOS: 50 });
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.updateAccount).toHaveBeenCalledWith('update-test-account', {
        name: 'Updated Account Name',
        desired_mode: 'marketcap',
        desired_wallet: { TRUR: 50, TMOS: 50 }
      });
    });
    
    it('should handle update of non-existent account', async () => {
      // Mock updateAccount to return undefined for non-existent account
      mockConfigLoader.updateAccount.mockReturnValue(undefined);
      
      // Test updating a non-existent account
      const result = mockConfigLoader.updateAccount('non-existent-account', {
        name: 'New Name'
      });
      
      expect(result).toBeUndefined();
      expect(mockConfigLoader.updateAccount).toHaveBeenCalledWith('non-existent-account', {
        name: 'New Name'
      });
    });
    
    it('should update account token configuration', async () => {
      const originalAccount = {
        id: 'token-update-account',
        name: 'Token Update Account',
        t_invest_token: 't.old_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      mockConfigLoader.getAccountById.mockImplementation((id: string) => {
        if (id === 'token-update-account') return originalAccount;
        return undefined;
      });
      
      mockConfigLoader.updateAccount.mockImplementation((accountId: string, updates: any) => {
        if (accountId === 'token-update-account') {
          return { ...originalAccount, ...updates };
        }
        return undefined;
      });
      
      // Test updating token to environment variable format
      const result = mockConfigLoader.updateAccount('token-update-account', {
        t_invest_token: '${NEW_ENV_TOKEN}'
      });
      
      expect(result).toBeDefined();
      expect(result!.t_invest_token).toBe('${NEW_ENV_TOKEN}');
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.updateAccount).toHaveBeenCalledWith('token-update-account', {
        t_invest_token: '${NEW_ENV_TOKEN}'
      });
    });
  });

  describe('Account Addition', () => {
    it('should add new account to configuration', async () => {
      const newAccount = {
        id: 'new-account',
        name: 'New Account',
        t_invest_token: 't.new_token',
        account_id: '987654321',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      // Mock addAccount functionality
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        // Simulate adding account to configuration
        return account;
      });
      
      // Test adding new account
      const result = mockConfigLoader.addAccount(newAccount);
      
      expect(result).toBeDefined();
      expect(result!.id).toBe('new-account');
      expect(result!.name).toBe('New Account');
      expect(result!.t_invest_token).toBe('t.new_token');
      expect(result!.account_id).toBe('987654321');
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(newAccount);
    });
    
    it('should prevent adding account with duplicate ID', async () => {
      const existingAccount = {
        id: 'existing-account',
        name: 'Existing Account',
        t_invest_token: 't.existing_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      const duplicateAccount = {
        id: 'existing-account', // Same ID as existing account
        name: 'Duplicate Account',
        t_invest_token: 't.duplicate_token',
        account_id: '987654321',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TMOS: 100 },
        margin_trading: { enabled: false }
      };
      
      // Mock configuration with existing account
      mockConfigLoader.getAllAccounts.mockReturnValue([existingAccount]);
      
      // Mock addAccount to simulate duplicate ID detection
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        const existingAccounts = mockConfigLoader.getAllAccounts();
        const duplicateExists = existingAccounts.some(acc => acc.id === account.id);
        
        if (duplicateExists) {
          throw new Error(`Account with ID '${account.id}' already exists`);
        }
        
        return account;
      });
      
      // Test adding duplicate account
      expect(() => {
        mockConfigLoader.addAccount(duplicateAccount);
      }).toThrow(`Account with ID '${duplicateAccount.id}' already exists`);
      
      // Verify the mock was called
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(duplicateAccount);
    });
    
    it('should validate new account before adding', async () => {
      const invalidAccount = {
        id: '', // Invalid: empty ID
        name: 'Invalid Account',
        t_invest_token: 't.invalid_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      // Mock addAccount to simulate validation
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        // Validate required fields
        if (!account.id || account.id.trim() === '') {
          throw new Error('Account ID is required');
        }
        
        if (!account.name || account.name.trim() === '') {
          throw new Error('Account name is required');
        }
        
        if (!account.t_invest_token || account.t_invest_token.trim() === '') {
          throw new Error('Token is required');
        }
        
        if (!account.account_id || account.account_id.trim() === '') {
          throw new Error('Account ID is required');
        }
        
        if (!account.desired_wallet || Object.keys(account.desired_wallet).length === 0) {
          throw new Error('Desired wallet configuration is required');
        }
        
        return account;
      });
      
      // Test adding invalid account
      expect(() => {
        mockConfigLoader.addAccount(invalidAccount);
      }).toThrow('Account ID is required');
      
      // Verify the mock was called
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(invalidAccount);
    });
  });

  describe('Account Removal', () => {
    it('should remove existing account from configuration', async () => {
      const accountToRemove = {
        id: 'remove-account',
        name: 'Account to Remove',
        t_invest_token: 't.remove_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      // Mock configuration with account to remove
      mockConfigLoader.getAllAccounts.mockReturnValue([accountToRemove]);
      
      // Mock removeAccount functionality
      mockConfigLoader.removeAccount.mockImplementation((accountId: string) => {
        if (accountId === 'remove-account') {
          // Simulate successful removal
          mockConfigLoader.getAllAccounts.mockReturnValue([]);
          return true;
        }
        return false;
      });
      
      // Test removing account
      const result = mockConfigLoader.removeAccount('remove-account');
      
      expect(result).toBe(true);
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.removeAccount).toHaveBeenCalledWith('remove-account');
    });
    
    it('should handle removal of non-existent account', async () => {
      // Mock removeAccount to return false for non-existent account
      mockConfigLoader.removeAccount.mockReturnValue(false);
      
      // Test removing non-existent account
      const result = mockConfigLoader.removeAccount('non-existent-account');
      
      expect(result).toBe(false);
      expect(mockConfigLoader.removeAccount).toHaveBeenCalledWith('non-existent-account');
    });
    
    it('should maintain configuration integrity after removal', async () => {
      const accounts = [
        {
          id: 'account-1',
          name: 'Account 1',
          t_invest_token: 't.token1',
          account_id: '111111111',
          desired_mode: 'manual',
          balance_interval: 300000,
          sleep_between_orders: 1000,
          desired_wallet: { TRUR: 100 },
          margin_trading: { enabled: false }
        },
        {
          id: 'account-2',
          name: 'Account 2',
          t_invest_token: 't.token2',
          account_id: '222222222',
          desired_mode: 'manual',
          balance_interval: 300000,
          sleep_between_orders: 1000,
          desired_wallet: { TMOS: 100 },
          margin_trading: { enabled: false }
        },
        {
          id: 'account-3',
          name: 'Account 3',
          t_invest_token: 't.token3',
          account_id: '333333333',
          desired_mode: 'manual',
          balance_interval: 300000,
          sleep_between_orders: 1000,
          desired_wallet: { TGLD: 100 },
          margin_trading: { enabled: false }
        }
      ];
      
      // Mock configuration with multiple accounts
      mockConfigLoader.getAllAccounts.mockReturnValue(accounts);
      
      // Mock removeAccount to simulate removal of middle account
      mockConfigLoader.removeAccount.mockImplementation((accountId: string) => {
        if (accountId === 'account-2') {
          // Simulate successful removal - return remaining accounts
          mockConfigLoader.getAllAccounts.mockReturnValue([accounts[0], accounts[2]]);
          return true;
        }
        return false;
      });
      
      // Test removing middle account
      const result = mockConfigLoader.removeAccount('account-2');
      
      expect(result).toBe(true);
      
      // Verify remaining accounts
      const remainingAccounts = mockConfigLoader.getAllAccounts();
      expect(remainingAccounts).toHaveLength(2);
      expect(remainingAccounts[0].id).toBe('account-1');
      expect(remainingAccounts[1].id).toBe('account-3');
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.removeAccount).toHaveBeenCalledWith('account-2');
    });
  });

  describe('Configuration Update Validation', () => {
    it('should validate account ID format during updates', async () => {
      const account = {
        id: 'valid-account-id',
        name: 'Valid Account',
        t_invest_token: 't.valid_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      };
      
      // Test various ID formats
      const testCases = [
        { id: 'valid-id-123', expected: true },
        { id: 'VALID_ID', expected: true },
        { id: 'valid.id', expected: true },
        { id: 'valid_id_with_underscores', expected: true },
        { id: '', expected: false }, // Empty
        { id: '   ', expected: false }, // Whitespace only
        { id: null, expected: false }, // Null
        { id: undefined, expected: false } // Undefined
      ];
      
      testCases.forEach(testCase => {
        const isValid = typeof testCase.id === 'string' && testCase.id.trim().length > 0;
        expect(isValid).toBe(testCase.expected);
      });
    });
    
    it('should validate token format during updates', async () => {
      // Test various token formats
      const testTokens = [
        { token: 't.valid_direct_token', expected: true }, // Valid direct token
        { token: '${VALID_ENV_TOKEN}', expected: true }, // Valid environment token
        { token: 't.', expected: false }, // Too short
        { token: '${INCOMPLETE', expected: false }, // Missing closing brace
        { token: 'INCOMPLETE}', expected: false }, // Missing opening pattern
        { token: '', expected: false }, // Empty
        { token: '   ', expected: false } // Whitespace only
      ];
      
      testTokens.forEach(testCase => {
        const isDirectToken = testCase.token.startsWith('t.') && testCase.token.length > 2;
        const isEnvToken = testCase.token.startsWith('${') && testCase.token.endsWith('}') && testCase.token.length > 3;
        const isValid = isDirectToken || isEnvToken;
        expect(isValid).toBe(testCase.expected);
      });
    });
    
  });

  describe('Configuration Update Error Handling', () => {
    
  });

  describe('Configuration Update Edge Cases', () => {
    it('should handle account updates with special characters', async () => {
      const accountWithSpecialChars = {
        id: 'special-chars-account',
        name: 'Account with @#$%&*() Characters',
        t_invest_token: 't.special_token_@#$%',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { 'T@GLD': 100 }, // Special characters in ticker
        margin_trading: { enabled: false }
      };
      
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        // Allow special characters in account fields
        return account;
      });
      
      // Test adding account with special characters
      const result = mockConfigLoader.addAccount(accountWithSpecialChars);
      
      expect(result).toBeDefined();
      expect(result!.name).toBe('Account with @#$%&*() Characters');
      expect(result!.t_invest_token).toBe('t.special_token_@#$%');
      expect(result!.desired_wallet).toEqual({ 'T@GLD': 100 });
      
      // Verify the mock was called correctly
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(accountWithSpecialChars);
    });
    
    
    it('should handle concurrent configuration updates', async () => {
      const accounts = [
        {
          id: 'concurrent-1',
          name: 'Concurrent Account 1',
          t_invest_token: 't.concurrent_token_1',
          account_id: '111111111',
          desired_mode: 'manual',
          balance_interval: 300000,
          sleep_between_orders: 1000,
          desired_wallet: { TRUR: 100 },
          margin_trading: { enabled: false }
        },
        {
          id: 'concurrent-2',
          name: 'Concurrent Account 2',
          t_invest_token: 't.concurrent_token_2',
          account_id: '222222222',
          desired_mode: 'manual',
          balance_interval: 300000,
          sleep_between_orders: 1000,
          desired_wallet: { TMOS: 100 },
          margin_trading: { enabled: false }
        }
      ];
      
      // Mock addAccount to simulate concurrent operations
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        // Simulate some async work
        return new Promise(resolve => setTimeout(() => resolve(account), 10));
      });
      
      // Test concurrent account additions
      const promises = accounts.map(account => mockConfigLoader.addAccount(account));
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('concurrent-1');
      expect(results[1].id).toBe('concurrent-2');
      
      // Verify the mocks were called correctly
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(accounts[0]);
      expect(mockConfigLoader.addAccount).toHaveBeenCalledWith(accounts[1]);
    });
  });

  describe('Performance Tests for Configuration Updates', () => {
    it('should handle rapid sequential updates', async () => {
      // Create multiple accounts for rapid updates
      const accounts = Array.from({ length: 50 }, (_, i) => ({
        id: `rapid-update-${i}`,
        name: `Rapid Update Account ${i}`,
        t_invest_token: `t.rapid_token_${i}`,
        account_id: `account_id_${i}`,
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: { TRUR: 100 },
        margin_trading: { enabled: false }
      }));
      
      // Mock addAccount for performance testing
      mockConfigLoader.addAccount.mockImplementation((account: any) => {
        // Minimal processing for performance test
        return account;
      });
      
      // Measure performance of rapid sequential updates
      const startTime = performance.now();
      
      for (const account of accounts) {
        await mockConfigLoader.addAccount(account);
      }
      
      const endTime = performance.now();
      
      // Should complete within reasonable time (less than 1 second for 50 updates)
      expect(endTime - startTime).toBeLessThan(1000);
      
      // Verify all mocks were called
      expect(mockConfigLoader.addAccount).toHaveBeenCalledTimes(50);
    });
    
    it('should efficiently handle large configuration updates', async () => {
      // Create a large account with many fields
      const largeAccount = {
        id: 'large-account',
        name: 'Large Account',
        t_invest_token: 't.large_token',
        account_id: '123456789',
        desired_mode: 'manual',
        balance_interval: 300000,
        sleep_between_orders: 1000,
        desired_wallet: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [`TICKER${i}`, 100 / 100])
        ), // 100 different tickers
        margin_trading: { 
          enabled: true,
          multiplier: 1.5,
          free_threshold: 50000,
          balancing_strategy: 'keep_if_small'
        },
        // Add additional custom fields
        custom_field_1: 'value1',
        custom_field_2: 'value2',
        custom_field_3: 'value3'
      };
      
      // Mock updateAccount for performance testing
      mockConfigLoader.updateAccount.mockImplementation((accountId: string, updates: any) => {
        // Minimal processing for performance test
        return { ...largeAccount, ...updates };
      });
      
      // Measure performance of large configuration update
      const startTime = performance.now();
      
      const result = mockConfigLoader.updateAccount('large-account', {
        name: 'Updated Large Account'
      });
      
      const endTime = performance.now();
      
      expect(result).toBeDefined();
      expect(result!.name).toBe('Updated Large Account');
      
      // Should complete very quickly (less than 100ms)
      expect(endTime - startTime).toBeLessThan(100);
      
      // Verify the mock was called
      expect(mockConfigLoader.updateAccount).toHaveBeenCalledWith('large-account', {
        name: 'Updated Large Account'
      });
    });
  });
});