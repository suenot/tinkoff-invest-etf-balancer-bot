import _ from 'lodash';
import { Wallet } from '../types.d';
import { normalizeTicker } from '../utils';

/**
 * Filters out frozen (blocked) assets from the wallet
 * @param wallet - array of portfolio positions
 * @returns wallet with only available (non-frozen) assets
 */
export const filterFrozenAssets = (wallet: Wallet): Wallet => {
  return wallet.filter(position => !position.blocked);
};

/**
 * Calculates the total value of available (non-frozen) assets
 * @param wallet - array of portfolio positions
 * @returns total value of available assets in RUB
 */
export const calculateAvailablePortfolioValue = (wallet: Wallet): number => {
  const availableWallet = filterFrozenAssets(wallet);
  return _.sumBy(availableWallet, 'totalPriceNumber');
};

/**
 * Рассчитывает доли каждого инструмента в портфеле
 * @param wallet - массив позиций портфеля
 * @param includeBlocked - включать заблокированные позиции в расчет (по умолчанию false)
 * @returns объект с тикерами и их долями в процентах
 */
export const calculatePortfolioShares = (wallet: Wallet, includeBlocked: boolean = false): Record<string, number> => {
  // Исключаем валюты (позиции где base === quote)
  let securities = wallet.filter(p => p.base !== p.quote);

  // Filter out frozen assets unless explicitly requested to include them
  if (!includeBlocked) {
    securities = filterFrozenAssets(securities);
  }

  const totalValue = _.sumBy(securities, 'totalPriceNumber');

  if (totalValue <= 0) return {};

  const shares: Record<string, number> = {};
  for (const position of securities) {
    if (position.base && position.totalPriceNumber) {
      const ticker = normalizeTicker(position.base) || position.base;
      shares[ticker] = (position.totalPriceNumber / totalValue) * 100;
    }
  }
  return shares;
};