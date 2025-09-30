import { describe, it, expect, mock } from 'bun:test';
import {
  AccountConfig,
  AnalysisConfig,
  OpenRouterConfig,
  OrderConfirmationRequest,
  OrderExecutionResult,
  OrderDetails,
  Position
} from '../types.d';
import { generateOrder } from '../provider';

describe('Human-in-Loop Confirmation Mechanism', () => {
  describe('Type Definitions', () => {
    it('should have proper type definitions for OpenRouterConfig', () => {
      const config: OpenRouterConfig = {
        requireConfirmationForLargeOrders: true,
        apiKey: 'test-key'
      };

      expect(config.requireConfirmationForLargeOrders).toBe(true);
      expect(config.apiKey).toBe('test-key');
    });

    it('should have proper type definitions for AnalysisConfig', () => {
      const config: AnalysisConfig = {
        openrouter: {
          requireConfirmationForLargeOrders: true,
          apiKey: 'test-key'
        }
      };

      expect(config.openrouter?.requireConfirmationForLargeOrders).toBe(true);
      expect(config.openrouter?.apiKey).toBe('test-key');
    });

    it('should support confirmation threshold in AccountConfig', () => {
      const account: Partial<AccountConfig> = {
        confirmationThresholdRub: 50000,
        analysis: {
          openrouter: {
            requireConfirmationForLargeOrders: true
          }
        }
      };

      expect(account.confirmationThresholdRub).toBe(50000);
      expect(account.analysis?.openrouter?.requireConfirmationForLargeOrders).toBe(true);
    });

    it('should have proper OrderConfirmationRequest structure', () => {
      const orderDetails: OrderDetails = {
        ticker: 'TGLD',
        quantity: 10,
        direction: 'BUY',
        valueRub: 75000,
        lotSize: 1,
        pricePerLot: 7500,
        figi: 'TCS123456789',
        orderId: 'test-order-123'
      };

      const confirmationRequest: OrderConfirmationRequest = {
        status: 'needs_confirmation',
        orderDetails,
        thresholdInfo: {
          configuredThreshold: 50000,
          actualOrderValue: 75000
        },
        timestamp: '2023-01-01T00:00:00.000Z'
      };

      expect(confirmationRequest.status).toBe('needs_confirmation');
      expect(confirmationRequest.orderDetails.valueRub).toBe(75000);
      expect(confirmationRequest.thresholdInfo.actualOrderValue).toBeGreaterThan(confirmationRequest.thresholdInfo.configuredThreshold);
    });

    it('should have proper OrderExecutionResult structure', () => {
      const executionResult: OrderExecutionResult = {
        status: 'executed',
        orderDetails: {
          ticker: 'TGLD',
          quantity: 5,
          direction: 'BUY',
          valueRub: 25000,
          lotSize: 1,
          pricePerLot: 5000,
          figi: 'TCS123456789',
          orderId: 'test-order-456'
        },
        commission: 75
      };

      expect(executionResult.status).toBe('executed');
      expect(executionResult.commission).toBe(75);
      expect(executionResult.orderDetails?.valueRub).toBe(25000);
    });
  });

  describe('Order Confirmation Logic', () => {
    const createMockPosition = (toBuyLots: number, lotPriceNumber: number): Position => ({
      base: 'TGLD',
      figi: 'TCS123456789',
      toBuyLots,
      lotPriceNumber,
      lotSize: 1,
      priceNumber: lotPriceNumber
    });

    const createAccountConfigWithConfirmation = (
      requireConfirmation: boolean,
      threshold: number
    ): Partial<AccountConfig> => ({
      confirmationThresholdRub: threshold,
      analysis: {
        openrouter: {
          requireConfirmationForLargeOrders: requireConfirmation
        }
      },
      sleep_between_orders: 100
    });

    it('should return confirmation request for orders above threshold', async () => {
      const position = createMockPosition(10, 7500); // 75,000 RUB total
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'needs_confirmation',
        thresholdInfo: {
          configuredThreshold: 50000,
          actualOrderValue: 75000
        }
      });

      const confirmationRequest = result as OrderConfirmationRequest;
      expect(confirmationRequest.orderDetails.ticker).toBe('TGLD');
      expect(confirmationRequest.orderDetails.quantity).toBe(10);
      expect(confirmationRequest.orderDetails.direction).toBe('BUY');
      expect(confirmationRequest.orderDetails.valueRub).toBe(75000);
    });

    it('should execute normally for orders below threshold', async () => {
      const position = createMockPosition(5, 5000); // 25,000 RUB total
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'executed'
      });

      const executionResult = result as OrderExecutionResult;
      expect(executionResult.orderDetails?.valueRub).toBe(25000);
      expect(executionResult.orderDetails?.ticker).toBe('TGLD');
    });

    it('should execute normally when confirmation is disabled', async () => {
      const position = createMockPosition(15, 7500); // 112,500 RUB total (above threshold)
      const accountConfig = createAccountConfigWithConfirmation(false, 50000);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'executed'
      });

      const executionResult = result as OrderExecutionResult;
      expect(executionResult.orderDetails?.valueRub).toBe(112500);
    });

    it('should execute normally when no analysis config is provided', async () => {
      const position = createMockPosition(15, 7500); // 112,500 RUB total
      const accountConfig = { sleep_between_orders: 100 };
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'executed'
      });
    });

    it('should handle sell orders correctly', async () => {
      const position = createMockPosition(-10, 7500); // Sell 10 lots at 7500 each = 75,000 RUB
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'needs_confirmation'
      });

      const confirmationRequest = result as OrderConfirmationRequest;
      expect(confirmationRequest.orderDetails.direction).toBe('SELL');
      expect(confirmationRequest.orderDetails.quantity).toBe(10);
      expect(confirmationRequest.orderDetails.valueRub).toBe(75000);
    });

    it('should skip RUB positions', async () => {
      const position: Position = {
        base: 'RUB',
        toBuyLots: 100,
        lotPriceNumber: 1
      };
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);

      const result = await generateOrder(position, accountConfig, {});

      expect(result).toBe(false);
    });

    it('should return error result when SDK objects are missing', async () => {
      const position = createMockPosition(5, 5000); // 25,000 RUB (below threshold)
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);

      const result = await generateOrder(position, accountConfig, null);

      expect(result).toMatchObject({
        status: 'skipped',
        errorMessage: 'orders SDK object not provided'
      });
    });

    it('should return error result when order placement fails', async () => {
      const position = createMockPosition(5, 5000); // 25,000 RUB (below threshold)
      const accountConfig = createAccountConfigWithConfirmation(true, 50000);
      const mockSdkObjects = {
        orders: {
          postOrder: mock(() => Promise.reject(new Error('API Error')))
        }
      };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'error',
        errorMessage: 'API Error'
      });

      const errorResult = result as OrderExecutionResult;
      expect(errorResult.orderDetails?.ticker).toBe('TGLD');
    });

    it('should handle edge case with zero or negative threshold', async () => {
      const position = createMockPosition(1, 1000); // 1,000 RUB
      const accountConfig = createAccountConfigWithConfirmation(true, 0);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'needs_confirmation'
      });

      const confirmationRequest = result as OrderConfirmationRequest;
      expect(confirmationRequest.thresholdInfo.actualOrderValue).toBeGreaterThan(confirmationRequest.thresholdInfo.configuredThreshold);
    });

    it('should handle fractional lots correctly', async () => {
      const position = createMockPosition(10.7, 5000); // Should round down to 10 lots
      const accountConfig = createAccountConfigWithConfirmation(true, 25000);
      const mockSdkObjects = { orders: { postOrder: mock(() => Promise.resolve({})) } };

      const result = await generateOrder(position, accountConfig, mockSdkObjects);

      expect(result).toMatchObject({
        status: 'needs_confirmation'
      });

      const confirmationRequest = result as OrderConfirmationRequest;
      expect(confirmationRequest.orderDetails.quantity).toBe(10); // Rounded down
      expect(confirmationRequest.orderDetails.valueRub).toBe(50000); // 10 * 5000
    });

    it('should skip orders with less than 1 lot after rounding', async () => {
      const position = createMockPosition(0.5, 5000); // Less than 1 lot
      const accountConfig = createAccountConfigWithConfirmation(true, 1000);

      const result = await generateOrder(position, accountConfig, {});

      expect(result).toMatchObject({
        status: 'skipped',
        errorMessage: 'Number of lots after rounding < 1'
      });
    });

    it('should skip orders with missing figi', async () => {
      const position: Position = {
        base: 'TGLD',
        toBuyLots: 5,
        lotPriceNumber: 5000,
        // figi is missing
      };
      const accountConfig = createAccountConfigWithConfirmation(true, 1000);

      const result = await generateOrder(position, accountConfig, {});

      expect(result).toMatchObject({
        status: 'skipped',
        errorMessage: 'Position missing figi'
      });
    });
  });
});