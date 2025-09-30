import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  HybridNewsAnalysis,
  createNewsContent,
  ProcessingMethod,
  HybridConfig
} from './hybridNewsAnalysis';
import { llmLogger, llmMetricsCollector, TokenUsage } from '../llmLogger';

dotenv.config();

type Nullable<T> = T | null | undefined;

const LOG_PREFIX = '[analyzeNews]';
const DEFAULT_SYMBOL = 'TRUR';
const DEFAULT_OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Create hybrid analysis instance
const hybridConfig: Partial<HybridConfig> = {
  enabled: process.env.HYBRID_ANALYSIS_ENABLED !== 'false', // Default to enabled
  llmFallback: {
    enabled: process.env.HYBRID_LLM_FALLBACK_ENABLED === 'true', // Default to disabled for backward compatibility
    confidenceThreshold: parseFloat(process.env.HYBRID_LLM_CONFIDENCE_THRESHOLD || '0.7'),
    maxRetries: parseInt(process.env.HYBRID_LLM_MAX_RETRIES || '3'),
    timeoutMs: parseInt(process.env.HYBRID_LLM_TIMEOUT_MS || '30000')
  },
  monitoring: {
    enabled: process.env.HYBRID_MONITORING_ENABLED !== 'false',
    logLevel: (process.env.HYBRID_LOG_LEVEL as any) || 'info'
  }
};

const hybridAnalysis = new HybridNewsAnalysis(hybridConfig);

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

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token for English text
  // This is a simplified estimation, real tokenization varies by model
  return Math.ceil(text.length / 4);
}

function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  // Simplified cost estimation for common models
  // Real pricing should be fetched from OpenRouter API or configuration
  const pricing: Record<string, { input: number; output: number }> = {
    'openrouter/auto': { input: 0.000002, output: 0.000006 }, // Average pricing
    'anthropic/claude-3-haiku': { input: 0.00000025, output: 0.00000125 },
    'anthropic/claude-3-sonnet': { input: 0.000003, output: 0.000015 },
    'openai/gpt-4o-mini': { input: 0.00000015, output: 0.0000006 },
    'openai/gpt-4o': { input: 0.000005, output: 0.000015 },
    'meta-llama/llama-3.1-8b-instruct': { input: 0.0000001, output: 0.0000001 },
  };

  const modelPricing = pricing[model] || pricing['openrouter/auto'];
  return (inputTokens * modelPricing.input) + (outputTokens * modelPricing.output);
}

function parseTokenUsageFromResponse(data: any): TokenUsage | undefined {
  // Try to extract token usage from OpenRouter response
  const usage = data?.usage;
  if (usage && typeof usage.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens)
    };
  }
  return undefined;
}

async function callOpenRouter(prompt: string): Promise<string> {
  const { apiKey, model, base } = getOpenRouterConfig();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Please set it in .env');
  }

  // Start logging the LLM call
  const promptLength = prompt.length;
  const requestId = llmLogger.logCallStarted(model, promptLength);

  try {
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
      const error = new Error(`OpenRouter error ${res.status}: ${text}`);
      llmLogger.logCallError(requestId, error);

      // Add error event to metrics collector
      const errorEvent = {
        eventType: 'llm.call_error' as const,
        timestamp: new Date(),
        requestId,
        model,
        error: error.message,
        errorType: res.status === 429 ? 'rate_limiting' : res.status >= 500 ? 'server_error' : 'api_error'
      };
      llmMetricsCollector.addEvent(errorEvent);

      throw error;
    }

    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content || '';

    // Extract token usage and calculate cost
    const tokenUsage = parseTokenUsageFromResponse(data);
    let estimatedCost = 0;

    if (tokenUsage) {
      estimatedCost = estimateCost(tokenUsage.inputTokens, tokenUsage.outputTokens, model);
    } else {
      // Fallback estimation if no token usage data from API
      const estimatedInputTokens = estimateTokens(prompt);
      const estimatedOutputTokens = estimateTokens(content);
      estimatedCost = estimateCost(estimatedInputTokens, estimatedOutputTokens, model);
    }

    // Log successful call
    llmLogger.logCallSuccess(requestId, content.length, tokenUsage, estimatedCost);

    // Add success event to metrics collector
    const successEvent = {
      eventType: 'llm.call_success' as const,
      timestamp: new Date(),
      requestId,
      model,
      duration: undefined, // Will be calculated by logger
      tokenUsage,
      estimatedCost,
      responseLength: content.length
    };
    llmMetricsCollector.addEvent(successEvent);

    return content;

  } catch (error) {
    // If error wasn't already logged (e.g., network error), log it
    if (error instanceof Error && !error.message.includes('OpenRouter error')) {
      llmLogger.logCallError(requestId, error);

      const errorEvent = {
        eventType: 'llm.call_error' as const,
        timestamp: new Date(),
        requestId,
        model,
        error: error.message,
        errorType: 'network'
      };
      llmMetricsCollector.addEvent(errorEvent);
    }

    throw error;
  }
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

function extractTitleFromContent(content: string): string | null {
  // Try to extract title from markdown headers or first line
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }
    if (trimmed.length > 10 && trimmed.length < 200 && !trimmed.includes('\n')) {
      return trimmed;
    }
  }
  return null;
}

function extractDateFromContent(content: string): string | null {
  // Try to extract date patterns from content
  const datePatterns = [
    /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}/g,
    /\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g,
    /\d{1,2}\s+(?:янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{2,4}/gi
  ];

  for (const pattern of datePatterns) {
    const match = content.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function convertHybridResultToLegacy(result: any): any {
  // Convert hybrid analysis result to legacy format for backward compatibility
  return {
    id: result.extractedData.id,
    symbol: result.extractedData.symbol,
    title: result.extractedData.title,
    date: result.extractedData.date,
    category: result.extractedData.category,
    summary: result.extractedData.summary,
    bullets: result.extractedData.bullets,
    trades: result.extractedData.trades,
    additionalFields: result.extractedData.additionalFields,
    numbers: result.extractedData.numbers,
    // Add hybrid-specific metadata for debugging/monitoring
    _hybrid: {
      processingMethod: result.processingMethod,
      confidence: result.confidence,
      processingTimeMs: result.processingTimeMs,
      fallbackUsed: result.fallbackUsed,
      ruleMatches: result.metadata.ruleMatches?.length || 0,
      llmUsed: result.metadata.llmUsed,
      apiCalls: result.metadata.apiCalls,
      errors: result.metadata.errors?.length || 0
    }
  };
}

async function analyzeFile(symbol: string, filePath: string, outDir: string): Promise<string | null> {
  const id = getIdFromFilename(filePath);
  const outPath = path.join(outDir, `${id}.json`);

  if (await fileExists(outPath)) {
    console.log(`${LOG_PREFIX} skip existing ${symbol}/${id}.json`);

    // Log cache hit
    const { model } = getOpenRouterConfig();
    const requestId = llmLogger.logCallStarted(model, 0);
    llmLogger.logCallSkippedCache(requestId, 'Output file already exists', 0);

    // Add cache event to metrics collector
    const cacheEvent = {
      eventType: 'llm.call_skipped_cache' as const,
      timestamp: new Date(),
      requestId,
      model,
      cacheReason: 'Output file already exists'
    };
    llmMetricsCollector.addEvent(cacheEvent);

    return null;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const title = extractTitleFromContent(content) || `News ${id}`;
  const date = extractDateFromContent(content) || new Date().toISOString();

  try {
    // Use hybrid analysis
    if (hybridAnalysis.getConfig().enabled) {
      console.log(`${LOG_PREFIX} analyze ${symbol}/${id} via Hybrid Analysis`);

      const newsContent = createNewsContent(
        id,
        symbol,
        title,
        content,
        date,
        filePath
      );

      const result = await hybridAnalysis.analyzeNews(newsContent, {
        enableLLM: hybridAnalysis.getConfig().llmFallback.enabled,
        confidenceThreshold: 0.7,
        validateResults: true,
        includeMetrics: true
      });

      // Convert hybrid result to legacy format for backward compatibility
      const legacyJson = convertHybridResultToLegacy(result);

      await ensureDir(outDir);
      await fs.writeFile(outPath, JSON.stringify(legacyJson, null, 2), 'utf-8');

      console.log(`${LOG_PREFIX} saved ${outPath} (method: ${result.processingMethod}, confidence: ${result.confidence.toFixed(2)})`);

      // Log processing statistics
      if (result.metadata.llmUsed) {
        console.log(`${LOG_PREFIX} ${symbol}/${id} used LLM fallback (API calls: ${result.metadata.apiCalls})`);
      } else {
        console.log(`${LOG_PREFIX} ${symbol}/${id} processed with rules only`);
      }

      return outPath;
    } else {
      // Fallback to legacy LLM-only processing
      console.log(`${LOG_PREFIX} analyze ${symbol}/${id} via Legacy OpenRouter (hybrid disabled)`);
      const prompt = buildPrompt(content, id, symbol);
      const raw = await callOpenRouter(prompt);
      const json = tryExtractJson(raw);
      await ensureDir(outDir);
      await fs.writeFile(outPath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`${LOG_PREFIX} saved ${outPath} (legacy mode)`);
      return outPath;
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} error analyzing ${symbol}/${id}:`, error);

    // Fallback to legacy processing on hybrid failure
    console.log(`${LOG_PREFIX} falling back to legacy processing for ${symbol}/${id}`);
    try {
      const prompt = buildPrompt(content, id, symbol);
      const raw = await callOpenRouter(prompt);
      const json = tryExtractJson(raw);
      await ensureDir(outDir);
      await fs.writeFile(outPath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`${LOG_PREFIX} saved ${outPath} (legacy fallback)`);
      return outPath;
    } catch (fallbackError) {
      console.error(`${LOG_PREFIX} legacy fallback also failed for ${symbol}/${id}:`, fallbackError);
      throw fallbackError;
    }
  }
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
      if (!(await fileExists(path.join(outDir, `${id}.json`)))) filtered.push(f);
    }
    selected = filtered;
  }

  console.log(`${LOG_PREFIX} symbol=${symbol} total=${newsFiles.length} toAnalyze=${selected.length}`);

  // Clear previous iteration data
  llmLogger.clearIterationData();

  for (const f of selected) {
    try {
      await analyzeFile(symbol, f, outDir);
    } catch (e) {
      console.error(`${LOG_PREFIX} error analyzing ${f}:`, e);
    }
  }

  // Display LLM call summary
  const summary = llmLogger.getIterationSummary();
  if (summary.totalCalls > 0) {
    console.log(llmLogger.formatSummary(summary));

    // Export data for persistence
    await llmLogger.exportData();
    await llmMetricsCollector.exportMetrics();
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

    // Display daily LLM metrics summary after all symbols are processed
    const dailyMetrics = llmMetricsCollector.getCurrentMetrics();
    if (dailyMetrics.totalCalls > 0) {
      console.log(llmMetricsCollector.formatDailySummary());
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


