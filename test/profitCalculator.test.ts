import { describe, it, expect, beforeEach } from 'bun:test';
import { ProfitCalculator } from '../src/profitCalculator';
import { Wallet } from '../src/types.d';

describe('ProfitCalculator', () => {
  let calculator: ProfitCalculator;

  beforeEach(() => {
    calculator = new ProfitCalculator();
  });

  describe('calculateProfit', () => {
    it('should calculate profit correctly for positions with gains', () => {
      const wallet: Wallet = [
        {
          base: 'TMOS',
          quote: 'RUB',
          amount: 10,
          totalPriceNumber: 11000,
          averagePositionPriceFifoNumber: 1000,
        },
        {
          base: 'TRUR',
          quote: 'RUB',
          amount: 5,
          totalPriceNumber: 5500,
          averagePositionPriceNumber: 1000,
        },
      ];

      const result = calculator.calculateProfit(wallet);

      expect(result.totalProfit).toBe(1500); // (11000 - 10000) + (5500 - 5000)
      expect(result.totalProfitPercentage).toBeCloseTo(10, 1); // 1500 / 15000 * 100
      expect(result.positionsWithProfit).toBe(2);
      expect(result.positionsWithLoss).toBe(0);
      expect(result.details.length).toBe(2);
    });

    it('should calculate loss correctly for positions with losses', () => {
      const wallet: Wallet = [
        {
          base: 'TGLD',
          quote: 'RUB',
          amount: 10,
          totalPriceNumber: 9000,
          averagePositionPriceFifoNumber: 1000,
        },
      ];

      const result = calculator.calculateProfit(wallet);

      expect(result.totalProfit).toBe(-1000); // 9000 - 10000
      expect(result.totalProfitPercentage).toBeCloseTo(-10, 1); // -1000 / 10000 * 100
      expect(result.positionsWithProfit).toBe(0);
      expect(result.positionsWithLoss).toBe(1);
    });

    it('should skip currencies (where base === quote)', () => {
      const wallet: Wallet = [
        {
          base: 'RUB',
          quote: 'RUB',
          amount: 10000,
          totalPriceNumber: 10000,
        },
        {
          base: 'TMOS',
          quote: 'RUB',
          amount: 10,
          totalPriceNumber: 11000,
          averagePositionPriceFifoNumber: 1000,
        },
      ];

      const result = calculator.calculateProfit(wallet);

      expect(result.details.length).toBe(1); // Only TMOS, not RUB
      expect(result.details[0].ticker).toBe('TMOS');
    });

    it('should handle positions without average price data', () => {
      const wallet: Wallet = [
        {
          base: 'TMOS',
          quote: 'RUB',
          amount: 10,
          totalPriceNumber: 11000,
          // No average price data
        },
      ];

      const result = calculator.calculateProfit(wallet);

      expect(result.details.length).toBe(0); // Position skipped due to missing price data
      expect(result.totalProfit).toBe(0);
    });

    it('should prefer FIFO price over average price', () => {
      const wallet: Wallet = [
        {
          base: 'TMOS',
          quote: 'RUB',
          amount: 10,
          totalPriceNumber: 11000,
          averagePositionPriceFifoNumber: 1000, // FIFO price
          averagePositionPriceNumber: 900, // Average price (should be ignored)
        },
      ];

      const result = calculator.calculateProfit(wallet);

      expect(result.details[0].originalCost).toBe(10000); // Using FIFO: 1000 * 10
      expect(result.details[0].profitAmount).toBe(1000); // 11000 - 10000
    });
  });

  describe('formatProfitSummary', () => {
    it('should format profit summary correctly', () => {
      const summary = {
        totalProfit: 1500,
        totalProfitPercentage: 10,
        positionsWithProfit: 2,
        positionsWithLoss: 1,
        details: [],
      };

      const output = calculator.formatProfitSummary(summary);

      expect(output).toContain('Total Profit: +1500.00 RUB (+10.00%)');
      expect(output).toContain('Positions with Profit: 2');
      expect(output).toContain('Positions with Loss: 1');
    });

    it('should format loss summary correctly', () => {
      const summary = {
        totalProfit: -500,
        totalProfitPercentage: -5,
        positionsWithProfit: 0,
        positionsWithLoss: 2,
        details: [],
      };

      const output = calculator.formatProfitSummary(summary);

      expect(output).toContain('Total Profit: -500.00 RUB (-5.00%)');
      expect(output).toContain('🔴'); // Red indicator for loss
    });
  });
});