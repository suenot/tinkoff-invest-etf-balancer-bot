// Types and interfaces for the hybrid news analysis system

export enum NewsCategory {
  REBALANCING = 'rebalancing',
  DIVIDENDS = 'dividends',
  SHARE_REDEMPTION = 'share redemption',
  FUND_UPDATES = 'fund updates',
  OTHER = 'other'
}

export enum ProcessingMethod {
  RULE_BASED = 'rule_based',
  LLM_FALLBACK = 'llm_fallback',
  LLM_VALIDATION = 'llm_validation',
  LLM_FORCED = 'llm_forced'
}

export interface NewsContent {
  id: string;
  symbol: string;
  title: string;
  content: string;
  date: string;
  source: string;
  metadata?: Record<string, any>;
}

export interface TradeData {
  ticker: string;
  name: string;
  side: 'Buy' | 'Sell';
  qty: string;
  amount: string;
  weightFrom: string | null;
  weightTo: string | null;
}

export interface NumberData {
  redeemedShares?: number | null;
  redeemedAmountRub?: number | null;
  totalShares?: number | null;
  navPriceRub?: number | null;
}

export interface StructuredData {
  id: string;
  symbol: string;
  title: string;
  date: string;
  category: NewsCategory;
  summary: string;
  bullets: string[];
  trades: TradeData[];
  additionalFields: Record<string, string>;
  numbers: NumberData;
}

export interface RuleMatch {
  ruleName: string;
  pattern: string;
  confidence: number;
  matchedText: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProcessingMetadata {
  ruleMatches: RuleMatch[];
  llmUsed: boolean;
  apiCalls: number;
  errors: string[];
  validationResults: ValidationResult[];
  processingTimeMs: number;
}

export interface HybridAnalysisResult {
  processingMethod: ProcessingMethod;
  category: NewsCategory;
  confidence: number;
  extractedData: StructuredData;
  processingTimeMs: number;
  fallbackUsed: boolean;
  metadata: ProcessingMetadata;
}

export interface AnalysisOptions {
  enableLLM: boolean;
  confidenceThreshold: number;
  validateResults: boolean;
  includeMetrics: boolean;
  forceMethod?: ProcessingMethod;
}

export interface HybridAnalysisRequest {
  content: NewsContent;
  options: AnalysisOptions;
}

export interface Rule {
  name: string;
  pattern: RegExp;
  category: NewsCategory;
  priority: number;
  extractor: (content: string, match: RegExpMatchArray) => Partial<StructuredData>;
  validator?: (data: Partial<StructuredData>) => ValidationResult;
}

export interface RuleResult {
  matched: boolean;
  confidence: number;
  extractedData: Partial<StructuredData> | null;
  category: NewsCategory | null;
  ruleMatch?: RuleMatch;
}

export interface HybridConfig {
  enabled: boolean;
  llmFallback: {
    enabled: boolean;
    confidenceThreshold: number;
    maxRetries: number;
    timeoutMs: number;
  };
  rules: {
    enabled: boolean;
    confidenceThreshold: number;
    strictMode: boolean;
  };
  llm: {
    model: string;
    temperature: number;
    maxTokens: number;
  };
  validation: {
    strict: boolean;
    requireAllFields: boolean;
  };
  monitoring: {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };
}

export interface ProcessingStats {
  totalProcessed: number;
  ruleBasedSuccesses: number;
  llmFallbacks: number;
  failures: number;
  averageProcessingTime: number;
  costEstimate: number;
}

export class HybridAnalysisError extends Error {
  constructor(
    message: string,
    public code: string,
    public processingMethod?: ProcessingMethod,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'HybridAnalysisError';
  }
}