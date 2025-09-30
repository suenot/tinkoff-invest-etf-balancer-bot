import debug from 'debug';
import _ from 'lodash';
import { sleep, writeFile, convertTinkoffNumberToNumber } from '../utils';

const debugProvider = debug('bot').extend('provider');

// Преобразование типов времени из ответа API к Date
const toDate = (t: any): Date | null => {
  if (!t) return null;
  if (t instanceof Date) return t;
  if (typeof t === 'string' || typeof t === 'number') return new Date(t);
  if (typeof t === 'object') {
    const seconds = (t.seconds !== undefined ? Number(t.seconds) : (t.sec !== undefined ? Number(t.sec) : undefined));
    const nanos = (t.nanos !== undefined ? Number(t.nanos) : (t.nano !== undefined ? Number(t.nano) : 0));
    if (seconds !== undefined) {
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6));
    }
  }
  return null;
};

// Проверяет, открыта ли указанная биржа прямо сейчас по расписанию торгов
export const isExchangeOpenNow = async (exchange: string = 'MOEX', instruments?: any): Promise<boolean> => {
  try {
    const now = new Date();
    const from = new Date(now); // Use current time as 'from' parameter
    const to = new Date(now);
    to.setDate(to.getDate() + 1); // Get schedule until tomorrow

    debugProvider(`Checking trading schedule for ${exchange}. Current time: ${now.toISOString()}`);
    debugProvider(`Request params: from=${from.toISOString()}, to=${to.toISOString()}`);

    if (!instruments) {
      debugProvider('instruments SDK object not provided, assuming exchange is open');
      return true;
    }

    const schedules: any = await instruments.tradingSchedules({
      exchange,
      from,
      to,
    });

    debugProvider('Trading schedules response:', JSON.stringify(schedules, null, 2));

    const exchanges = schedules?.exchanges || schedules?.exchangesList || [];
    const first = exchanges[0];
    const days = first?.days || first?.daysList || [];

    debugProvider(`Found ${days.length} trading days in schedule`);

    // Ищем интервал(ы) сегодняшнего дня и проверяем попадание now
    for (const day of days) {
      debugProvider('Processing day:', JSON.stringify(day, null, 2));

      // В некоторых обёртках может быть date как строка/Date — но для надёжности сверяем по границам
      if (day?.isTradingDay === false) {
        debugProvider('Day is not a trading day, skipping');
        continue;
      }

      const start = toDate(day?.startTime || day?.start_time);
      const end = toDate(day?.endTime || day?.end_time);
      const eveningStart = toDate(day?.eveningStartTime || day?.evening_start_time);
      const eveningEnd = toDate(day?.eveningEndTime || day?.evening_end_time);

      debugProvider(`Session times: start=${start?.toISOString()}, end=${end?.toISOString()}`);
      debugProvider(`Evening session: start=${eveningStart?.toISOString()}, end=${eveningEnd?.toISOString()}`);

      // Основная сессия
      if (start && end && now >= start && now <= end) {
        debugProvider('Current time is within main trading session');
        return true;
      }
      // Вечерняя сессия (если есть)
      if (eveningStart && eveningEnd && now >= eveningStart && now <= eveningEnd) {
        debugProvider('Current time is within evening trading session');
        return true;
      }
    }

    debugProvider('Current time is outside all trading sessions');
    return false;
  } catch (err) {
    // In case of errors, don't block bot operation
    debugProvider('Error requesting trading schedule', err);
    return true;
  }
};

export const getLastPrice = async (figi: any, marketData?: any, accountConfig?: any) => {
  debugProvider('Getting last price');
  if (!marketData) {
    debugProvider('marketData SDK object not provided');
    return null;
  }
  let lastPriceResult;
  try {
    lastPriceResult = await marketData.getLastPrices({
      figi: [figi],
    });
    debugProvider('lastPriceResult', lastPriceResult);
  } catch (err) {
    debugProvider(err);
  }

  const lastPrice = lastPriceResult?.lastPrices?.[0]?.price;
  debugProvider('lastPrice', lastPrice);
  await sleep(accountConfig?.sleep_between_orders || 1000);
  return lastPrice;
};

export const getInstruments = async (instruments?: any, accountConfig?: any) => {
  if (!instruments) {
    debugProvider('instruments SDK object not provided');
    return;
  }

  debugProvider('Getting shares list');
  let sharesResult;
  try {
    sharesResult = await instruments.shares({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const shares = sharesResult?.instruments;
  debugProvider('shares count', shares?.length);
  (global as any).INSTRUMENTS = _.union(shares, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting ETFs list');
  let etfsResult;
  try {
    etfsResult = await instruments.etfs({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const etfs = etfsResult?.instruments;
  debugProvider('etfs count', etfs?.length);
  (global as any).INSTRUMENTS = _.union(etfs, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting bonds list');
  let bondsResult;
  try {
    bondsResult = await instruments.bonds({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const bonds = bondsResult?.instruments;
  debugProvider('bonds count', bonds?.length);
  (global as any).INSTRUMENTS = _.union(bonds, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting currencies list');
  let currenciesResult;
  try {
    currenciesResult = await instruments.currencies({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const currencies = currenciesResult?.instruments;
  debugProvider('currencies count', currencies?.length);
  (global as any).INSTRUMENTS = _.union(currencies, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('Getting futures list');
  let futuresResult;
  try {
    futuresResult = await instruments.futures({
      // instrumentStatus: InstrumentStatus.INSTRUMENT_STATUS_BASE,
    });
  } catch (err) {
    debugProvider(err);
  }
  const futures = futuresResult?.instruments;
  debugProvider('futures count', futures?.length);
  (global as any).INSTRUMENTS = _.union(futures, (global as any).INSTRUMENTS);
  await sleep(accountConfig?.sleep_between_orders || 1000);

  debugProvider('=========================');
};

export const getLastPrices = async (marketData?: any) => {
  if (!marketData) {
    debugProvider('marketData SDK object not provided');
    return;
  }
  const lastPrices = (await marketData.getLastPrices({
    figi: [],
  }))?.lastPrices;
  debugProvider('lastPrices', JSON.stringify(lastPrices, null, 2));
  const lastPricesFormatted = _.map(lastPrices, (item) => {
    if (item.price) {
      const priceNumber = convertTinkoffNumberToNumber(item.price);
      (item as any).price = priceNumber;
      debugProvider('fffff', priceNumber);
    }
    return item;
  });
  debugProvider('lastPricesFormatted', JSON.stringify(lastPricesFormatted, null, 2));
  (global as any).LAST_PRICES = lastPricesFormatted;

  writeFile(lastPricesFormatted, 'lastPrices');
};