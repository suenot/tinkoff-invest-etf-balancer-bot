import 'dotenv/config';
import { provider } from './provider/index';
import { createSdk } from 'tinkoff-sdk-grpc-js';
import { listAccounts } from './utils';
import { configLoader } from './configLoader';
import debug from 'debug';
// import { balancer } from './balancer/index';
// import { DESIRED_WALLET } from './config';

const debugMain = debug('bot').extend('main');

const main = async () => {
  debugMain('main start');
  if (process.argv.includes('--list-accounts')) {
    // Получаем токен из конфигурации или используем основной токен
    let token: string | undefined;
    
    try {
      const accounts = configLoader.getAllAccounts();
      if (accounts.length > 0) {
        // Используем токен первого аккаунта
        token = configLoader.getAccountToken(accounts[0].id);
      }
    } catch (error) {
      debugMain('Error loading config, falling back to T_INVEST_TOKEN:', error);
    }
    
    // Fallback на основной токен из .env
    if (!token) {
      token = process.env.T_INVEST_TOKEN;
    }
    
    if (!token) {
      console.error('Error: No token found. Please set T_INVEST_TOKEN in .env or configure tokens in CONFIG.json');
      process.exit(1);
    }
    
    const { users } = createSdk(token);
    const accounts = await listAccounts(users);
    console.log('Available accounts:');
    for (const acc of accounts) {
      console.log(`#${acc.index}: id=${acc.id} type=${acc.type} name=${acc.name}`);
    }
    return;
  }
  const runOnce = process.argv.includes('--once');
  const accounts = configLoader.getAllAccounts();

  console.log(`🔄 Processing ${accounts.length} account(s)`);

  // Process each account
  for (const account of accounts) {
    console.log(`\n=== Processing Account: ${account.name} (${account.id}) ===`);
    // Pass account ID through environment variable for provider to use
    process.env.ACCOUNT_ID = account.id;
    await provider({ runOnce, accountId: account.id });
  }

  console.log('\n✅ All accounts processed successfully');
  // TODO: currently balancer is called from provider, not from main. Need to refactor.
  // debugMain('provider done');
  // await balancer((global as any).POSITIONS, DESIRED_WALLET);
};

main();
