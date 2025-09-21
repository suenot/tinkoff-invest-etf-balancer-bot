import { Position, Wallet } from '../types.d';
import { normalizeTicker } from '../utils';
import debug from 'debug';

const debugProfit = debug('bot').extend('profit');

export interface ProfitLossRecord {
  ticker: string;
  currentPositionValue: number;
  originalCost: number;
  profitAmount: number;
  profitPercentage: number;
  isMarginPosition: boolean;
}

export interface ProfitSummary {
  totalProfit: number;
  totalProfitPercentage: number;
  positionsWithProfit: number;
  positionsWithLoss: number;
  details: ProfitLossRecord[];
}

export class ProfitCalculator {
  calculateProfit(wallet: Wallet): ProfitSummary {
    const details: ProfitLossRecord[] = [];
    let totalOriginalCost = 0;
    let totalCurrentValue = 0;
    let positionsWithProfit = 0;
    let positionsWithLoss = 0;

    for (const position of wallet) {
      // Skip currencies (where base === quote)
      if (position.base === position.quote) {
        continue;
      }

      const ticker = normalizeTicker(position.base) || position.base;
      const currentPositionValue = position.totalPriceNumber || 0;

      // Calculate original cost based on FIFO price or average price
      let originalCost = 0;
      if (position.averagePositionPriceFifoNumber) {
        originalCost = position.averagePositionPriceFifoNumber * (position.amount || 0);
        debugProfit(`Using FIFO price for ${ticker}: ${position.averagePositionPriceFifoNumber}`);
      } else if (position.averagePositionPriceNumber) {
        originalCost = position.averagePositionPriceNumber * (position.amount || 0);
        debugProfit(`Using average price for ${ticker}: ${position.averagePositionPriceNumber}`);
      } else {
        // If no average price available, skip profit calculation for this position
        debugProfit(`No average price available for ${ticker}, skipping profit calculation`);
        continue;
      }

      const profitAmount = currentPositionValue - originalCost;
      const profitPercentage = originalCost > 0 ? (profitAmount / originalCost) * 100 : 0;
      const isMarginPosition = currentPositionValue < 0;

      if (profitAmount > 0) {
        positionsWithProfit++;
      } else if (profitAmount < 0) {
        positionsWithLoss++;
      }

      totalOriginalCost += originalCost;
      totalCurrentValue += currentPositionValue;

      details.push({
        ticker,
        currentPositionValue,
        originalCost,
        profitAmount,
        profitPercentage,
        isMarginPosition
      });
    }

    const totalProfit = totalCurrentValue - totalOriginalCost;
    const totalProfitPercentage = totalOriginalCost > 0 ? (totalProfit / totalOriginalCost) * 100 : 0;

    return {
      totalProfit,
      totalProfitPercentage,
      positionsWithProfit,
      positionsWithLoss,
      details
    };
  }

  formatProfitSummary(summary: ProfitSummary): string {
    const sign = summary.totalProfit >= 0 ? '+' : '';
    const profitColor = summary.totalProfit >= 0 ? '🟢' : '🔴';

    let output = `📊 Profit/Loss Summary:\n`;
    output += `  ${profitColor} Total Profit: ${sign}${summary.totalProfit.toFixed(2)} RUB (${sign}${summary.totalProfitPercentage.toFixed(2)}%)\n`;
    output += `  Positions with Profit: ${summary.positionsWithProfit}\n`;
    output += `  Positions with Loss: ${summary.positionsWithLoss}`;

    return output;
  }

  formatDetailedProfit(summary: ProfitSummary): string {
    let output = `\n📊 Detailed Profit/Loss by Position:\n`;

    // Sort by profit amount descending
    const sortedDetails = [...summary.details].sort((a, b) => b.profitAmount - a.profitAmount);

    for (const detail of sortedDetails) {
      const sign = detail.profitAmount >= 0 ? '+' : '';
      const emoji = detail.profitAmount >= 0 ? '📈' : '📉';
      output += `  ${emoji} ${detail.ticker}: ${sign}${detail.profitAmount.toFixed(2)} RUB (${sign}${detail.profitPercentage.toFixed(2)}%)`;
      if (detail.isMarginPosition) {
        output += ' [MARGIN]';
      }
      output += '\n';
    }

    return output;
  }
}