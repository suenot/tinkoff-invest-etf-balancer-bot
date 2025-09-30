import debug from 'debug';
import uniqid from 'uniqid';
import { OrderDirection, OrderType } from 'tinkoff-sdk-grpc-js/dist/generated/orders';
import { Wallet, Position, OrderResult, OrderConfirmationRequest, OrderExecutionResult, OrderDetails } from '../types.d';
import { sleep } from '../utils';
import { expenseTracker, ExpenseRecord } from '../expenseTracker';

const debugProvider = debug('bot').extend('provider');

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

  // Note: ACCOUNT_ID needs to be passed as parameter since it's module-level in original
  const accountId = sdkObjects?.accountId;
  if (!accountId) {
    debugProvider('Account ID not provided in sdkObjects');
    const result: OrderExecutionResult = {
      status: 'skipped',
      errorMessage: 'Account ID not provided'
    };
    return result;
  }

  const order = {
    accountId: accountId,
    figi: position.figi,
    quantity: quantityLots, // Number of lots must be integer
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