import { describe, it, expect, beforeEach } from 'bun:test';
import { DailyAggregator } from '../src/dailyAggregator';
import { ProfitSummary } from '../src/profitCalculator';
import { ExpenseSummary } from '../src/expenseTracker';

describe('DailyAggregator', () => {
  let aggregator: DailyAggregator;

  beforeEach(() => {
    aggregator = new DailyAggregator();
  });

  const createProfitSummary = (profit: number): ProfitSummary => ({
    totalProfit: profit,
    totalProfitPercentage: profit / 1000,
    positionsWithProfit: profit > 0 ? 1 : 0,
    positionsWithLoss: profit < 0 ? 1 : 0,
    details: [],
  });

  const createExpenseSummary = (commission: number, orders: number): ExpenseSummary => ({
    totalCommission: commission,
    ordersExecuted: orders,
    buyOrders: Math.ceil(orders / 2),
    sellOrders: Math.floor(orders / 2),
    details: [],
  });

  describe('addIterationData', () => {
    it('should aggregate iteration data correctly', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      aggregator.addIterationData(
        createProfitSummary(500),
        createExpenseSummary(15, 1)
      );

      const metrics = aggregator.getDailyMetrics();

      expect(metrics.iterationCount).toBe(2);
      expect(metrics.cumulativeProfit).toBe(1500);
      expect(metrics.cumulativeExpenses).toBe(45);
      expect(metrics.netDailyProfit).toBe(1455);
    });

    it('should handle losses correctly', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      aggregator.addIterationData(
        createProfitSummary(-500),
        createExpenseSummary(15, 1)
      );

      const metrics = aggregator.getDailyMetrics();

      expect(metrics.cumulativeProfit).toBe(500);
      expect(metrics.netDailyProfit).toBe(455); // 500 - 45
    });

    it('should store profit and expense records', () => {
      const profitSummary = createProfitSummary(1000);
      const expenseSummary = createExpenseSummary(30, 2);

      aggregator.addIterationData(profitSummary, expenseSummary);

      const metrics = aggregator.getDailyMetrics();

      expect(metrics.profitRecords.length).toBe(1);
      expect(metrics.expenseRecords.length).toBe(1);
      expect(metrics.profitRecords[0]).toEqual(profitSummary);
      expect(metrics.expenseRecords[0]).toEqual(expenseSummary);
    });
  });

  describe('formatDailySummary', () => {
    it('should format daily summary with positive profit', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      const output = aggregator.formatDailySummary();
      const metrics = aggregator.getDailyMetrics();

      expect(output).toContain(`Daily Summary (${metrics.date} MSK)`);
      expect(output).toContain('Iterations Completed: 1');
      expect(output).toContain('Cumulative Profit: +1000.00 RUB');
      expect(output).toContain('Cumulative Expenses: 30.00 RUB');
      expect(output).toContain('Net Daily Profit: +970.00 RUB');
      expect(output).toContain('🟢'); // Green indicator for profit
    });

    it('should format daily summary with loss', () => {
      aggregator.addIterationData(
        createProfitSummary(-500),
        createExpenseSummary(30, 2)
      );

      const output = aggregator.formatDailySummary();

      expect(output).toContain('Cumulative Profit: -500.00 RUB');
      expect(output).toContain('Net Daily Profit: -530.00 RUB');
      expect(output).toContain('🔴'); // Red indicator for loss
    });
  });

  describe('formatDetailedDailySummary', () => {
    it('should include averages when multiple iterations exist', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      aggregator.addIterationData(
        createProfitSummary(500),
        createExpenseSummary(20, 1)
      );

      const output = aggregator.formatDetailedDailySummary();

      expect(output).toContain('Average per Iteration');
      expect(output).toContain('Avg Profit: +750.00 RUB'); // (1000 + 500) / 2
      expect(output).toContain('Avg Expense: 25.00 RUB'); // (30 + 20) / 2
    });

    it('should not show averages for single iteration', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      const output = aggregator.formatDetailedDailySummary();

      expect(output).not.toContain('Average per Iteration');
    });

    it('should show last updated time', () => {
      aggregator.addIterationData(
        createProfitSummary(1000),
        createExpenseSummary(30, 2)
      );

      const output = aggregator.formatDetailedDailySummary();

      expect(output).toContain('Last Updated:');
      expect(output).toContain('MSK');
    });
  });
});