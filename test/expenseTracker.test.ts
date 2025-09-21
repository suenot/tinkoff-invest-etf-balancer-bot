import { describe, it, expect, beforeEach } from 'bun:test';
import { ExpenseTracker } from '../src/expenseTracker';

describe('ExpenseTracker', () => {
  let tracker: ExpenseTracker;

  beforeEach(() => {
    tracker = new ExpenseTracker();
  });

  describe('addExpense', () => {
    it('should add expense records correctly', () => {
      tracker.addExpense({
        orderId: 'order-1',
        ticker: 'TMOS',
        orderType: 'BUY',
        lots: 10,
        amountRub: 10000,
        commission: 30,
        timestamp: new Date(),
      });

      const summary = tracker.getIterationExpenses();
      expect(summary.ordersExecuted).toBe(1);
      expect(summary.totalCommission).toBe(30);
    });

    it('should track multiple expenses', () => {
      tracker.addExpense({
        orderId: 'order-1',
        ticker: 'TMOS',
        orderType: 'BUY',
        lots: 10,
        amountRub: 10000,
        commission: 30,
        timestamp: new Date(),
      });

      tracker.addExpense({
        orderId: 'order-2',
        ticker: 'TRUR',
        orderType: 'SELL',
        lots: 5,
        amountRub: 5000,
        commission: 15,
        timestamp: new Date(),
      });

      const summary = tracker.getIterationExpenses();
      expect(summary.ordersExecuted).toBe(2);
      expect(summary.totalCommission).toBe(45);
      expect(summary.buyOrders).toBe(1);
      expect(summary.sellOrders).toBe(1);
    });
  });

  describe('clearIterationExpenses', () => {
    it('should clear all expense records', () => {
      tracker.addExpense({
        orderId: 'order-1',
        ticker: 'TMOS',
        orderType: 'BUY',
        lots: 10,
        amountRub: 10000,
        commission: 30,
        timestamp: new Date(),
      });

      tracker.clearIterationExpenses();
      const summary = tracker.getIterationExpenses();

      expect(summary.ordersExecuted).toBe(0);
      expect(summary.totalCommission).toBe(0);
      expect(summary.details.length).toBe(0);
    });
  });

  describe('formatExpenseSummary', () => {
    it('should format expense summary correctly', () => {
      tracker.addExpense({
        orderId: 'order-1',
        ticker: 'TMOS',
        orderType: 'BUY',
        lots: 10,
        amountRub: 10000,
        commission: 30,
        timestamp: new Date(),
      });

      tracker.addExpense({
        orderId: 'order-2',
        ticker: 'TRUR',
        orderType: 'SELL',
        lots: 5,
        amountRub: 5000,
        commission: 15,
        timestamp: new Date(),
      });

      const summary = tracker.getIterationExpenses();
      const output = tracker.formatExpenseSummary(summary);

      expect(output).toContain('Total Commission: 45.00 RUB');
      expect(output).toContain('Orders Executed: 2');
      expect(output).toContain('1 buy, 1 sell');
    });

    it('should format empty expense summary', () => {
      const summary = tracker.getIterationExpenses();
      const output = tracker.formatExpenseSummary(summary);

      expect(output).toContain('Total Commission: 0.00 RUB');
      expect(output).toContain('Orders Executed: 0');
    });
  });

  describe('formatDetailedExpenses', () => {
    it('should format detailed expenses correctly', () => {
      tracker.addExpense({
        orderId: 'order-1',
        ticker: 'TMOS',
        orderType: 'BUY',
        lots: 10,
        amountRub: 10000,
        commission: 30,
        timestamp: new Date(),
      });

      const summary = tracker.getIterationExpenses();
      const output = tracker.formatDetailedExpenses(summary);

      expect(output).toContain('TMOS: BUY 10 lots');
      expect(output).toContain('Commission: 30.00 RUB');
      expect(output).toContain('Total Commission: 30.00 RUB');
    });

    it('should show no expenses message when empty', () => {
      const summary = tracker.getIterationExpenses();
      const output = tracker.formatDetailedExpenses(summary);

      expect(output).toContain('No expenses recorded for this iteration');
    });
  });
});