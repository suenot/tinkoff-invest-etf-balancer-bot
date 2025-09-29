import { describe, it, expect, beforeEach } from 'bun:test';
import { 
  identifyProfitablePositions,
  identifyPositionsForSelling,
  calculateRequiredFunds,
  calculateSellingAmounts,
  calculatePositionProfit
} from '../utils/buyRequiresTotalMarginalSell';
import { Position, BuyRequiresTotalMarginalSellConfig } from '../types.d';

describe('buyRequiresTotalMarginalSell Configuration Tests', () => {
  let mockWallet: Position[];
  let baseConfig: BuyRequiresTotalMarginalSellConfig;

  beforeEach(() => {
    // Mock portfolio with various positions
    mockWallet = [
      {
        pair: 'TMON/RUB',
        base: 'TMON',
        quote: 'RUB',
        figi: 'TCS70A106DL2',
        amount: 0,
        lotSize: 1,
        priceNumber: 142.50,
        lotPriceNumber: 142.50,
        totalPriceNumber: 0,
        toBuyNumber: 1425.00, // Needs to buy 10 lots
        toBuyLots: 10
      },
      {
        pair: 'TPAY/RUB',
        base: 'TPAY',
        quote: 'RUB',
        figi: 'TCS00A108WX3',
        amount: 5,
        lotSize: 1,
        priceNumber: 100.00,
        lotPriceNumber: 100.00,
        totalPriceNumber: 500.00,
        averagePositionPriceFifoNumber: 90.00, // Profitable position (bought at 90, now 100)
        averagePositionPriceNumber: 90.00
      },
      {
        pair: 'TGLD/RUB',
        base: 'TGLD',
        quote: 'RUB',
        figi: 'TCS80A101X50',
        amount: 10,
        lotSize: 1,
        priceNumber: 11.50,
        lotPriceNumber: 11.50,
        totalPriceNumber: 115.00,
        averagePositionPriceFifoNumber: 12.00, // Loss position (bought at 12, now 11.50)
        averagePositionPriceNumber: 12.00
      },
      {
        pair: 'TMOS/RUB',
        base: 'TMOS',
        quote: 'RUB',
        figi: 'TCS60A101X76',
        amount: 20,
        lotSize: 1,
        priceNumber: 6.70,
        lotPriceNumber: 6.70,
        totalPriceNumber: 134.00,
        averagePositionPriceFifoNumber: 6.00, // Profitable position
        averagePositionPriceNumber: 6.00
      },
      {
        pair: 'RUB/RUB',
        base: 'RUB',
        quote: 'RUB',
        amount: -50.00, // Negative RUB balance (margin used)
        lotSize: 1,
        priceNumber: 1,
        lotPriceNumber: 1,
        totalPriceNumber: -50.00
      }
    ];

    baseConfig = {
      enabled: true,
      instruments: ['TMON'],
      allow_to_sell_others_positions_to_buy_non_marginal_positions: {
        mode: 'only_positive_positions_sell'
      },
      min_buy_rebalance_percent: 0.5
    };
  });

  describe('1. enabled/disabled Configuration Tests', () => {
    it('should not process when enabled=false', () => {
      const disabledConfig = { ...baseConfig, enabled: false };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, disabledConfig);
      
      // When disabled, should return empty funds (no special processing)
      expect(Object.keys(requiredFunds)).toHaveLength(0);
    });

    it('should process normally when enabled=true', () => {
      const enabledConfig = { ...baseConfig, enabled: true };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, enabledConfig);
      
      // Should identify TMON as requiring funds
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds.TMON).toBeGreaterThan(0);
    });

    it('should handle missing enabled field (default to false)', () => {
      const configWithoutEnabled = {
        instruments: ['TMON'],
        allow_to_sell_others_positions_to_buy_non_marginal_positions: {
          mode: 'only_positive_positions_sell'
        },
        min_buy_rebalance_percent: 0.5
      } as any;
      
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, configWithoutEnabled);
      
      expect(Object.keys(requiredFunds)).toHaveLength(0);
    });
  });

  describe('2. instruments List Configuration Tests', () => {
    it('should handle single instrument in list', () => {
      const config = { ...baseConfig, instruments: ['TMON'] };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(Object.keys(requiredFunds)).toHaveLength(1);
    });

    it('should handle multiple instruments in list', () => {
      // Add another non-margin instrument that needs buying
      const walletWithMultiple = [...mockWallet];
      walletWithMultiple.push({
        pair: 'TGLD2/RUB',
        base: 'TGLD2',
        quote: 'RUB',
        figi: 'TCS80A101X51',
        amount: 0,
        lotSize: 1,
        priceNumber: 15.00,
        lotPriceNumber: 15.00,
        totalPriceNumber: 0,
        toBuyNumber: 300.00, // Needs to buy
        toBuyLots: 20
      });

      const config = { ...baseConfig, instruments: ['TMON', 'TGLD2'] };
      const desiredWallet = { TMON: 10, TGLD2: 15, TPAY: 40, TGLD: 25, TMOS: 10 };
      
      const requiredFunds = calculateRequiredFunds(walletWithMultiple, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds).toHaveProperty('TGLD2');
      expect(Object.keys(requiredFunds)).toHaveLength(2);
    });

    it('should handle empty instruments list', () => {
      const config = { ...baseConfig, instruments: [] };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      
      expect(Object.keys(requiredFunds)).toHaveLength(0);
    });

    it('should ignore instruments not in desired wallet', () => {
      const config = { ...baseConfig, instruments: ['TMON', 'NONEXISTENT'] };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds).not.toHaveProperty('NONEXISTENT');
      expect(Object.keys(requiredFunds)).toHaveLength(1);
    });

    it('should ignore instruments not in wallet positions', () => {
      const config = { ...baseConfig, instruments: ['TMON', 'MISSING_FROM_WALLET'] };
      const desiredWallet = { TMON: 10, MISSING_FROM_WALLET: 5, TPAY: 40, TGLD: 25, TMOS: 20 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds).not.toHaveProperty('MISSING_FROM_WALLET');
    });
  });

  describe('3. Selling Modes Configuration Tests', () => {
    describe('3.1 only_positive_positions_sell mode', () => {
      it('should identify only profitable positions for selling', () => {
        const config = {
          ...baseConfig,
          allow_to_sell_others_positions_to_buy_non_marginal_positions: {
            mode: 'only_positive_positions_sell'
          }
        };

        const sellablePositions = identifyPositionsForSelling(mockWallet, config, 'only_positive_positions_sell');
        
        // Should find TPAY and TMOS (profitable), exclude TGLD (loss) and TMON (in instruments list)
        expect(sellablePositions).toHaveLength(2);
        expect(sellablePositions.some(p => p.base === 'TPAY')).toBe(true);
        expect(sellablePositions.some(p => p.base === 'TMOS')).toBe(true);
        expect(sellablePositions.some(p => p.base === 'TGLD')).toBe(false); // Loss position
        expect(sellablePositions.some(p => p.base === 'TMON')).toBe(false); // In instruments list
      });

      it('should calculate selling amounts from profitable positions only', () => {
        const profitablePositions = [
          mockWallet.find(p => p.base === 'TPAY')!,
          mockWallet.find(p => p.base === 'TMOS')!
        ];
        
        const requiredFunds = { TMON: 500 }; // Need 500 RUB
        const currentRubBalance = -50; // Negative balance
        
        const sellingPlan = calculateSellingAmounts(
          profitablePositions,
          requiredFunds,
          'only_positive_positions_sell',
          currentRubBalance
        );
        
        // Should plan to sell from profitable positions to cover 550 RUB (500 + 50 deficit)
        expect(Object.keys(sellingPlan).length).toBeGreaterThan(0);
        
        const totalSellAmount = Object.values(sellingPlan).reduce((sum, plan) => sum + plan.sellAmount, 0);
        expect(totalSellAmount).toBeGreaterThan(0); // Should sell something
      });

      it('should not sell more than available in profitable positions', () => {
        const profitablePositions = [mockWallet.find(p => p.base === 'TPAY')!]; // Only 500 RUB available
        
        const requiredFunds = { TMON: 1000 }; // Need more than available
        const currentRubBalance = 0;
        
        const sellingPlan = calculateSellingAmounts(
          profitablePositions,
          requiredFunds,
          'only_positive_positions_sell',
          currentRubBalance
        );
        
        const totalSellAmount = Object.values(sellingPlan).reduce((sum, plan) => sum + plan.sellAmount, 0);
        expect(totalSellAmount).toBeLessThanOrEqual(500); // Cannot exceed available
      });
    });

    describe('3.2 equal_in_percents mode', () => {
      it('should sell proportionally from all positions except instruments list', () => {
        const availablePositions = mockWallet.filter(p => 
          p.base !== 'TMON' && p.base !== 'RUB' && (p.totalPriceNumber || 0) > 0
        );
        
        const requiredFunds = { TMON: 200 };
        const currentRubBalance = 0;
        
        const sellingPlan = calculateSellingAmounts(
          availablePositions,
          requiredFunds,
          'equal_in_percents',
          currentRubBalance
        );
        
        // Should distribute selling proportionally
        expect(Object.keys(sellingPlan).length).toBeGreaterThan(0);
        
        // Check that selling plan exists and has reasonable values
        const totalSellAmount = Object.values(sellingPlan).reduce((sum, plan) => sum + plan.sellAmount, 0);
        expect(totalSellAmount).toBeGreaterThan(0);
        expect(totalSellAmount).toBeLessThanOrEqual(200); // Should not exceed what's needed
      });

      it('should handle zero total value gracefully', () => {
        const emptyPositions: Position[] = [];
        
        const requiredFunds = { TMON: 100 };
        const currentRubBalance = 0;
        
        const sellingPlan = calculateSellingAmounts(
          emptyPositions,
          requiredFunds,
          'equal_in_percents',
          currentRubBalance
        );
        
        expect(Object.keys(sellingPlan)).toHaveLength(0);
      });
    });

    describe('3.3 none mode', () => {
      it('should not sell any positions when mode is none', () => {
        const availablePositions = mockWallet.filter(p => p.base !== 'RUB');
        
        const requiredFunds = { TMON: 500 };
        const currentRubBalance = -50;
        
        const sellingPlan = calculateSellingAmounts(
          availablePositions,
          requiredFunds,
          'none',
          currentRubBalance
        );
        
        expect(Object.keys(sellingPlan)).toHaveLength(0);
      });

      it('should work with positive RUB balance in none mode', () => {
        const availablePositions = mockWallet.filter(p => p.base !== 'RUB');
        
        const requiredFunds = { TMON: 100 };
        const currentRubBalance = 200; // Sufficient cash
        
        const sellingPlan = calculateSellingAmounts(
          availablePositions,
          requiredFunds,
          'none',
          currentRubBalance
        );
        
        expect(Object.keys(sellingPlan)).toHaveLength(0);
      });
    });

    describe('3.4 Invalid/Unknown modes', () => {
      it('should handle unknown selling mode gracefully', () => {
        const availablePositions = mockWallet.filter(p => p.base !== 'RUB');
        
        const requiredFunds = { TMON: 100 };
        const currentRubBalance = 0;
        
        const sellingPlan = calculateSellingAmounts(
          availablePositions,
          requiredFunds,
          'unknown_mode' as any,
          currentRubBalance
        );
        
        expect(Object.keys(sellingPlan)).toHaveLength(0);
      });
    });
  });

  describe('4. min_buy_rebalance_percent Threshold Tests', () => {
    it('should respect minimum threshold for purchases', () => {
      // Create wallet where TMON purchase is below threshold
      const smallPurchaseWallet = [...mockWallet];
      const tmonPosition = smallPurchaseWallet.find(p => p.base === 'TMON')!;
      tmonPosition.toBuyNumber = 1; // Very small purchase - 1 RUB
      tmonPosition.toBuyLots = 0.007; // Less than 1 lot
      
      // Total portfolio value is about 749 RUB, so 1% = 7.49 RUB
      // Purchase of 1 RUB should be below 7.49 RUB threshold
      const config = { ...baseConfig, min_buy_rebalance_percent: 1.0 }; // 1% threshold
      const desiredWallet = { TMON: 1, TPAY: 40, TGLD: 25, TMOS: 34 };
      
      const requiredFunds = calculateRequiredFunds(smallPurchaseWallet, desiredWallet, config);
      
      // Should not require funds because purchase is below threshold
      expect(Object.keys(requiredFunds)).toHaveLength(0);
    });

    it('should process purchases above threshold', () => {
      // Create wallet where TMON purchase is above threshold
      const largePurchaseWallet = [...mockWallet];
      const tmonPosition = largePurchaseWallet.find(p => p.base === 'TMON')!;
      tmonPosition.toBuyNumber = 500; // Large purchase
      tmonPosition.toBuyLots = 3.5;
      
      const config = { ...baseConfig, min_buy_rebalance_percent: 1.0 }; // 1% threshold
      const desiredWallet = { TMON: 25, TPAY: 25, TGLD: 25, TMOS: 25 };
      
      // Total portfolio value ≈ 749 RUB (500+115+134), so 1% = 7.49 RUB
      // Purchase of 500 RUB is well above threshold
      
      const requiredFunds = calculateRequiredFunds(largePurchaseWallet, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds.TMON).toBe(500);
    });

    it('should handle zero threshold (all purchases allowed)', () => {
      const config = { ...baseConfig, min_buy_rebalance_percent: 0 };
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      
      // Even small purchases should be processed with zero threshold
      expect(requiredFunds).toHaveProperty('TMON');
    });

    it('should handle very high threshold (no purchases allowed)', () => {
      // Create wallet with reasonable purchase amount
      const testWallet = [...mockWallet];
      const tmonPosition = testWallet.find(p => p.base === 'TMON')!;
      tmonPosition.toBuyNumber = 500; // 500 RUB purchase
      
      const config = { ...baseConfig, min_buy_rebalance_percent: 100 }; // 100% threshold
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      
      const requiredFunds = calculateRequiredFunds(testWallet, desiredWallet, config);
      
      // No purchase should meet 100% threshold (500 RUB < 749 RUB * 100%)
      expect(Object.keys(requiredFunds)).toHaveLength(0);
    });

    it('should calculate threshold based on total portfolio value', () => {
      const config = { ...baseConfig, min_buy_rebalance_percent: 2.0 }; // 2% threshold
      
      // Calculate expected threshold
      const totalPortfolioValue = mockWallet.reduce((sum, pos) => sum + (pos.totalPriceNumber || 0), 0);
      const expectedThreshold = totalPortfolioValue * 0.02; // 2%
      
      // Create purchase exactly at threshold
      const thresholdWallet = [...mockWallet];
      const tmonPosition = thresholdWallet.find(p => p.base === 'TMON')!;
      tmonPosition.toBuyNumber = expectedThreshold;
      
      const desiredWallet = { TMON: 10, TPAY: 40, TGLD: 25, TMOS: 25 };
      const requiredFunds = calculateRequiredFunds(thresholdWallet, desiredWallet, config);
      
      expect(requiredFunds).toHaveProperty('TMON');
      expect(requiredFunds.TMON).toBe(expectedThreshold);
    });
  });

  describe('5. Position Profit Calculation Tests', () => {
    it('should correctly identify profitable positions', () => {
      const profitablePosition = mockWallet.find(p => p.base === 'TPAY')!;
      const profit = calculatePositionProfit(profitablePosition);
      
      expect(profit).not.toBeNull();
      expect(profit!.profitAmount).toBe(50); // (100-90) * 5 lots
      expect(profit!.profitPercent).toBeCloseTo(11.11, 1); // 50/450 * 100
    });


    it('should return null for positions with zero amount', () => {
      const zeroPosition = mockWallet.find(p => p.base === 'TMON')!;
      const profit = calculatePositionProfit(zeroPosition);
      
      expect(profit).toBeNull();
    });

    it('should handle missing price data gracefully', () => {
      const positionWithoutPrices: Position = {
        pair: 'TEST/RUB',
        base: 'TEST',
        quote: 'RUB',
        amount: 10,
        lotSize: 1,
        totalPriceNumber: 100
        // Missing averagePositionPriceFifoNumber and averagePositionPriceNumber
      };
      
      const profit = calculatePositionProfit(positionWithoutPrices);
      expect(profit).toBeNull();
    });
  });

  describe('6. Integration Tests', () => {
    it('should handle complete workflow with all components', () => {
      const config: BuyRequiresTotalMarginalSellConfig = {
        enabled: true,
        instruments: ['TMON'],
        allow_to_sell_others_positions_to_buy_non_marginal_positions: {
          mode: 'only_positive_positions_sell'
        },
        min_buy_rebalance_percent: 0.5
      };
      
      const desiredWallet = { TMON: 20, TPAY: 30, TGLD: 25, TMOS: 25 };
      
      // Step 1: Calculate required funds
      const requiredFunds = calculateRequiredFunds(mockWallet, desiredWallet, config);
      expect(requiredFunds).toHaveProperty('TMON');
      
      // Step 2: Identify profitable positions
      const profitablePositions = identifyProfitablePositions(mockWallet, config);
      expect(profitablePositions.length).toBeGreaterThan(0);
      
      // Step 3: Calculate selling amounts
      const currentRubBalance = mockWallet.find(p => p.base === 'RUB')?.totalPriceNumber || 0;
      const sellingPlan = calculateSellingAmounts(
        profitablePositions,
        requiredFunds,
        config.allow_to_sell_others_positions_to_buy_non_marginal_positions.mode,
        currentRubBalance
      );
      
      // Verify complete workflow
      expect(Object.keys(sellingPlan).length).toBeGreaterThan(0);
      
      const totalSellAmount = Object.values(sellingPlan).reduce((sum, plan) => sum + plan.sellAmount, 0);
      const totalRequiredFunds = Object.values(requiredFunds).reduce((sum, amount) => sum + amount, 0);
      const deficit = currentRubBalance < 0 ? Math.abs(currentRubBalance) : 0;
      
      expect(totalSellAmount).toBeGreaterThanOrEqual(Math.min(totalRequiredFunds + deficit, 
        profitablePositions.reduce((sum, pos) => sum + (pos.totalPriceNumber || 0), 0)));
    });

    it('should handle edge case with no profitable positions', () => {
      // Create wallet with only loss positions
      const lossOnlyWallet = mockWallet.map(pos => {
        if (pos.base !== 'RUB' && pos.base !== 'TMON') {
          return {
            ...pos,
            averagePositionPriceFifoNumber: (pos.priceNumber || 0) * 2, // All positions at loss
            averagePositionPriceNumber: (pos.priceNumber || 0) * 2
          };
        }
        return pos;
      });
      
      const config = baseConfig;
      const desiredWallet = { TMON: 20, TPAY: 30, TGLD: 25, TMOS: 25 };
      
      const profitablePositions = identifyProfitablePositions(lossOnlyWallet, config);
      expect(profitablePositions).toHaveLength(0);
      
      const sellingPlan = calculateSellingAmounts(
        profitablePositions,
        { TMON: 500 },
        'only_positive_positions_sell',
        -50
      );
      
      expect(Object.keys(sellingPlan)).toHaveLength(0);
    });
  });
});
