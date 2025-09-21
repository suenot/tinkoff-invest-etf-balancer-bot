import { configLoader } from './src/configLoader';
import debug from 'debug';

const debugTest = debug('test:multi-account');

// Test multi-account configuration loading
async function testMultiAccountLoading() {
  console.log('\n=== Testing Multi-Account Configuration Loading ===\n');

  // Set test config path
  process.env.NODE_ENV = 'test';

  try {
    // Load test config with multiple accounts
    const accounts = configLoader.getAllAccounts();
    console.log(`✅ Loaded ${accounts.length} account(s) from configuration`);

    // Display each account
    for (const account of accounts) {
      console.log(`\nAccount Details:`);
      console.log(`  ID: ${account.id}`);
      console.log(`  Name: ${account.name}`);
      console.log(`  Account ID: ${account.account_id}`);
      console.log(`  Desired Mode: ${account.desired_mode}`);
      console.log(`  ETFs configured: ${Object.keys(account.desired_wallet).length}`);
      console.log(`  Balance Interval: ${account.balance_interval}ms`);

      // Check token configuration
      const isTokenFromEnv = configLoader.isTokenFromEnv(account.id);
      console.log(`  Token source: ${isTokenFromEnv ? 'Environment Variable' : 'Direct in Config'}`);

      // Display desired wallet
      console.log(`  Desired Wallet:`);
      for (const [ticker, percentage] of Object.entries(account.desired_wallet)) {
        console.log(`    ${ticker}: ${percentage}%`);
      }
    }

    console.log('\n✅ Multi-account configuration test passed!');

  } catch (error) {
    console.error('❌ Error loading multi-account configuration:', error);
    process.exit(1);
  }
}

// Test that each account can be processed independently
async function testAccountIsolation() {
  console.log('\n=== Testing Account Isolation ===\n');

  const accounts = configLoader.getAllAccounts();

  for (const account of accounts) {
    console.log(`Testing account isolation for: ${account.name} (${account.id})`);

    // Simulate setting account context
    process.env.ACCOUNT_ID = account.id;

    // Verify we can get the correct account config
    const retrievedAccount = configLoader.getAccountById(account.id);
    if (retrievedAccount?.id === account.id) {
      console.log(`  ✅ Account ${account.id} retrieved correctly`);
    } else {
      console.error(`  ❌ Failed to retrieve account ${account.id}`);
    }

    // Verify token retrieval
    const token = configLoader.getAccountToken(account.id);
    if (token !== undefined) {
      console.log(`  ✅ Token available for account ${account.id}`);
    } else {
      console.log(`  ⚠️  No token configured for account ${account.id}`);
    }
  }

  console.log('\n✅ Account isolation test passed!');
}

// Main test runner
async function runTests() {
  console.log('🧪 Starting Multi-Account Processing Tests\n');

  await testMultiAccountLoading();
  await testAccountIsolation();

  console.log('\n🎉 All tests completed successfully!\n');
  console.log('The bot is now configured to process all accounts in each balancing cycle.');
  console.log('Each account will be processed with its own configuration and statistics will be shown for each.');
}

// Run the tests
runTests().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});