import 'dotenv/config';
import { createSdk } from 'tinkoff-sdk-grpc-js';
// import { createSdk } from '../provider/invest-nodejs-grpc-sdk/src/sdk';
import 'mocha';
import _ from 'lodash';
import uniqid from 'uniqid';
import debug from 'debug';
// import { OrderDirection, OrderType } from '../provider/invest-nodejs-grpc-sdk/src/sdk';
import { OrderDirection, OrderType } from 'tinkoff-sdk-grpc-js/dist/generated/orders';
import { configLoader } from '../configLoader';
import { Wallet, Position, BalancingDataError, OrderResult, OrderConfirmationRequest, OrderExecutionResult, OrderDetails } from '../types.d';
import { sleep, writeFile, convertNumberToTinkoffNumber, convertTinkoffNumberToNumber } from '../utils';
import { balancer } from '../balancer';
import { buildDesiredWalletByMode, buildDesiredWalletWithDiff } from '../balancer/desiredBuilder';
import { collectOnceForSymbols } from '../tools/pollEtfMetrics';
import { normalizeTicker } from '../utils';
import { expenseTracker, ExpenseRecord } from '../expenseTracker';
import { ProfitCalculator } from '../profitCalculator';
import { dailyAggregator } from '../dailyAggregator';

(global as any).INSTRUMENTS = [];
(global as any).POSITIONS = [];
(global as any).LAST_PRICES = [];

const debugProvider = debug('bot').extend('provider');

// Helper function to get account config by ID
const getAccountConfigById = (accountId: string) => {
  const account = configLoader.getAccountById(accountId);
  if (!account) {
    throw new Error(`Account with id '${accountId}' not found in CONFIG.json`);
  }
  return account;
};

/**
 * Filters out frozen (blocked) assets from the wallet
 * @param wallet - array of portfolio positions
 * @returns wallet with only available (non-frozen) assets
 */
const filterFrozenAssets = (wallet: Wallet): Wallet => {
  return wallet.filter(position => !position.blocked);
};

/**
 * Calculates the total value of available (non-frozen) assets
 * @param wallet - array of portfolio positions
 * @returns total value of available assets in RUB
 */
const calculateAvailablePortfolioValue = (wallet: Wallet): number => {
  const availableWallet = filterFrozenAssets(wallet);
  return _.sumBy(availableWallet, 'totalPriceNumber');
};

/**
 * Рассчитывает доли каждого инструмента в портфеле
 * @param wallet - массив позиций портфеля
 * @param includeBlocked - включать заблокированные позиции в расчет (по умолчанию false)
 * @returns объект с тикерами и их долями в процентах
 */
const calculatePortfolioShares = (wallet: Wallet, includeBlocked: boolean = false): Record<string, number> => {
  // Исключаем валюты (позиции где base === quote)
  let securities = wallet.filter(p => p.base !== p.quote);

  // Filter out frozen assets unless explicitly requested to include them
  if (!includeBlocked) {
    securities = filterFrozenAssets(securities);
  }

  const totalValue = _.sumBy(securities, 'totalPriceNumber');

  if (totalValue <= 0) return {};

  const shares: Record<string, number> = {};
  for (const position of securities) {
    if (position.base && position.totalPriceNumber) {
      const ticker = normalizeTicker(position.base) || position.base;
      shares[ticker] = (position.totalPriceNumber / totalValue) * 100;
    }
  }
  return shares;
};

let ACCOUNT_ID: string;

export const provider = async (options?: { runOnce?: boolean; accountId?: string }) => {
  // Get account config for current execution context
  const accountId = options?.accountId || process.env.ACCOUNT_ID || '0';
  const accountConfig = getAccountConfigById(accountId);

  debugProvider(`Processing account: ${accountConfig.name} (${accountConfig.id})`);

  // Get token for this specific account
  const token = configLoader.getAccountToken(accountConfig.id);
  const finalToken = token || process.env.T_INVEST_TOKEN;
  if (!finalToken) {
    throw new Error(`No token found for account ${accountConfig.id}. Please set token in CONFIG.json or T_INVEST_TOKEN in .env`);
  }

  // Create SDK with account-specific token
  const { orders, operations, marketData, users, instruments } = createSdk(finalToken);

  // Use account_id from account configuration
  ACCOUNT_ID = await getAccountId(accountConfig.account_id, users);
  await getInstruments(instruments, accountConfig);
  await getPositionsCycle(options, accountConfig, { orders, operations, marketData, instruments });
};

export const generateOrders = async (wallet: Wallet, accountConfig?: any, sdkObjects?: any) => {
  debugProvider('generateOrders');
  for (const position of wallet) {
    await generateOrder(position, accountConfig, sdkObjects);
  }
};

/**
 * Generates orders with sequential execution groups for buy_requires_total_marginal_sell feature
 * Ensures sell orders complete before non-margin buy orders are executed
 */
export const generateOrdersSequential = async (
  sellsFirst: Position[],
  buysNonMarginFirst: Position[],
  remainingOrders: Position[],
  accountConfig?: any,
  sdkObjects?: any
) => {
  debugProvider('generateOrdersSequential - executing in phases for buy_requires_total_marginal_sell');
  
  // Phase 1: Execute sell orders first and wait for completion
  if (sellsFirst.length > 0) {
    debugProvider(`🔄 PHASE 1: Executing ${sellsFirst.length} sell orders to raise funds`);
    for (const position of sellsFirst) {
      debugProvider(`💰 Executing sell order: ${Math.abs(position.toBuyLots || 0)} lots of ${position.base}`);
      await generateOrder(position, accountConfig, sdkObjects);
    }
    
    // Additional wait time for sell orders to complete and funds to become available
    debugProvider('⏳ Waiting for sell orders to complete and funds to be available...');
    await sleep(5000); // Wait 5 seconds for market orders to complete
  }
  
  // Phase 2: Execute non-margin buy orders (TMON etc.)
  if (buysNonMarginFirst.length > 0) {
    debugProvider(`🔄 PHASE 2: Executing ${buysNonMarginFirst.length} non-margin buy orders with raised funds`);
    for (const position of buysNonMarginFirst) {
      debugProvider(`💰 Executing non-margin buy order: ${Math.abs(position.toBuyLots || 0)} lots of ${position.base}`);
      await generateOrder(position, accountConfig, sdkObjects);
    }
  }
  
  // Phase 3: Execute remaining orders normally
  if (remainingOrders.length > 0) {
    debugProvider(`🔄 PHASE 3: Executing ${remainingOrders.length} remaining orders`);
    for (const position of remainingOrders) {
      await generateOrder(position, accountConfig, sdkObjects);
    }
  }
  
  debugProvider('✅ Sequential order execution completed');
};

export const generateOrder = async (position: Position, accountConfig?: any, sdkObjects?: any): Promise<OrderResult | number | boolean> => {
  debugProvider('generateOrder');
  debugProvider('position', position);

  if (position.base === 'RUB') {
    debugProvider('If position is RUB, do nothing');
    return false;
  }

  // Log order details
  debugProvider(`💰 About to place ${position.toBuyLots! > 0 ? 'BUY' : 'SELL'} order: ${Math.abs(position.toBuyLots || 0)} lots × ${position.lotPriceNumber || 0} = ${Math.abs((position.toBuyLots || 0) * (position.lotPriceNumber || 0)).toFixed(2)} RUB for ${position.base}`);

  debugProvider('Position is not currency');

  debugProvider('position.toBuyLots', position.toBuyLots);

  if (!position.toBuyLots || !isFinite(position.toBuyLots)) {
    debugProvider('toBuyLots is NaN/Infinity/undefined. Skipping position.');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'toBuyLots is NaN/Infinity/undefined'
    };
    return result;
  }

  if ((-1 < position.toBuyLots) && (position.toBuyLots < 1)) {
    debugProvider('Order less than 1 lot. Not worth executing.');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'Order less than 1 lot'
    };
    return result;
  }

  debugProvider('Position is greater than or equal to 1 lot');

  const direction = position.toBuyLots >= 1 ? OrderDirection.ORDER_DIRECTION_BUY : OrderDirection.ORDER_DIRECTION_SELL;
  debugProvider('direction', direction);

  // Calculate order value and check for confirmation requirements
  const quantityLots = Math.floor(Math.abs(position.toBuyLots || 0));
  const orderValueRub = quantityLots * (position.lotPriceNumber || 0);

  // Check if confirmation is required for large orders
  if (accountConfig?.analysis?.openrouter?.requireConfirmationForLargeOrders &&
      accountConfig?.confirmationThresholdRub !== undefined &&
      orderValueRub > accountConfig.confirmationThresholdRub) {

    debugProvider(`🔔 Order requires confirmation: ${orderValueRub.toFixed(2)} RUB > ${accountConfig.confirmationThresholdRub} RUB threshold`);

    // Create order details for confirmation request
    const orderDetails: OrderDetails = {
      ticker: position.base || '',
      quantity: quantityLots,
      direction: direction === OrderDirection.ORDER_DIRECTION_BUY ? 'BUY' : 'SELL',
      valueRub: orderValueRub,
      lotSize: position.lotSize || 1,
      pricePerLot: position.lotPriceNumber || 0,
      figi: position.figi || '',
      orderId: uniqid()
    };

    const confirmationRequest: OrderConfirmationRequest = {
      status: 'needs_confirmation',
      orderDetails,
      thresholdInfo: {
        configuredThreshold: accountConfig.confirmationThresholdRub,
        actualOrderValue: orderValueRub
      },
      timestamp: new Date().toISOString()
    };

    console.log(`\n🔔 CONFIRMATION REQUIRED for ${orderDetails.direction} order:`);
    console.log(`   Ticker: ${orderDetails.ticker}`);
    console.log(`   Quantity: ${orderDetails.quantity} lots`);
    console.log(`   Value: ${orderValueRub.toFixed(2)} RUB`);
    console.log(`   Threshold: ${accountConfig.confirmationThresholdRub} RUB`);
    console.log(`   Order ID: ${orderDetails.orderId}`);
    console.log(`   Awaiting human approval...`);

    return confirmationRequest;
  }

  // for (const i of _.range(position.toBuyLots)) {
  //   // Idea to create single-lot orders to ensure they always execute completely, not partially.
  //   // May have complications with:
  //   // - number of allowed API requests, then need to implement queue.
  //   // - minimum order may be more than one lot
  //   debugProvider(`Creating single-lot order #${i} of ${_.range(position.toBuyLots).length}`);
  //   const order = {
  //     accountId: ACCOUNT_ID,
  //     figi: position.figi,
  //     quantity: 1,
  //     // price: { units: 40, nano: 0 },
  //     direction,
  //     orderType: OrderType.ORDER_TYPE_MARKET,
  //     orderId: uniqid(),
  //   };
  //   debugProvider('Sending order', order);

  //   try {
  //     const setOrder = await orders.postOrder(order);
  //     debugProvider('Successfully placed order', setOrder);
  //   } catch (err) {
  //     debugProvider('Error placing order');
  //     debugProvider(err);
  //     console.trace(err);
  //   }
  //   await sleep(1000);
  // }

  // Continue with normal order execution
  debugProvider('position', position);

  debugProvider('Creating market order');

  if (quantityLots < 1) {
    debugProvider('Number of lots after rounding < 1. Skipping order.');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'Number of lots after rounding < 1'
    };
    return result;
  }

  if (!position.figi) {
    debugProvider('Position missing figi. Skipping order.');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'Position missing figi'
    };
    return result;
  }

  const order = {
    accountId: ACCOUNT_ID,
    figi: position.figi,
    quantity: quantityLots, // Number of lots must be integer
    // price: { units: 40, nano: 0 },
    direction,
    orderType: OrderType.ORDER_TYPE_MARKET,
    orderId: uniqid(),
  };
  debugProvider('Sending market order', order);

  const { orders } = sdkObjects || {};
  if (!orders) {
    debugProvider('orders SDK object not provided, skipping order');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'orders SDK object not provided'
    };
    return result;
  }

  try {
    const setOrder = await orders.postOrder(order);
    debugProvider('Successfully placed order', setOrder);

    // Track commission expense
    let commission = 0;
    if (setOrder) {
      // Calculate commission (standard Tinkoff commission is 0.3% for market orders)
      const orderAmount = quantityLots * (position.lotSize || 1) * (position.priceNumber || 0);
      commission = orderAmount * 0.003; // 0.3% commission

      const expenseRecord: ExpenseRecord = {
        orderId: order.orderId,
        ticker: position.base || '',
        orderType: direction === OrderDirection.ORDER_DIRECTION_BUY ? 'BUY' : 'SELL',
        lots: quantityLots,
        amountRub: orderAmount,
        commission: commission,
        timestamp: new Date()
      };

      expenseTracker.addExpense(expenseRecord);
      debugProvider(`Tracked commission: ${commission.toFixed(2)} RUB for ${position.base}`);
    }

    await sleep(accountConfig?.sleep_between_orders || 1000);

    const result: OrderExecutionResult = {
      status: 'executed',
      orderDetails: {
        ticker: position.base || '',
        quantity: quantityLots,
        direction: direction === OrderDirection.ORDER_DIRECTION_BUY ? 'BUY' : 'SELL',
        valueRub: orderValueRub,
        lotSize: position.lotSize || 1,
        pricePerLot: position.lotPriceNumber || 0,
        figi: position.figi || '',
        orderId: order.orderId
      },
      commission
    };
    return result;

  } catch (err) {
    debugProvider('Error placing order');
    debugProvider(err);
    // console.trace(err);

    await sleep(accountConfig?.sleep_between_orders || 1000);

    const result: OrderExecutionResult = {
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Unknown error placing order',
      orderDetails: {
        ticker: position.base || '',
        quantity: quantityLots,
        direction: direction === OrderDirection.ORDER_DIRECTION_BUY ? 'BUY' : 'SELL',
        valueRub: orderValueRub,
        lotSize: position.lotSize || 1,
        pricePerLot: position.lotPriceNumber || 0,
        figi: position.figi || '',
        orderId: order.orderId
      }
    };
    return result;
  }
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

export const getPositionsCycle = async (options?: { runOnce?: boolean }, accountConfig?: any, sdkObjects?: any) => {
  return await new Promise<void>((resolve) => {
    let count = 1;

    const tick = async () => {
      // Before starting iteration, check if exchange is open (MOEX) and handle according to configuration
      let isExchangeOpen = true;
      let exchangeClosureBehavior = accountConfig?.exchange_closure_behavior || { mode: 'skip_iteration', update_iteration_result: false };
      
      try {
        isExchangeOpen = await isExchangeOpenNow('MOEX', sdkObjects?.instruments);
        if (!isExchangeOpen) {
          debugProvider(`Exchange closed (MOEX). Behavior mode: ${exchangeClosureBehavior.mode}`);
          
          switch (exchangeClosureBehavior.mode) {
            case 'skip_iteration':
              debugProvider('Skipping balancing and waiting for next iteration.');
              if (options?.runOnce) {
                debugProvider('runOnce=true and exchange closed: finishing without balancing');
                resolve();
                return;
              }
              return; // just wait for next tick by interval
              
            case 'force_orders':
              debugProvider('Performing balancing and attempting to place orders despite exchange closure.');
              break;
              
            case 'dry_run':
              debugProvider('Performing balancing calculations without placing orders (dry-run mode).');
              break;
              
            default:
              debugProvider(`Unknown exchange closure mode: ${exchangeClosureBehavior.mode}. Defaulting to skip_iteration.`);
              if (options?.runOnce) {
                debugProvider('runOnce=true and exchange closed: finishing without balancing');
                resolve();
                return;
              }
              return;
          }
        }
      } catch (e) {
        debugProvider('Could not check trading schedule. Continuing by default.', e);
      }

      let portfolio: any;
      let positions: any;
      let portfolioPositions: any;

      try {
        debugProvider('Getting portfolio and positions simultaneously');
        // Минимизируем временной зазор между вызовами для предотвращения race condition
        const { operations } = sdkObjects || {};
        if (!operations) {
          throw new Error('operations SDK object not provided');
        }
        [portfolio, positions] = await Promise.all([
          operations.getPortfolio({ accountId: ACCOUNT_ID }),
          operations.getPositions({ accountId: ACCOUNT_ID })
        ]);
        
        portfolioPositions = portfolio.positions;
        debugProvider('portfolio', portfolio);
        debugProvider('positions', positions);
        debugProvider('portfolioPositions', portfolioPositions);
      } catch (err) {
        console.warn('Error getting portfolio/positions');
        debugProvider(err);
        console.trace(err);
      }

      const coreWallet: Wallet = [];

      debugProvider('Adding currencies to Wallet');
      for (const currency of positions.money) {
        const corePosition = {
          pair: `${currency.currency.toUpperCase()}/${currency.currency.toUpperCase()}`,
          base: currency.currency.toUpperCase(),
          quote: currency.currency.toUpperCase(),
          figi: undefined,
          amount: convertTinkoffNumberToNumber(currency),
          lotSize: 1,
          price: {
            units: 1,
            nano: 0,
          },
          priceNumber: 1,
          lotPrice: {
            units: 1,
            nano: 0,
          },
        };
        debugProvider('corePosition', corePosition);
        coreWallet.push(corePosition);
      }

      (global as any).POSITIONS = portfolioPositions;

      debugProvider('Adding positions to Wallet');
      for (const position of portfolioPositions) {
        debugProvider('position', position);

        const instrument = _.find((global as any).INSTRUMENTS,  { figi: position.figi });
        debugProvider('instrument', instrument);

        if (!instrument) {
          debugProvider('instrument not found by figi, skip position', position.figi);
          continue;
        }

        const priceWhenAddToWallet = await getLastPrice(instrument.figi, sdkObjects?.marketData, accountConfig);
        debugProvider('priceWhenAddToWallet', priceWhenAddToWallet);

        const amount = convertTinkoffNumberToNumber(position.quantity);
        const priceNumber = convertTinkoffNumberToNumber(position.currentPrice);
        const totalPriceNumber = amount * priceNumber;
        
        // Convert averagePositionPriceFifo to number for profit calculation
        const averagePositionPriceFifoNumber = position.averagePositionPriceFifo ? 
          convertTinkoffNumberToNumber(position.averagePositionPriceFifo) : undefined;
        
        // Convert averagePositionPrice to number as fallback
        const averagePositionPriceNumber = position.averagePositionPrice ? 
          convertTinkoffNumberToNumber(position.averagePositionPrice) : undefined;

        const corePosition = {
          pair: `${instrument.ticker}/${instrument.currency.toUpperCase()}`,
          base: instrument.ticker,
          quote: instrument.currency.toUpperCase(),
          figi: position.figi,
          amount: amount,
          lotSize: instrument.lot,
          price: priceWhenAddToWallet || { units: 0, nano: 0 },
          priceNumber: priceNumber,
          lotPrice: convertNumberToTinkoffNumber(instrument.lot * convertTinkoffNumberToNumber(priceWhenAddToWallet || { units: 0, nano: 0 })),
          totalPrice: convertNumberToTinkoffNumber(totalPriceNumber),
          totalPriceNumber: totalPriceNumber,
          averagePositionPriceFifoNumber: averagePositionPriceFifoNumber,
          averagePositionPriceNumber: averagePositionPriceNumber,
          blocked: position.blocked === true, // Check if position is blocked/frozen
          blockedLots: position.blockedLots || 0, // Number of blocked lots
        };
        debugProvider('corePosition', corePosition);
        coreWallet.push(corePosition);
      }

      debugProvider(coreWallet);

      // Report frozen assets if any are detected
      const frozenAssets = coreWallet.filter(position => position.blocked);
      if (frozenAssets.length > 0) {
        const totalPortfolioValue = _.sumBy(coreWallet.filter(p => p.base !== p.quote), 'totalPriceNumber');
        const frozenValue = _.sumBy(frozenAssets, 'totalPriceNumber');
        const frozenPercentage = totalPortfolioValue > 0 ? (frozenValue / totalPortfolioValue) * 100 : 0;
        const availableValue = totalPortfolioValue - frozenValue;
        const availablePercentage = 100 - frozenPercentage;

        console.log('\n❄️  FROZEN ASSETS DETECTED:');
        frozenAssets.forEach(asset => {
          if (asset.base && asset.base !== asset.quote) {
            console.log(`   - ${asset.base}: ${asset.amount || 0} units (${asset.blockedLots || 0} lots blocked) - Value: ${(asset.totalPriceNumber || 0).toFixed(2)} RUB`);
          }
        });
        console.log(`   Total Frozen Value: ${frozenValue.toFixed(2)} RUB (${frozenPercentage.toFixed(1)}% of portfolio)`);
        console.log(`   Available for Trading: ${availableValue.toFixed(2)} RUB (${availablePercentage.toFixed(1)}% of portfolio)`);

        if (frozenPercentage > 25) {
          console.log(`\n⚠️  WARNING: ${frozenPercentage.toFixed(1)}% of your portfolio is frozen and unavailable for trading`);
        }
        console.log('');
      }

      // Before calculating desired weights, we can collect fresh metrics for needed tickers
      try {
        const tickers = Object.keys(accountConfig?.desired_wallet || {});
        await collectOnceForSymbols(tickers);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.log('[provider] collectOnceForSymbols failed (will proceed with live APIs/fallbacks):', e);
      }

      let desiredForRun;
      let modeUsed;
      let positionMetrics = [];
      let diffApplied = false;
      let diffInfo;

      try {
        // Use the new function that supports diff adjustment
        const desiredResult = await buildDesiredWalletWithDiff(accountConfig);
        desiredForRun = desiredResult.wallet;
        modeUsed = desiredResult.modeApplied;
        positionMetrics = desiredResult.metrics;
        diffApplied = desiredResult.diffApplied;
        diffInfo = desiredResult.diffInfo;
        
        console.log(`\n📊 Successfully applied mode: ${modeUsed}`);
        if (diffApplied && diffInfo) {
          console.log(`\n🔄 Diff adjustment applied (mode: ${accountConfig.diff}, multiplier: ${diffInfo.appliedMultiplier}%)`);
        }
        if (positionMetrics.length > 0) {
          console.log('\n📈 Position Metrics:');
          positionMetrics.forEach(metric => {
            console.log(`  ${metric.ticker}:`);
            if (metric.aum) {
              console.log(`    AUM: ${metric.aum.value.toFixed(0)} RUB (${metric.aum.percentage.toFixed(1)}% of total)`);
            }
            if (metric.marketCap) {
              console.log(`    Market Cap: ${metric.marketCap.value.toFixed(0)} RUB (${metric.marketCap.percentage.toFixed(1)}% of total)`);
            }
            if (metric.decorrelation) {
              console.log(`    Decorrelation: ${metric.decorrelation.value.toFixed(1)}% (${metric.decorrelation.interpretation})`);
            }
          });
        }
      } catch (error) {
        if (error instanceof BalancingDataError) {
          console.error(`\n❌ Balancing halted: Cannot proceed with mode '${error.mode}'`);
          console.error(`   Missing data: ${error.missingData.join(', ')}`);
          console.error(`   Affected tickers: ${error.affectedTickers.join(', ')}`);
          console.error(`   Details: ${error.message}`);
          console.error('\n🔧 To fix this issue:');
          console.error('   1. Run bun run poll:metrics to collect fresh ETF metrics');
          console.error('   2. Check that etf_metrics/*.json files exist for all tickers');
          console.error('   3. Verify your internet connection for live API calls');
          console.error(`   4. Consider changing desired_mode in CONFIG.json to 'manual' or 'default'`);
          console.error('\n⏭️  Skipping current balancing cycle, will retry at next interval\n');
          return; // Skip this balancing cycle
        } else {
          // Re-throw unexpected errors
          throw error;
        }
      }

      // Save current portfolio shares BEFORE balancing
      // Important: called after buildDesiredWalletByMode, but before balancer
      const beforeShares = calculatePortfolioShares(coreWallet);
      
      // 🔍 DIAGNOSIS: Log portfolio state BEFORE balancing
      console.log('\n🔍 DIAGNOSIS: Portfolio state BEFORE balancing');
      console.log(`📊 Total positions in coreWallet: ${coreWallet.length}`);
      const rubBefore = coreWallet.find(p => p.base === 'RUB')?.amount || 0;
      console.log(`💰 RUB balance before: ${rubBefore.toFixed(2)}`);
      console.log(`⏰ Timestamp before balancing: ${new Date().toISOString()}`);

      // Determine if we should run in dry-run mode
      const shouldRunDryRun = !isExchangeOpen && exchangeClosureBehavior.mode === 'dry_run';
      
      const enhancedResult = await balancer(coreWallet, desiredForRun, positionMetrics, modeUsed, shouldRunDryRun, accountConfig, sdkObjects);
      const { finalPercents, marginInfo } = enhancedResult;
      
      // 🔍 DIAGNOSIS: Orders executed, but coreWallet NOT updated!
      console.log('\n⚡ DIAGNOSIS: Orders executed, BUT coreWallet NOT updated!');
      console.log(`⏰ Timestamp after balancing: ${new Date().toISOString()}`);
      const rubAfterOrders = coreWallet.find(p => p.base === 'RUB')?.amount || 0;
      console.log(`💰 RUB balance in OLD coreWallet: ${rubAfterOrders.toFixed(2)} (should be same as before)`);
      console.log('❌ This is the problem: afterShares will be calculated using OLD data!');

      // Add exchange closure status to logging
      if (!isExchangeOpen) {
        console.log(`\n⚠️  EXCHANGE CLOSED - Mode: ${exchangeClosureBehavior.mode.toUpperCase()}`);
        if (shouldRunDryRun) {
          console.log('📋 DRY-RUN: Calculations performed, no orders placed');
        } else if (exchangeClosureBehavior.mode === 'force_orders') {
          console.log('⚡ FORCE ORDERS: Attempting to place orders despite exchange closure');
        }
      }

      // Log margin information if available
      if (marginInfo) {
        console.log(`\n📊 Margin Information:`);
        console.log(`  Total margin used: ${marginInfo.totalMarginUsed.toFixed(2)} RUB`);
        console.log(`  Within limits: ${marginInfo.withinLimits ? '✅ Yes' : '❌ No'}`);
        if (marginInfo.marginPositions.length > 0) {
          console.log(`  Margin positions: ${marginInfo.marginPositions.length}`);
        }
      }

      // 🔍 DIAGNOSIS: Fetch FRESH portfolio data after order execution
      console.log('\n🔄 DIAGNOSIS: Fetching FRESH portfolio data after order execution...');
      let freshCoreWallet = coreWallet; // Default to old wallet if fresh fetch fails
      
      try {
        // Get fresh portfolio data to see real state after orders
        const { operations: ops } = sdkObjects || {};
        if (!ops) {
          throw new Error('operations SDK object not available for fresh data fetch');
        }
        const freshPortfolio = await ops.getPortfolio({ accountId: ACCOUNT_ID });
        const freshPositions = await ops.getPositions({ accountId: ACCOUNT_ID });
        
        // Create fresh wallet to compare with old one
        const tempFreshWallet: Wallet = [];
        
        // Add fresh currencies
        for (const currency of freshPositions.money) {
          tempFreshWallet.push({
            pair: `${currency.currency.toUpperCase()}/${currency.currency.toUpperCase()}`,
            base: currency.currency.toUpperCase(),
            quote: currency.currency.toUpperCase(),
            figi: undefined,
            amount: convertTinkoffNumberToNumber(currency),
            lotSize: 1,
            price: { units: 1, nano: 0 },
            priceNumber: 1,
            lotPrice: { units: 1, nano: 0 },
            totalPriceNumber: currency.units,
          });
        }
        
        // Add fresh positions
        for (const position of freshPortfolio.positions) {
          const instrument = _.find((global as any).INSTRUMENTS, { figi: position.figi });
          if (instrument) {
            const amount = position.quantity ? convertTinkoffNumberToNumber(position.quantity) : 0;
            const priceNumber = position.currentPrice ? convertTinkoffNumberToNumber(position.currentPrice) : 0;
            const totalPriceNumber = amount * priceNumber;
            
            // Convert averagePositionPriceFifo to number for profit calculation
            const averagePositionPriceFifoNumber = position.averagePositionPriceFifo ? 
              convertTinkoffNumberToNumber(position.averagePositionPriceFifo) : undefined;
            
            // Convert averagePositionPrice to number as fallback
            const averagePositionPriceNumber = position.averagePositionPrice ? 
              convertTinkoffNumberToNumber(position.averagePositionPrice) : undefined;
            
            tempFreshWallet.push({
              pair: `${instrument.ticker}/${instrument.currency.toUpperCase()}`,
              base: instrument.ticker,
              quote: instrument.currency.toUpperCase(),
              figi: position.figi,
              amount: amount,
              lotSize: instrument.lot,
              price: position.currentPrice,
              priceNumber: priceNumber,
              lotPrice: convertNumberToTinkoffNumber(instrument.lot * priceNumber),
              totalPrice: convertNumberToTinkoffNumber(totalPriceNumber),
              totalPriceNumber: totalPriceNumber,
              averagePositionPriceFifoNumber: averagePositionPriceFifoNumber,
              averagePositionPriceNumber: averagePositionPriceNumber,
              blocked: position.blocked === true, // Check if position is blocked/frozen
              blockedLots: position.blockedLots || 0, // Number of blocked lots
            });
          }
        }
        
        freshCoreWallet = tempFreshWallet;
        
        // 🔍 DIAGNOSIS: Compare old vs fresh data
        const rubFresh = freshCoreWallet.find(p => p.base === 'RUB')?.amount || 0;
        console.log(`💰 RUB balance in FRESH wallet: ${rubFresh.toFixed(2)}`);
        console.log(`📊 Difference in RUB: ${(rubFresh - rubAfterOrders).toFixed(2)}`);
        
        if (Math.abs(rubFresh - rubAfterOrders) > 0.01) {
          console.log('🎯 FOUND IT! Portfolio changed after balancing - dividends or order execution detected!');
        } else {
          console.log('🤔 No significant change detected - investigating further...');
        }
        
      } catch (error) {
        console.log('⚠️ Could not fetch fresh portfolio data:', error);
      }

      // Get updated shares AFTER balancing (using fresh data if available)
      const afterShares = calculatePortfolioShares(freshCoreWallet);
      
      // 🔍 DIAGNOSIS: Final comparison
      console.log('\n🎯 DIAGNOSIS: beforeShares vs afterShares comparison');
      const beforeKeys = Object.keys(beforeShares);
      const afterKeys = Object.keys(afterShares);
      
      for (const ticker of [...new Set([...beforeKeys, ...afterKeys])]) {
        const before = beforeShares[ticker] || 0;
        const after = afterShares[ticker] || 0;
        const diff = after - before;
        
        if (Math.abs(diff) > 0.01) {
          console.log(`📈 ${ticker}: ${before.toFixed(2)}% -> ${after.toFixed(2)}% (${diff > 0 ? '+' : ''}${diff.toFixed(2)}%)`);
        }
      }

      // Detailed balancing result output
      console.log(`\n🎯 BALANCING RESULT FOR ACCOUNT: ${accountConfig?.name || 'Unknown'} (${accountConfig?.id || 'Unknown'})`);
      console.log(`Mode used: ${modeUsed || accountConfig?.desired_mode || 'manual'}`);
      console.log('Format: TICKER: diff: before% -> after% (target%)');
      console.log('Where: before% = current share, after% = actual share after balancing, (target%) = target from balancer, diff = change in percentage points\n');

      // Sort tickers by descending share after balancing (after)
      const sortedTickers = Object.keys(finalPercents).sort((a, b) => {
        const afterA = afterShares[a] || 0;
        const afterB = afterShares[b] || 0;
        return afterB - afterA; // Descending: from larger to smaller
      });

      for (const ticker of sortedTickers) {
        if (ticker && ticker !== 'RUB') {
          const beforePercent = beforeShares[ticker] || 0;
          const afterPercent = afterShares[ticker] || 0;
          const targetPercent = finalPercents[ticker] || 0;

          // Calculate change in percentage points
          const diff = afterPercent - beforePercent;
          const diffSign = diff > 0 ? '+' : '';
          const diffText = diff === 0 ? '0%' : `${diffSign}${diff.toFixed(2)}%`;

          console.log(`${ticker}: ${diffText}: ${beforePercent.toFixed(2)}% -> ${afterPercent.toFixed(2)}% (${targetPercent.toFixed(2)}%)`);
          
          // Add enhanced metrics if available
          const positionMetric = positionMetrics.find(m => m.ticker === ticker || m.ticker === (normalizeTicker(ticker) || ticker));
          if (positionMetric) {
            if (positionMetric.aum) {
              console.log(`  AUM: ${(positionMetric.aum.value / 1e9).toFixed(1)}B RUB (${positionMetric.aum.percentage.toFixed(1)}% of portfolio AUM)`);
            }
            if (positionMetric.marketCap) {
              console.log(`  Market Cap: ${(positionMetric.marketCap.value / 1e9).toFixed(1)}B RUB (${positionMetric.marketCap.percentage.toFixed(1)}% of portfolio cap)`);
            }
            if (positionMetric.decorrelation) {
              console.log(`  Decorrelation: ${positionMetric.decorrelation.value > 0 ? '+' : ''}${positionMetric.decorrelation.value.toFixed(1)}% (${positionMetric.decorrelation.interpretation})`);
            }
          }
        }
      }

      // Add RUB balance (can be negative with margin trading)
      // Use fresh wallet data to get accurate RUB balance after orders
      const rubPosition = freshCoreWallet.find(p => p.base === 'RUB' && p.quote === 'RUB');
      if (rubPosition) {
        const rubBalance = rubPosition.totalPriceNumber || 0;
        const rubSign = rubBalance >= 0 ? '' : '-';
        const rubAbs = Math.abs(rubBalance);
        console.log(`RUR: ${rubSign}${rubAbs.toFixed(2)} RUB`);
      }

      // Calculate and display profit/loss information
      const profitCalculator = new ProfitCalculator();
      const profitSummary = profitCalculator.calculateProfit(freshCoreWallet);

      // Get expense information for this iteration
      const expenseSummary = expenseTracker.getIterationExpenses();

      // Add to daily aggregator
      dailyAggregator.addIterationData(profitSummary, expenseSummary);

      // Display profit/loss and expense summaries
      console.log('\n' + profitCalculator.formatProfitSummary(profitSummary));
      console.log('\n' + expenseTracker.formatExpenseSummary(expenseSummary));

      // Display daily summary
      console.log(dailyAggregator.formatDailySummary());

      // Clear iteration expenses for next iteration
      expenseTracker.clearIterationExpenses();

      // Handle iteration result updates based on exchange closure behavior
      const shouldUpdateIterationResult = isExchangeOpen || exchangeClosureBehavior.update_iteration_result;

      if (shouldUpdateIterationResult) {
        debugProvider(`ITERATION #${count} FINISHED. TIME: ${new Date()}`);
        // Additional iteration result logging/metrics can be added here
      } else {
        debugProvider(`ITERATION #${count} FINISHED (no result update). TIME: ${new Date()}`);
      }
      
      count++;

      if (options?.runOnce) {
        debugProvider('runOnce=true: finishing after first tick');
        resolve();
        return;
      }
    };

    // Немедленный первый запуск для отладки, затем по интервалу
    tick();
    if (!options?.runOnce) {
      setInterval(tick, accountConfig?.balance_interval || 3600000);
    }
  });
};

// Преобразование типов времени из ответа API к Date
const toDate = (t: any): Date | null => {
  if (!t) return null;
  if (t instanceof Date) return t;
  if (typeof t === 'string' || typeof t === 'number') return new Date(t);
  if (typeof t === 'object') {
    const seconds = (t.seconds !== undefined ? Number(t.seconds) : (t.sec !== undefined ? Number(t.sec) : undefined));
    const nanos = (t.nanos !== undefined ? Number(t.nanos) : (t.nano !== undefined ? Number(t.nano) : 0));
    if (seconds !== undefined) {
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
    }
  }
  return null;
};

// Проверяет, открыта ли указанная биржа прямо сейчас по расписанию торгов
export const isExchangeOpenNow = async (exchange: string = 'MOEX', instruments?: any): Promise<boolean> => {
  try {
    const now = new Date();
    const from = new Date(now); // Use current time as 'from' parameter
    const to = new Date(now);
    to.setDate(to.getDate() + 1); // Get schedule until tomorrow

    debugProvider(`Checking trading schedule for ${exchange}. Current time: ${now.toISOString()}`);
    debugProvider(`Request params: from=${from.toISOString()}, to=${to.toISOString()}`);

    if (!instruments) {
      debugProvider('instruments SDK object not provided, assuming exchange is open');
      return true;
    }

    const schedules: any = await instruments.tradingSchedules({
      exchange,
      from,
      to,
    });

    debugProvider('Trading schedules response:', JSON.stringify(schedules, null, 2));

    const exchanges = schedules?.exchanges || schedules?.exchangesList || [];
    const first = exchanges[0];
    const days = first?.days || first?.daysList || [];

    debugProvider(`Found ${days.length} trading days in schedule`);

    // Ищем интервал(ы) сегодняшнего дня и проверяем попадание now
    for (const day of days) {
      debugProvider('Processing day:', JSON.stringify(day, null, 2));

      // В некоторых обёртках может быть date как строка/Date — но для надёжности сверяем по границам
      if (day?.isTradingDay === false) {
        debugProvider('Day is not a trading day, skipping');
        continue;
      }

      const start = toDate(day?.startTime || day?.start_time);
      const end = toDate(day?.endTime || day?.end_time);
      const eveningStart = toDate(day?.eveningStartTime || day?.evening_start_time);
      const eveningEnd = toDate(day?.eveningEndTime || day?.evening_end_time);

      debugProvider(`Session times: start=${start?.toISOString()}, end=${end?.toISOString()}`);
      debugProvider(`Evening session: start=${eveningStart?.toISOString()}, end=${eveningEnd?.toISOString()}`);

      // Основная сессия
      if (start && end && now >= start && now <= end) {
        debugProvider('Current time is within main trading session');
        return true;
      }
      // Вечерняя сессия (если есть)
      if (eveningStart && eveningEnd && now >= eveningStart && now <= eveningEnd) {
        debugProvider('Current time is within evening trading session');
        return true;
      }
    }

    debugProvider('Current time is outside all trading sessions');
    return false;
  } catch (err) {
    // In case of errors, don't block bot operation
    debugProvider('Error requesting trading schedule', err);
    return true;
  }
};

export const getLastPrice = async (figi: any, marketData?: any, accountConfig?: any) => {
  debugProvider('Getting last price');
  if (!marketData) {
    debugProvider('marketData SDK object not provided');
    return null;
  }
  let lastPriceResult;
  try {
    lastPriceResult = await marketData.getLastPrices({
      figi: [figi],
    });
    debugProvider('lastPriceResult', lastPriceResult);
  } catch (err) {
    debugProvider(err);
  }

  const lastPrice = lastPriceResult?.lastPrices?.[0]?.price;
  debugProvider('lastPrice', lastPrice);
  await sleep(accountConfig?.sleep_between_orders || 1000);
  return lastPrice;
};

export const getInstruments = async (instruments?: any, accountConfig?: any) => {
  if (!instruments) {
    debugProvider('instruments SDK object not provided');
    return;
  }

  debugProvider('Getting shares list');
  let sharesResult;
  try {
    sharesResult = await instruments.shares({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const shares = sharesResult?.instruments;
  debugProvider('shares count', shares?.length);
  (global as any).INSTRUMENTS = _.union(shares, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting ETFs list');
  let etfsResult;
  try {
    etfsResult = await instruments.etfs({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const etfs = etfsResult?.instruments;
  debugProvider('etfs count', etfs?.length);
  (global as any).INSTRUMENTS = _.union(etfs, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting bonds list');
  let bondsResult;
  try {
    bondsResult = await instruments.bonds({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const bonds = bondsResult?.instruments;
  debugProvider('bonds count', bonds?.length);
  (global as any).INSTRUMENTS = _.union(bonds, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting currencies list');
  let currenciesResult;
  try {
    currenciesResult = await instruments.currencies({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const currencies = currenciesResult?.instruments;
  debugProvider('currencies count', currencies?.length);
  (global as any).INSTRUMENTS = _.union(currencies, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting futures list');
  let futuresResult;
  try {
    futuresResult = await instruments.futures({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const futures = futuresResult?.instruments;
  debugProvider('futures count', futures?.length);
  (global as any).INSTRUMENTS = _.union(futures, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('=========================');
};

export const getLastPrices = async (marketData?: any) => {
  if (!marketData) {
    debugProvider('marketData SDK object not provided');
    return;
  }
  const lastPrices = (await marketData.getLastPrices({
    figi: [],
  }))?.lastPrices;
  debugProvider('lastPrices', JSON.stringify(lastPrices, null, 2));
  const lastPricesFormatted = _.map(lastPrices, (item) => {
    if (item.price) {
      const priceNumber = convertTinkoffNumberToNumber(item.price);
      (item as any).price = priceNumber;
      debugProvider('fffff', priceNumber);
    }
    return item;
  });
  debugProvider('lastPricesFormatted', JSON.stringify(lastPricesFormatted, null, 2));
  (global as any).LAST_PRICES = lastPricesFormatted;

  writeFile(lastPricesFormatted, 'lastPrices');
};
