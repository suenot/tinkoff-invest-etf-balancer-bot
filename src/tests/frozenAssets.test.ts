import { describe, it, expect, beforeAll, jest } from '@jest/globals';
import { Wallet, Position } from '../types';

// Mock the provider module functions
const filterFrozenAssets = (wallet: Wallet): Wallet => {
  return wallet.filter(position => !position.blocked);
};

const calculateAvailablePortfolioValue = (wallet: Wallet): number => {
  const availableWallet = filterFrozenAssets(wallet);
  // Exclude currencies (where base === quote) from total value
  const securities = availableWallet.filter(p => p.base !== p.quote);
  return securities.reduce((sum, pos) => sum + (pos.totalPriceNumber || 0), 0);
};

const calculatePortfolioShares = (wallet: Wallet, includeBlocked: boolean = false): Record<string, number> => {
  // Exclude currencies (positions where base === quote)
  let securities = wallet.filter(p => p.base !== p.quote);

  // Filter out frozen assets unless explicitly requested to include them
  if (!includeBlocked) {
    securities = filterFrozenAssets(securities);
  }

  const totalValue = securities.reduce((sum, pos) => sum + (pos.totalPriceNumber || 0), 0);

  if (totalValue <= 0) return {};

  const shares: Record<string, number> = {};
  for (const position of securities) {
    if (position.base && position.totalPriceNumber) {
      shares[position.base] = (position.totalPriceNumber / totalValue) * 100;
    }
  }
  return shares;
};

describe('Frozen Asset Handling', () => {
  describe('filterFrozenAssets', () => {
    it('should filter out frozen assets from wallet', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 1000, blocked: true, blockedLots: 10 },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 2000, blocked: false },
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 1500 },
        { base: 'TSLA', quote: 'USD', totalPriceNumber: 3000, blocked: true, blockedLots: 5 },
      ];

      const filteredWallet = filterFrozenAssets(wallet);

      expect(filteredWallet).toHaveLength(2);
      expect(filteredWallet.some(p => p.base === 'AAPL')).toBe(false);
      expect(filteredWallet.some(p => p.base === 'TSLA')).toBe(false);
      expect(filteredWallet.some(p => p.base === 'MSFT')).toBe(true);
      expect(filteredWallet.some(p => p.base === 'GOOGL')).toBe(true);
    });

    it('should return empty array when all assets are frozen', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 1000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 2000, blocked: true },
      ];

      const filteredWallet = filterFrozenAssets(wallet);

      expect(filteredWallet).toHaveLength(0);
    });

    it('should return all assets when none are frozen', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 1000 },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 2000, blocked: false },
      ];

      const filteredWallet = filterFrozenAssets(wallet);

      expect(filteredWallet).toHaveLength(2);
    });
  });

  describe('calculateAvailablePortfolioValue', () => {
    it('should calculate total value of available assets only', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000, blocked: false },
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 15000 },
        { base: 'RUB', quote: 'RUB', totalPriceNumber: 5000 }, // Currency - should be excluded
      ];

      const availableValue = calculateAvailablePortfolioValue(wallet);

      expect(availableValue).toBe(35000); // 20000 + 15000 (excluding frozen AAPL and currency RUB)
    });

    it('should return 0 when all assets are frozen', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000, blocked: true },
      ];

      const availableValue = calculateAvailablePortfolioValue(wallet);

      expect(availableValue).toBe(0);
    });

    it('should handle mixed portfolio with frozen currency positions', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000 },
        { base: 'USD', quote: 'USD', totalPriceNumber: 50000, blocked: true }, // Frozen currency
        { base: 'EUR', quote: 'EUR', totalPriceNumber: 30000 }, // Available currency
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000, blocked: true },
      ];

      const availableValue = calculateAvailablePortfolioValue(wallet);

      expect(availableValue).toBe(10000); // Only AAPL counts (currencies excluded, MSFT frozen)
    });
  });

  describe('calculatePortfolioShares', () => {
    it('should calculate shares based on available assets only by default', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000 },
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 30000 },
        { base: 'RUB', quote: 'RUB', totalPriceNumber: 5000 }, // Currency - excluded
      ];

      const shares = calculatePortfolioShares(wallet);

      expect(shares['MSFT']).toBeCloseTo(40); // 20000 / 50000 * 100
      expect(shares['GOOGL']).toBeCloseTo(60); // 30000 / 50000 * 100
      expect(shares['AAPL']).toBeUndefined(); // Frozen - excluded
      expect(shares['RUB']).toBeUndefined(); // Currency - excluded
    });

    it('should include frozen assets when includeBlocked is true', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000 },
      ];

      const shares = calculatePortfolioShares(wallet, true);

      expect(shares['AAPL']).toBeCloseTo(33.33); // 10000 / 30000 * 100
      expect(shares['MSFT']).toBeCloseTo(66.67); // 20000 / 30000 * 100
    });

    it('should return empty object when all securities are frozen', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 10000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 20000, blocked: true },
        { base: 'RUB', quote: 'RUB', totalPriceNumber: 5000 }, // Currency - always excluded
      ];

      const shares = calculatePortfolioShares(wallet);

      expect(shares).toEqual({});
    });

    it('should handle edge case with 0 value positions', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 50000 },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 0 }, // 0 value position - will not appear in shares
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 50000, blocked: true },
      ];

      const shares = calculatePortfolioShares(wallet);

      expect(shares['AAPL']).toBeCloseTo(100);
      expect(shares['MSFT']).toBeUndefined(); // 0 value positions are not included
      expect(shares['GOOGL']).toBeUndefined(); // Frozen - excluded
    });
  });

  describe('Integration scenarios', () => {
    it('should handle portfolio with 25% frozen assets', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 25000, blocked: true },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 25000 },
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 25000 },
        { base: 'TSLA', quote: 'USD', totalPriceNumber: 25000 },
      ];

      const availableValue = calculateAvailablePortfolioValue(wallet);
      const totalValue = 100000;
      const frozenPercentage = ((totalValue - availableValue) / totalValue) * 100;

      expect(availableValue).toBe(75000);
      expect(frozenPercentage).toBeCloseTo(25);

      const shares = calculatePortfolioShares(wallet);
      expect(shares['MSFT']).toBeCloseTo(33.33);
      expect(shares['GOOGL']).toBeCloseTo(33.33);
      expect(shares['TSLA']).toBeCloseTo(33.33);
    });

    it('should correctly rebalance when some assets are frozen', () => {
      const wallet: Wallet = [
        { base: 'AAPL', quote: 'USD', totalPriceNumber: 30000, blocked: true, blockedLots: 15 },
        { base: 'MSFT', quote: 'USD', totalPriceNumber: 40000 },
        { base: 'GOOGL', quote: 'USD', totalPriceNumber: 30000 },
      ];

      // Available portfolio value should exclude frozen AAPL
      const availableValue = calculateAvailablePortfolioValue(wallet);
      expect(availableValue).toBe(70000);

      // Shares should be recalculated based on available assets only
      const shares = calculatePortfolioShares(wallet);
      expect(shares['MSFT']).toBeCloseTo(57.14); // 40000 / 70000 * 100
      expect(shares['GOOGL']).toBeCloseTo(42.86); // 30000 / 70000 * 100
      expect(shares['AAPL']).toBeUndefined(); // Frozen
    });
  });
});