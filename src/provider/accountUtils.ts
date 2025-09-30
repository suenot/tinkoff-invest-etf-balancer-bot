import debug from 'debug';
import _ from 'lodash';
import { configLoader } from '../configLoader';

const debugProvider = debug('bot').extend('provider');

// Helper function to get account config by ID
export const getAccountConfigById = (accountId: string) => {
  const account = configLoader.getAccountById(accountId);
  if (!account) {
    throw new Error(`Account with id '${accountId}' not found in CONFIG.json`);
  }
  return account;
};

export const getAccountId = async (type: any, users?: any) => {
  // Поддержка индекса: '3' или 'INDEX:3'
  const indexMatch = typeof type === 'string' && type.startsWith('INDEX:')
    ? Number(type.split(':')[1])
    : (typeof type === 'string' && /^\d+$/.test(type) ? Number(type) : null);

  // If specific string id was passed, return as is
  if (indexMatch === null && type !== 'ISS' && type !== 'BROKER') {
    debugProvider('Passed ACCOUNT_ID (as string id)', type);
    return type;
  }

  debugProvider('Getting accounts list');
  let accountsResponse: any;
  try {
    accountsResponse = await users.getAccounts({});
  } catch (err) {
    debugProvider('Error getting accounts list');
    debugProvider(err);
  }
  debugProvider('accountsResponse', accountsResponse);

  // Support different response formats: { accounts: [...] } or direct array
  const accounts: any[] = Array.isArray(accountsResponse)
    ? accountsResponse
    : (accountsResponse?.accounts || []);

  // Selection by index
  if (indexMatch !== null) {
    const byIndex = accounts[indexMatch];
    const byIndexId = byIndex?.id || byIndex?.accountId || byIndex?.account_id;
    debugProvider('Selected account by index', byIndex);
    if (!byIndexId) {
      throw new Error(`Could not determine ACCOUNT_ID by index ${indexMatch}.`);
    }
    return byIndexId;
  }

  // Selection by type
  if (type === 'ISS' || type === 'BROKER') {
    // 1 — brokerage, 2 — IIS (by API v2 enum)
    const desiredType = type === 'ISS' ? 2 : 1;
    const account = _.find(accounts, { type: desiredType });
    debugProvider('Found account by type', account);
    const accountId = account?.id || account?.accountId || account?.account_id;
    if (!accountId) {
      throw new Error('Could not determine ACCOUNT_ID by type. Check token access to the required account.');
    }
    return accountId;
  }

  // Fallback: return as is
  debugProvider('Passed ACCOUNT_ID (as string id fallback)', type);
  return type;
};