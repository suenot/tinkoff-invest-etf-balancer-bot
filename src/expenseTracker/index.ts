import debug from 'debug';

const debugExpense = debug('bot').extend('expense');

export interface ExpenseRecord {
  orderId: string;
  ticker: string;
  orderType: 'BUY' | 'SELL';
  lots: number;
  amountRub: number;
  commission: number;
  timestamp: Date;
}

export interface ExpenseSummary {
  totalCommission: number;
  ordersExecuted: number;
  buyOrders: number;
  sellOrders: number;
  details: ExpenseRecord[];
}

export class ExpenseTracker {
  private expenses: ExpenseRecord[] = [];

  addExpense(expense: ExpenseRecord) {
    this.expenses.push(expense);
    debugExpense(`Added expense: ${expense.ticker} ${expense.orderType} - Commission: ${expense.commission} RUB`);
  }

  getIterationExpenses(): ExpenseSummary {
    const totalCommission = this.expenses.reduce((sum, expense) => sum + expense.commission, 0);
    const buyOrders = this.expenses.filter(e => e.orderType === 'BUY').length;
    const sellOrders = this.expenses.filter(e => e.orderType === 'SELL').length;

    return {
      totalCommission,
      ordersExecuted: this.expenses.length,
      buyOrders,
      sellOrders,
      details: [...this.expenses]
    };
  }

  clearIterationExpenses() {
    debugExpense(`Clearing ${this.expenses.length} expense records`);
    this.expenses = [];
  }

  formatExpenseSummary(summary: ExpenseSummary): string {
    let output = `💰 Expense Summary:\n`;
    output += `  Total Commission: ${summary.totalCommission.toFixed(2)} RUB\n`;
    output += `  Orders Executed: ${summary.ordersExecuted}`;
    if (summary.ordersExecuted > 0) {
      output += ` (${summary.buyOrders} buy, ${summary.sellOrders} sell)`;
    }

    return output;
  }

  formatDetailedExpenses(summary: ExpenseSummary): string {
    if (summary.details.length === 0) {
      return '\n💰 No expenses recorded for this iteration';
    }

    let output = `\n💰 Detailed Expenses:\n`;

    for (const expense of summary.details) {
      const typeEmoji = expense.orderType === 'BUY' ? '🔵' : '🔴';
      output += `  ${typeEmoji} ${expense.ticker}: ${expense.orderType} ${expense.lots} lots - Commission: ${expense.commission.toFixed(2)} RUB\n`;
    }

    output += `  ─────────────────────\n`;
    output += `  Total Commission: ${summary.totalCommission.toFixed(2)} RUB`;

    return output;
  }
}

// Global instance for tracking expenses across the application
export const expenseTracker = new ExpenseTracker();