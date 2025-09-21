import debug from 'debug';
import { ProfitSummary } from '../profitCalculator';
import { ExpenseSummary } from '../expenseTracker';

const debugDaily = debug('bot').extend('daily');

export interface DailyMetrics {
  date: string; // YYYY-MM-DD format in Moscow timezone
  iterationCount: number;
  cumulativeProfit: number;
  cumulativeExpenses: number;
  netDailyProfit: number;
  profitRecords: ProfitSummary[];
  expenseRecords: ExpenseSummary[];
  lastUpdated: Date;
}

export class DailyAggregator {
  private currentDay: string;
  private dailyMetrics: DailyMetrics;

  constructor() {
    this.currentDay = this.getMoscowDate();
    this.dailyMetrics = this.initializeDailyMetrics();
  }

  private getMoscowDate(): string {
    // Get current date in Moscow timezone (UTC+3)
    const now = new Date();
    const moscowOffset = 3 * 60; // Moscow is UTC+3
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const moscowTime = new Date(utcTime + moscowOffset * 60000);

    const year = moscowTime.getFullYear();
    const month = String(moscowTime.getMonth() + 1).padStart(2, '0');
    const day = String(moscowTime.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private initializeDailyMetrics(): DailyMetrics {
    return {
      date: this.currentDay,
      iterationCount: 0,
      cumulativeProfit: 0,
      cumulativeExpenses: 0,
      netDailyProfit: 0,
      profitRecords: [],
      expenseRecords: [],
      lastUpdated: new Date()
    };
  }

  addIterationData(profitSummary: ProfitSummary, expenseSummary: ExpenseSummary) {
    const currentDate = this.getMoscowDate();

    // Check if we need to reset for a new day
    if (currentDate !== this.currentDay) {
      debugDaily(`New trading day detected: ${currentDate}. Resetting daily metrics.`);
      this.currentDay = currentDate;
      this.dailyMetrics = this.initializeDailyMetrics();
    }

    // Update metrics
    this.dailyMetrics.iterationCount++;
    this.dailyMetrics.cumulativeProfit += profitSummary.totalProfit;
    this.dailyMetrics.cumulativeExpenses += expenseSummary.totalCommission;
    this.dailyMetrics.netDailyProfit = this.dailyMetrics.cumulativeProfit - this.dailyMetrics.cumulativeExpenses;

    // Store records for detailed analysis
    this.dailyMetrics.profitRecords.push(profitSummary);
    this.dailyMetrics.expenseRecords.push(expenseSummary);

    this.dailyMetrics.lastUpdated = new Date();

    debugDaily(`Updated daily metrics: Iteration #${this.dailyMetrics.iterationCount}, ` +
              `Cumulative Profit: ${this.dailyMetrics.cumulativeProfit.toFixed(2)} RUB, ` +
              `Cumulative Expenses: ${this.dailyMetrics.cumulativeExpenses.toFixed(2)} RUB`);
  }

  getDailyMetrics(): DailyMetrics {
    return { ...this.dailyMetrics };
  }

  formatDailySummary(): string {
    const metrics = this.dailyMetrics;
    const profitSign = metrics.cumulativeProfit >= 0 ? '+' : '';
    const netSign = metrics.netDailyProfit >= 0 ? '+' : '';
    const profitColor = metrics.netDailyProfit >= 0 ? '🟢' : '🔴';

    let output = `\n📅 Daily Summary (${metrics.date} MSK):\n`;
    output += `  Iterations Completed: ${metrics.iterationCount}\n`;
    output += `  Cumulative Profit: ${profitSign}${metrics.cumulativeProfit.toFixed(2)} RUB\n`;
    output += `  Cumulative Expenses: ${metrics.cumulativeExpenses.toFixed(2)} RUB\n`;
    output += `  ${profitColor} Net Daily Profit: ${netSign}${metrics.netDailyProfit.toFixed(2)} RUB`;

    return output;
  }

  formatDetailedDailySummary(): string {
    const metrics = this.dailyMetrics;
    let output = this.formatDailySummary();

    if (metrics.iterationCount > 1) {
      // Calculate averages
      const avgProfit = metrics.cumulativeProfit / metrics.iterationCount;
      const avgExpense = metrics.cumulativeExpenses / metrics.iterationCount;
      const avgSign = avgProfit >= 0 ? '+' : '';

      output += `\n\n📊 Average per Iteration:\n`;
      output += `  Avg Profit: ${avgSign}${avgProfit.toFixed(2)} RUB\n`;
      output += `  Avg Expense: ${avgExpense.toFixed(2)} RUB`;
    }

    // Add time of last update
    const lastUpdateTime = metrics.lastUpdated.toLocaleTimeString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    output += `\n  Last Updated: ${lastUpdateTime} MSK`;

    return output;
  }

  // Optional: Export daily data to file for persistence
  async exportDailyData(filepath?: string): Promise<void> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');

    const dir = path.join(process.cwd(), 'profit_loss_data');

    // Create directory if it doesn't exist
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      debugDaily('Error creating profit_loss_data directory:', error);
    }

    const filename = filepath || path.join(dir, `${this.currentDay}.json`);

    try {
      await fs.writeFile(filename, JSON.stringify(this.dailyMetrics, null, 2));
      debugDaily(`Daily data exported to ${filename}`);
    } catch (error) {
      debugDaily('Error exporting daily data:', error);
    }
  }
}

// Global instance for daily aggregation
export const dailyAggregator = new DailyAggregator();