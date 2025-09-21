import { DesiredWallet, DiffMode, AccountConfig } from '../types.d';
import { diffManager } from './diffManager';
import { buildDesiredWalletByMode } from './desiredBuilder';
import { TinkoffInvestApiSingleton } from '../provider';

const debug = require('debug')('bot').extend('diffCalculator');

export interface DiffCalculationResult {
  adjustedWallet: DesiredWallet;
  diffPercentages: Record<string, number>;
  referenceWallet: DesiredWallet | null;
  appliedMultiplier: number;
}

/**
 * Calculates the percentage difference between two wallet allocations
 */
function calculateDiffPercentages(
  currentWallet: DesiredWallet,
  referenceWallet: DesiredWallet
): Record<string, number> {
  const diffPercentages: Record<string, number> = {};

  // Get all unique tickers from both wallets
  const allTickers = new Set([
    ...Object.keys(currentWallet),
    ...Object.keys(referenceWallet)
  ]);

  for (const ticker of allTickers) {
    const currentWeight = currentWallet[ticker] || 0;
    const referenceWeight = referenceWallet[ticker] || 0;

    // Calculate percentage difference
    // If reference is 0, use absolute difference
    if (referenceWeight === 0) {
      diffPercentages[ticker] = currentWeight;
    } else {
      diffPercentages[ticker] = ((currentWeight - referenceWeight) / referenceWeight) * 100;
    }

    debug(`Diff for ${ticker}: current=${currentWeight.toFixed(2)}%, reference=${referenceWeight.toFixed(2)}%, diff=${diffPercentages[ticker].toFixed(2)}%`);
  }

  return diffPercentages;
}

/**
 * Applies the diff multiplier to adjust wallet weights
 */
function applyDiffMultiplier(
  baseWallet: DesiredWallet,
  diffPercentages: Record<string, number>,
  multiplier: number
): DesiredWallet {
  const adjustedWallet: DesiredWallet = {};

  // Apply multiplier to each ticker's weight
  for (const ticker of Object.keys(baseWallet)) {
    const baseWeight = baseWallet[ticker];
    const diffPct = diffPercentages[ticker] || 0;

    // Apply the diff with multiplier
    // Formula: adjusted_weight = base_weight + (diff_percentage * multiplier / 100)
    const adjustment = (diffPct * multiplier) / 100;
    const adjustedWeight = baseWeight + adjustment;

    // Ensure weight doesn't go negative
    adjustedWallet[ticker] = Math.max(0, adjustedWeight);

    debug(`Adjusting ${ticker}: base=${baseWeight.toFixed(2)}%, diff=${diffPct.toFixed(2)}%, adjustment=${adjustment.toFixed(2)}%, final=${adjustedWallet[ticker].toFixed(2)}%`);
  }

  return adjustedWallet;
}

/**
 * Normalizes wallet weights to sum to 100%
 */
function normalizeWallet(wallet: DesiredWallet): DesiredWallet {
  const normalizedWallet: DesiredWallet = {};

  // Calculate total weight
  const totalWeight = Object.values(wallet).reduce((sum, weight) => sum + weight, 0);

  if (totalWeight === 0) {
    debug('Warning: Total weight is 0, returning equal distribution');
    const tickerCount = Object.keys(wallet).length;
    for (const ticker of Object.keys(wallet)) {
      normalizedWallet[ticker] = 100 / tickerCount;
    }
    return normalizedWallet;
  }

  // Normalize each weight
  for (const ticker of Object.keys(wallet)) {
    normalizedWallet[ticker] = (wallet[ticker] / totalWeight) * 100;
    debug(`Normalized ${ticker}: ${wallet[ticker].toFixed(2)}% -> ${normalizedWallet[ticker].toFixed(2)}%`);
  }

  return normalizedWallet;
}

/**
 * Fetches historical prices at 00:00 for calculating day mode reference
 */
async function fetchHistoricalWalletAt00(
  accountConfig: AccountConfig
): Promise<DesiredWallet | null> {
  debug(`Fetching historical prices at 00:00 for account ${accountConfig.id}`);

  try {
    // Get the start of today (00:00)
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

    // Initialize API singleton
    const api = TinkoffInvestApiSingleton.getInstance(accountConfig.t_invest_token);

    // Get instruments from desired wallet
    const tickers = Object.keys(accountConfig.desired_wallet);
    const historicalPrices: Record<string, number> = {};

    // Fetch historical prices for each ticker
    for (const ticker of tickers) {
      try {
        // Note: This is a simplified implementation.
        // The actual implementation would need to:
        // 1. Convert ticker to FIGI
        // 2. Use getCandles or similar API to get price at 00:00
        // 3. Handle different instrument types (ETFs, shares, etc.)

        // For now, we'll return null to indicate we need the API implementation
        debug(`Would fetch historical price for ${ticker} at ${startOfDay.toISOString()}`);

        // Placeholder - in real implementation, would call API here
        // const candles = await api.marketdata.getCandles({
        //   figi: tickerToFigi(ticker),
        //   from: startOfDay,
        //   to: new Date(startOfDay.getTime() + 60000), // 1 minute after
        //   interval: CandleInterval.CANDLE_INTERVAL_1_MIN
        // });

      } catch (error) {
        debug(`Error fetching historical price for ${ticker}: ${error}`);
      }
    }

    // For now, return null since we need proper API integration
    debug('Historical price fetching not fully implemented yet');
    return null;

  } catch (error) {
    debug(`Error fetching historical wallet at 00:00: ${error}`);
    return null;
  }
}

/**
 * Main function to calculate and apply diff to desired wallet
 */
export async function calculateDiffAdjustedWallet(
  accountConfig: AccountConfig,
  baseDesiredWallet: DesiredWallet
): Promise<DiffCalculationResult> {
  // If diff is disabled, return base wallet
  if (!accountConfig.diff || accountConfig.diff === 'off') {
    debug(`Diff is disabled for account ${accountConfig.id}`);
    return {
      adjustedWallet: baseDesiredWallet,
      diffPercentages: {},
      referenceWallet: null,
      appliedMultiplier: 0
    };
  }

  const diffMode = accountConfig.diff;
  const multiplier = accountConfig.diff_multiplier || 0;

  debug(`Calculating diff for account ${accountConfig.id} with mode=${diffMode}, multiplier=${multiplier}%`);

  // Get reference snapshot
  let referenceWallet = await diffManager.getReferenceSnapshot(accountConfig.id, diffMode);

  // If day mode and no 00:00 snapshot exists, fetch historical data
  if (diffMode === 'day' && !referenceWallet) {
    debug('No 00:00 snapshot found, attempting to fetch historical data');

    // Try to calculate wallet using historical prices at 00:00
    const historicalWallet = await fetchHistoricalWalletAt00(accountConfig);

    if (historicalWallet) {
      // Store this as the 00:00 snapshot for future use
      await diffManager.storeSnapshot(accountConfig.id, historicalWallet, 'day');
      referenceWallet = historicalWallet;
    } else {
      // If we couldn't get historical data, fall back to using current as baseline
      debug('Could not fetch historical data, using current wallet as baseline');
      await diffManager.storeSnapshot(accountConfig.id, baseDesiredWallet, 'day');
      return {
        adjustedWallet: baseDesiredWallet,
        diffPercentages: {},
        referenceWallet: null,
        appliedMultiplier: 0
      };
    }
  }

  // If no reference wallet available, use current as baseline
  if (!referenceWallet) {
    debug(`No reference wallet available for ${diffMode} mode, using current as baseline`);
    await diffManager.storeSnapshot(accountConfig.id, baseDesiredWallet,
      diffMode === 'iteration' ? 'iteration' : 'day');
    return {
      adjustedWallet: baseDesiredWallet,
      diffPercentages: {},
      referenceWallet: null,
      appliedMultiplier: 0
    };
  }

  // Calculate differences
  const diffPercentages = calculateDiffPercentages(baseDesiredWallet, referenceWallet);

  // Apply multiplier
  const adjustedWallet = applyDiffMultiplier(baseDesiredWallet, diffPercentages, multiplier);

  // Normalize to ensure weights sum to 100%
  const normalizedWallet = normalizeWallet(adjustedWallet);

  // Store current snapshot for next iteration (if iteration mode)
  if (diffMode === 'iteration') {
    await diffManager.storeSnapshot(accountConfig.id, baseDesiredWallet, 'iteration');
  }

  debug(`Diff calculation complete for account ${accountConfig.id}`);

  return {
    adjustedWallet: normalizedWallet,
    diffPercentages,
    referenceWallet,
    appliedMultiplier: multiplier
  };
}