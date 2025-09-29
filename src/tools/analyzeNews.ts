import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { configLoader } from '../configLoader';

dotenv.config();

type Nullable<T> = T | null | undefined;

const LOG_PREFIX = '[analyzeNews]';
const DEFAULT_SYMBOL = 'TRUR';
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function getNewsDir(symbol: string): string {
  return path.resolve(process.cwd(), 'news', symbol);
}

function getMetaDir(symbol: string): string {
  return path.resolve(process.cwd(), 'news_meta', symbol);
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function listNewsMdFiles(symbol: string): Promise<string[]> {
  const dir = getNewsDir(symbol);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join(dir, f))
      .sort();
  } catch (e) {
    return [];
  }
}

function getIdFromFilename(filePath: string): string {
  return path.basename(filePath, '.md');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getCacheConfig() {
  try {
    const config = configLoader.loadConfig();
    const defaultConfig = { enabled: true, ttl_hours: 168 }; // 7 days default
    return config.analysis?.openrouter?.cache || defaultConfig;
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed to load cache config, using defaults:`, error);
    return { enabled: true, ttl_hours: 168 };
  }
}

interface CacheEntry {
  cached_at: string;
  cache_ttl_hours: number;
  [key: string]: any;
}

async function isCacheValid(filePath: string): Promise<{ isValid: boolean; reason: string }> {
  const cacheConfig = getCacheConfig();

  if (!cacheConfig.enabled) {
    return { isValid: false, reason: 'cache-disabled' };
  }

  if (!(await fileExists(filePath))) {
    return { isValid: false, reason: 'cache-not-exists' };
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const cacheEntry: CacheEntry = JSON.parse(content);

    if (!cacheEntry.cached_at) {
      return { isValid: false, reason: 'cache-no-timestamp' };
    }

    const cachedAt = new Date(cacheEntry.cached_at);
    const now = new Date();
    const ageHours = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60);
    const ttlHours = cacheEntry.cache_ttl_hours || cacheConfig.ttl_hours;

    if (ageHours > ttlHours) {
      return { isValid: false, reason: 'cache-expired' };
    }

    return { isValid: true, reason: 'cache-valid' };
  } catch (error) {
    return { isValid: false, reason: 'cache-corrupted' };
  }
}

function addCacheMetadata(analysisResult: any): CacheEntry {
  const cacheConfig = getCacheConfig();
  return {
    ...analysisResult,
    cached_at: new Date().toISOString(),
    cache_ttl_hours: cacheConfig.ttl_hours
  };
}

function buildPrompt(content: string, id: string, symbol: string): string {
  return [
    `You are an experienced financial analyst. Analyze the news about fund ${symbol}.`,
    'Return strictly JSON without explanations. Fields:',
    '{',
    '  "id": string,                                   // news identifier',
    '  "symbol": string,                               // fund ticker',
    '  "title": string,                                // title',
    '  "date": string,                                 // date from news as is',
    '  "category": string,                             // type: rebalancing|dividends|share redemption|other',
    '  "summary": string,                              // brief content in 1-3 sentences',
    '  "bullets": string[],                            // key points (3-8)',
    '  "trades": [                                     // if there is a trades table',
    '    { "ticker": string, "name": string, "side": "Buy"|"Sell", "qty": string, "amount": string, "weightFrom": string|null, "weightTo": string|null }',
    '  ],',
    '  "additionalFields": { [name: string]: string },  // for example: Share redemption date, Redeemed shares, Amount, Total shares, Share price',
    '  "numbers": {                                     // normalized numbers if can be extracted',
    '    "redeemedShares": number|null,                 // units, without suffixes',
    '    "redeemedAmountRub": number|null,              // ₽',
    '    "totalShares": number|null,                    // units',
    '    "navPriceRub": number|null                     // ₽',
    '  }',
    '}',
    '',
    'News text below between <news>...</news>. Preserve original string formats in summary/fields, but make numbers in numbers numeric.',
    `<news id="${id}" symbol="${symbol}">\n${content}\n</news>`,
  ].join('\n');
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';
  const base = process.env.OPENROUTER_BASE || DEFAULT_OPENROUTER_BASE;
  return { apiKey, model, base };
}

async function callOpenRouter(prompt: string): Promise<string> {
  const { apiKey, model, base } = getOpenRouterConfig();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Please set it in .env');
  }
  const url = `${base}/chat/completions`;
  const body: any = {
    model,
    messages: [
      { role: 'system', content: 'Return only valid JSON. No comments. No markdown.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/suenot/deep-tinkoff-invest-api',
      'X-Title': 'tinkoff-invest-etf-balancer-bot',
    } as any,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }
  const data: any = await res.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  return content;
}

function tryExtractJson(text: string): any {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  throw new Error('Failed to parse JSON from model response');
}

async function analyzeFile(symbol: string, filePath: string, outDir: string): Promise<string | null> {
  const id = getIdFromFilename(filePath);
  const outPath = path.join(outDir, `${id}.json`);

  // Check cache validity
  const cacheStatus = await isCacheValid(outPath);

  if (cacheStatus.isValid) {
    console.log(`${LOG_PREFIX} skip existing ${symbol}/${id}.json (reason: skipped-by-cache)`);
    return null;
  }

  // Cache is invalid or doesn't exist, fetch from LLM
  const content = await fs.readFile(filePath, 'utf-8');
  const prompt = buildPrompt(content, id, symbol);
  console.log(`${LOG_PREFIX} analyze ${symbol}/${id} via OpenRouter (reason: fetched-via-llm)`);

  const raw = await callOpenRouter(prompt);
  const json = tryExtractJson(raw);

  // Add cache metadata
  const cacheEntry = addCacheMetadata(json);

  await ensureDir(outDir);
  await fs.writeFile(outPath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
  console.log(`${LOG_PREFIX} saved ${outPath}`);
  return outPath;
}

async function analyzeForSymbol(symbol: string, opts: { onlyId: Nullable<string>; limit: Nullable<number>; onlyNew: boolean }): Promise<void> {
  const newsFiles = await listNewsMdFiles(symbol);
  if (newsFiles.length === 0) {
    console.log(`${LOG_PREFIX} no news markdown files found at ${getNewsDir(symbol)}`);
    return;
  }

  let selected = newsFiles;
  if (opts.onlyId) {
    selected = newsFiles.filter((f) => getIdFromFilename(f) === opts.onlyId);
  }
  if (opts.limit && selected.length > (opts.limit || 0)) {
    selected = selected.slice(0, opts.limit || selected.length);
  }

  const outDir = getMetaDir(symbol);
  await ensureDir(outDir);

  if (opts.onlyNew) {
    const filtered: string[] = [];
    for (const f of selected) {
      const id = getIdFromFilename(f);
      const outPath = path.join(outDir, `${id}.json`);
      const cacheStatus = await isCacheValid(outPath);
      if (!cacheStatus.isValid) {
        filtered.push(f);
      }
    }
    selected = filtered;
  }

  console.log(`${LOG_PREFIX} symbol=${symbol} total=${newsFiles.length} toAnalyze=${selected.length}`);
  for (const f of selected) {
    try {
      await analyzeFile(symbol, f, outDir);
    } catch (e) {
      console.error(`${LOG_PREFIX} error analyzing ${f}:`, e);
    }
  }
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  const rawSymbols = (argv[0] || DEFAULT_SYMBOL).toUpperCase();
  const symbols = rawSymbols.split(',').map((s) => s.trim()).filter(Boolean);
  let onlyId: Nullable<string> = null;
  let limit: Nullable<number> = null;
  let onlyNew = true;
  const runOnce = argv.includes('--once');
  const intervalArg = argv.find((a) => a.startsWith('--interval='));
  const intervalMs = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 300000; // 5мин по умолчанию
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--id=')) { onlyId = arg.slice('--id='.length); }
    else if (arg.startsWith('--limit=')) { limit = parseInt(arg.slice('--limit='.length), 10); }
    else if (arg === '--all') { onlyNew = false; }
  }

  const iterate = async () => {
    for (const sym of symbols) {
      await analyzeForSymbol(sym, { onlyId, limit, onlyNew });
    }
  };

  if (runOnce) {
    await iterate();
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`${LOG_PREFIX} entering loop intervalMs=${intervalMs}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await iterate();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`${LOG_PREFIX} iteration error:`, e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


