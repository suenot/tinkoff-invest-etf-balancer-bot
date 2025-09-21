import path from 'path';
import { promises as fs } from 'fs';
import _ from 'lodash';
import { DesiredWallet, DesiredMode, PositionMetrics, BalancingDataError, AccountConfig } from '../types.d';
import { normalizeTicker } from '../utils';
import { getEtfMarketCapRUB } from '../tools/etfCap';
import { getShareMarketCapRUB } from '../tools/shareCap';
import { buildAumMapSmart } from '../tools/etfCap';
import { toRubFromAum } from '../tools/pollEtfMetrics';
import { calculateDiffAdjustedWallet } from './diffCalculator';

const debug = require('debug')('bot').extend('desiredBuilder');
const debugModeSelection = require('debug')('bot').extend('desiredBuilder:mode-selection');
const debugMetrics = require('debug')('bot').extend('desiredBuilder:metrics');

interface Metric {
  marketCap?: number | null;
  aum?: number | null;
}

interface ValidationResult {
  isValid: boolean;
  missingData: string[];
  affectedTickers: string[];
  details: string;
}

/**
 * Validates data quality for mode-specific requirements
 */
const validateModeData = (mode: DesiredMode, metricsByTicker: Record<string, Metric>, tickers: string[]): ValidationResult => {
  const missingData: string[] = [];
  const affectedTickers: string[] = [];
  
  debugModeSelection(`Validating data for mode: ${mode}`);
  
  switch (mode) {
    case 'marketcap': {
      const invalidTickers = tickers.filter(ticker => {
        const metric = metricsByTicker[ticker];
        const isValid = metric?.marketCap && Number.isFinite(metric.marketCap) && metric.marketCap > 0;
        if (!isValid) {
          debugModeSelection(`Invalid market cap data for ${ticker}: ${metric?.marketCap}`);
        }
        return !isValid;
      });
      
      if (invalidTickers.length > 0) {
        missingData.push('market cap');
        affectedTickers.push(...invalidTickers);
      }
      break;
    }
    
    case 'aum': {
      const invalidTickers = tickers.filter(ticker => {
        const metric = metricsByTicker[ticker];
        const isValid = metric?.aum && Number.isFinite(metric.aum) && metric.aum > 0;
        if (!isValid) {
          debugModeSelection(`Invalid AUM data for ${ticker}: ${metric?.aum}`);
        }
        return !isValid;
      });
      
      if (invalidTickers.length > 0) {
        missingData.push('AUM');
        affectedTickers.push(...invalidTickers);
      }
      break;
    }
    
    case 'marketcap_aum': {
      const invalidTickers = tickers.filter(ticker => {
        const metric = metricsByTicker[ticker];
        const hasValidMarketCap = metric?.marketCap && Number.isFinite(metric.marketCap) && metric.marketCap > 0;
        const hasValidAum = metric?.aum && Number.isFinite(metric.aum) && metric.aum > 0;
        const isValid = hasValidMarketCap || hasValidAum;
        if (!isValid) {
          debugModeSelection(`No valid market cap or AUM data for ${ticker}: mc=${metric?.marketCap}, aum=${metric?.aum}`);
        }
        return !isValid;
      });
      
      if (invalidTickers.length > 0) {
        missingData.push('market cap or AUM');
        affectedTickers.push(...invalidTickers);
      }
      break;
    }
    
    case 'decorrelation': {
      const invalidTickers = tickers.filter(ticker => {
        const metric = metricsByTicker[ticker];
        const hasValidMarketCap = metric?.marketCap && Number.isFinite(metric.marketCap) && metric.marketCap > 0;
        const hasValidAum = metric?.aum && Number.isFinite(metric.aum) && metric.aum > 0;
        const isValid = hasValidMarketCap && hasValidAum;
        if (!isValid) {
          debugModeSelection(`Incomplete decorrelation data for ${ticker}: mc=${metric?.marketCap}, aum=${metric?.aum}`);
        }
        return !isValid;
      });
      
      if (invalidTickers.length > 0) {
        missingData.push('both market cap and AUM');
        affectedTickers.push(...invalidTickers);
      }
      break;
    }
  }
  
  const isValid = affectedTickers.length === 0;
  const details = isValid 
    ? `All data valid for ${mode} mode` 
    : `Missing ${missingData.join(', ')} for tickers: ${affectedTickers.join(', ')}`;
    
  debugModeSelection(`Validation result: ${isValid ? 'PASSED' : 'FAILED'} - ${details}`);
  
  return {
    isValid,
    missingData,
    affectedTickers,
    details
  };
};

export const buildDesiredWalletByMode = async (mode: DesiredMode, baseDesired: DesiredWallet): Promise<{
  wallet: DesiredWallet;
  metrics: PositionMetrics[];
  modeApplied: DesiredMode;
}> => {
  debugModeSelection(`Building desired wallet with mode: ${mode}`);
  
  if (mode === 'manual' || mode === 'default') {
    debugModeSelection('Using manual/default mode, returning baseDesired as-is');
    return {
      wallet: baseDesired,
      metrics: [],
      modeApplied: mode
    };
  }

  const originalTickers = Object.keys(baseDesired);
  const normalizedTickers = originalTickers.map((t) => normalizeTicker(t) || t);
  
  debugModeSelection(`Processing tickers: ${normalizedTickers.join(', ')}`);

  // Gather metrics in RUB per normalized ticker
  const metricByNormalized: Record<string, Metric> = {};

  const metricsDir = path.resolve(process.cwd(), 'etf_metrics');

  const readMetricFromJson = async (ticker: string): Promise<{ marketCap?: number | null; aum?: number | null } | null> => {
    try {
      const p = path.join(metricsDir, `${ticker}.json`);
      debugMetrics(`Attempting to read JSON file: ${p}`);
      const raw = await fs.readFile(p, 'utf-8');
      const j = JSON.parse(raw);
      const result = { marketCap: typeof j?.marketCap === 'number' ? j.marketCap : null, aum: typeof j?.aum === 'number' ? j.aum : null };
      debugMetrics(`JSON data for ${ticker}:`, result);
      return result;
    } catch (error) {
      debugMetrics(`Failed to read JSON file for ${ticker}: ${error}`);
      return null;
    }
  };

  const calcMarketcap = async (nt: string): Promise<number | null> => {
    debugMetrics(`Calculating market cap for ${nt}`);
    // 1) local JSON, 2) live for ETF, 3) live for shares
    const json = await readMetricFromJson(nt);
    if (json && typeof json.marketCap === 'number' && Number.isFinite(json.marketCap) && json.marketCap > 0) {
      debugMetrics(`Found market cap in JSON for ${nt}: ${json.marketCap}`);
      return json.marketCap;
    }
    const etfCap = await getEtfMarketCapRUB(nt);
    if (etfCap?.marketCapRUB) {
      const value = Number(etfCap.marketCapRUB) || 0;
      if (value > 0) {
        debugMetrics(`Found ETF market cap for ${nt}: ${value}`);
        return value;
      }
    }
    const shareCap = await getShareMarketCapRUB(nt);
    if (shareCap?.marketCapRUB) {
      const value = Number(shareCap.marketCapRUB) || 0;
      if (value > 0) {
        debugMetrics(`Found share market cap for ${nt}: ${value}`);
        return value;
      }
    }
    debugMetrics(`No valid market cap found for ${nt}`);
    return null;
  };

  const calcAumRub = async (nt: string): Promise<number | null> => {
    debugMetrics(`Calculating AUM for ${nt}`);
    // 1) local JSON, 2) live via T-Capital + FX
    const json = await readMetricFromJson(nt);
    if (json && typeof json.aum === 'number' && Number.isFinite(json.aum) && json.aum > 0) {
      debugMetrics(`Found AUM in JSON for ${nt}: ${json.aum}`);
      return json.aum;
    }
    const aumMap = await buildAumMapSmart([nt]);
    const value = await toRubFromAum(aumMap[nt]);
    debugMetrics(`Calculated live AUM for ${nt}: ${value}`);
    return value && value > 0 ? value : null;
  };

  // Collect all metrics first
  for (const nt of normalizedTickers) {
    const marketCap = await calcMarketcap(nt);
    const aum = await calcAumRub(nt);
    metricByNormalized[nt] = { marketCap, aum };
    debugMetrics(`Collected metrics for ${nt}: marketCap=${marketCap}, aum=${aum}`);
  }

  // Validate data based on mode requirements
  const validation = validateModeData(mode, metricByNormalized, normalizedTickers);
  
  if (!validation.isValid) {
    debugModeSelection(`Data validation failed: ${validation.details}`);
    throw new BalancingDataError(mode, validation.missingData, validation.affectedTickers);
  }

  // Calculate weights based on mode
  let weights: Record<string, number> = {};
  let positionMetrics: PositionMetrics[] = [];

  if (mode === 'marketcap' || mode === 'aum' || mode === 'marketcap_aum') {
    for (const nt of normalizedTickers) {
      let metric = 0;
      if (mode === 'marketcap') {
        metric = metricByNormalized[nt].marketCap || 0;
      } else if (mode === 'aum') {
        metric = metricByNormalized[nt].aum || 0;
      } else if (mode === 'marketcap_aum') {
        const marketCap = metricByNormalized[nt].marketCap;
        const aum = metricByNormalized[nt].aum;
        // Use market cap if available, otherwise use AUM
        metric = (marketCap && marketCap > 0) ? marketCap : (aum && aum > 0) ? aum : 0;
      }
      weights[nt] = Number(metric) || 0;
    }
  }

  if (mode === 'decorrelation') {
    debugModeSelection('Calculating decorrelation weights');
    // Algorithm:
    // 1) decorrelationPct = (marketCap - AUM) / AUM * 100 (can be negative or positive)
    // 2) Find max among all decorrelationPct
    // 3) Build distribution metric: metric = max - decorrelationPct
    //    Example: [100, 0, -100] -> max=100 -> metrics=[0, 100, 200]
    // 4) Weights ∝ metric. If sum == 0 — throw error

    const dPctByTicker: Record<string, number> = {};
    for (const nt of normalizedTickers) {
      const mcap = metricByNormalized[nt].marketCap || 0;
      const aum = metricByNormalized[nt].aum || 0;
      const dPct = aum > 0 && Number.isFinite(mcap) ? ((mcap - aum) / aum) * 100 : 0;
      dPctByTicker[nt] = Number.isFinite(dPct) ? dPct : 0;
      debugModeSelection(`Decorrelation for ${nt}: ${dPct.toFixed(2)}% (mcap=${mcap}, aum=${aum})`);
    }
    const maxDPct = _.max(Object.values(dPctByTicker));
    const maxVal = (typeof maxDPct === 'number' && Number.isFinite(maxDPct)) ? maxDPct : 0;
    for (const nt of normalizedTickers) {
      const m = maxVal - (dPctByTicker[nt] || 0);
      weights[nt] = Number.isFinite(m) && m > 0 ? m : 0;
    }
  }

  // Calculate total for normalization
  const totalMetric = _.sum(Object.values(weights));
  if (!totalMetric || !Number.isFinite(totalMetric) || totalMetric <= 0) {
    debugModeSelection('Total metric is zero after calculation, this indicates a data quality issue');
    throw new BalancingDataError(mode, ['valid positive metrics'], normalizedTickers);
  }

  // Build position metrics for enhanced result
  const totalMarketCap = _.sum(normalizedTickers.map(nt => metricByNormalized[nt].marketCap || 0));
  const totalAum = _.sum(normalizedTickers.map(nt => metricByNormalized[nt].aum || 0));

  for (const nt of normalizedTickers) {
    const metric = metricByNormalized[nt];
    const positionMetric: PositionMetrics = {
      ticker: nt
    };

    if (metric.marketCap && totalMarketCap > 0) {
      positionMetric.marketCap = {
        value: metric.marketCap,
        percentage: (metric.marketCap / totalMarketCap) * 100
      };
    }

    if (metric.aum && totalAum > 0) {
      positionMetric.aum = {
        value: metric.aum,
        percentage: (metric.aum / totalAum) * 100
      };
    }

    if (metric.marketCap && metric.aum && metric.aum > 0) {
      const decorrelationPct = ((metric.marketCap - metric.aum) / metric.aum) * 100;
      positionMetric.decorrelation = {
        value: decorrelationPct,
        interpretation: decorrelationPct > 5 ? 'overvalued' : decorrelationPct < -5 ? 'undervalued' : 'neutral'
      };
    }

    positionMetrics.push(positionMetric);
  }

  // Map back to original keys to preserve user-specified tickers; use normalized for lookup
  const result: DesiredWallet = {};
  for (const orig of originalTickers) {
    const nt = normalizeTicker(orig) || orig;
    const m = weights[nt] || 0;
    // Convert to percents; exact normalization will be done in balancer as well
    result[orig] = (m / totalMetric) * 100;
  }
  
  debugModeSelection(`Successfully calculated weights for mode ${mode}:`, result);
  
  return {
    wallet: result,
    metrics: positionMetrics,
    modeApplied: mode
  };
};

/**
 * Builds desired wallet with diff adjustment if configured
 */
export const buildDesiredWalletWithDiff = async (
  accountConfig: AccountConfig
): Promise<{
  wallet: DesiredWallet;
  metrics: PositionMetrics[];
  modeApplied: DesiredMode;
  diffApplied: boolean;
  diffInfo?: {
    diffPercentages: Record<string, number>;
    referenceWallet: DesiredWallet | null;
    appliedMultiplier: number;
  };
}> => {
  debugModeSelection(`Building desired wallet for account ${accountConfig.id} with mode=${accountConfig.desired_mode}, diff=${accountConfig.diff}`);

  // Step 1: Build base desired wallet using existing mode
  const { wallet: baseWallet, metrics, modeApplied } = await buildDesiredWalletByMode(
    accountConfig.desired_mode,
    accountConfig.desired_wallet
  );

  // Step 2: Apply diff adjustment if configured
  if (accountConfig.diff && accountConfig.diff !== 'off') {
    debugModeSelection(`Applying diff adjustment with mode=${accountConfig.diff}, multiplier=${accountConfig.diff_multiplier}%`);

    const diffResult = await calculateDiffAdjustedWallet(accountConfig, baseWallet);

    return {
      wallet: diffResult.adjustedWallet,
      metrics,
      modeApplied,
      diffApplied: true,
      diffInfo: {
        diffPercentages: diffResult.diffPercentages,
        referenceWallet: diffResult.referenceWallet,
        appliedMultiplier: diffResult.appliedMultiplier
      }
    };
  }

  // No diff adjustment needed
  return {
    wallet: baseWallet,
    metrics,
    modeApplied,
    diffApplied: false
  };
};


