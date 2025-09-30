import {
  NewsContent,
  StructuredData,
  NewsCategory,
  ProcessingMethod,
  HybridAnalysisError
} from './types';
import { ConfigManager } from './config';

interface LLMResponse {
  id: string;
  symbol: string;
  title: string;
  date: string;
  category: string;
  summary: string;
  bullets: string[];
  trades: Array<{
    ticker: string;
    name: string;
    side: 'Buy' | 'Sell';
    qty: string;
    amount: string;
    weightFrom: string | null;
    weightTo: string | null;
  }>;
  additionalFields: Record<string, string>;
  numbers: {
    redeemedShares?: number | null;
    redeemedAmountRub?: number | null;
    totalShares?: number | null;
    navPriceRub?: number | null;
  };
}

export class LLMProcessor {
  private config: ConfigManager;
  private readonly LOG_PREFIX = '[LLMProcessor]';
  private apiCallCount = 0;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  async processContent(
    content: NewsContent,
    processingMethod: ProcessingMethod,
    ruleFailureContext?: string
  ): Promise<StructuredData> {
    if (!this.config.isLLMFallbackEnabled() && processingMethod !== ProcessingMethod.LLM_FORCED) {
      throw new HybridAnalysisError(
        'LLM processing is disabled',
        'LLM_DISABLED',
        processingMethod
      );
    }

    const prompt = this.buildEnhancedPrompt(content, processingMethod, ruleFailureContext);

    let lastError: Error | null = null;
    const maxRetries = this.config.getConfig().llmFallback.maxRetries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.config.log('debug', `LLM processing attempt ${attempt}/${maxRetries} for ${content.id}`);

        const response = await this.callLLMWithTimeout(prompt);
        const parsedData = this.parseAndValidateLLMResponse(response, content);

        this.config.log('info', `LLM processing successful for ${content.id} on attempt ${attempt}`);
        return parsedData;

      } catch (error) {
        lastError = error as Error;
        this.config.log('warn', `LLM processing attempt ${attempt} failed for ${content.id}:`, error);

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed
    throw new HybridAnalysisError(
      `LLM processing failed after ${maxRetries} attempts: ${lastError?.message}`,
      'LLM_RETRY_EXHAUSTED',
      processingMethod,
      lastError || undefined
    );
  }

  private buildEnhancedPrompt(
    content: NewsContent,
    processingMethod: ProcessingMethod,
    ruleFailureContext?: string
  ): string {
    const contextLines = [
      'You are an experienced financial analyst. Analyze financial news with high precision.',
      'Return strictly valid JSON without explanations or markdown formatting.',
    ];

    // Add context based on processing method
    if (processingMethod === ProcessingMethod.LLM_FALLBACK && ruleFailureContext) {
      contextLines.push(`Note: Rule-based processing failed because: ${ruleFailureContext}`);
      contextLines.push('Please focus on patterns that automated rules might have missed.');
    } else if (processingMethod === ProcessingMethod.LLM_VALIDATION) {
      contextLines.push('This is a validation pass. Please be extra thorough in your analysis.');
    }

    const promptSchema = [
      '{',
      '  "id": string,                                   // news identifier',
      '  "symbol": string,                               // fund ticker',
      '  "title": string,                                // title',
      '  "date": string,                                 // date from news as is',
      '  "category": string,                             // EXACT category: "rebalancing"|"dividends"|"share redemption"|"fund updates"|"other"',
      '  "summary": string,                              // brief content in 1-3 sentences',
      '  "bullets": string[],                            // key points (3-8 items)',
      '  "trades": [                                     // trading operations if present',
      '    {',
      '      "ticker": string,                           // security ticker/symbol',
      '      "name": string,                             // security name',
      '      "side": "Buy"|"Sell",                       // operation type',
      '      "qty": string,                              // quantity as string',
      '      "amount": string,                           // amount as string',
      '      "weightFrom": string|null,                  // weight before (if available)',
      '      "weightTo": string|null                     // weight after (if available)',
      '    }',
      '  ],',
      '  "additionalFields": {                           // category-specific fields',
      '    // For dividends: "Dividend Amount", "Payment Date", "Yield"',
      '    // For redemptions: "Redemption Date", "Redeemed Shares", "Total Shares", "NAV Price"',
      '    // For rebalancing: "Rebalancing Date", "Portfolio Value"',
      '    // For fund updates: "AUM Change", "Expense Ratio", "Update Type"',
      '    [name: string]: string',
      '  },',
      '  "numbers": {                                    // normalized numeric values (remove suffixes, convert to numbers)',
      '    "redeemedShares": number|null,                // shares count',
      '    "redeemedAmountRub": number|null,             // amount in rubles',
      '    "totalShares": number|null,                   // total shares',
      '    "navPriceRub": number|null                    // NAV price in rubles',
      '  }',
      '}',
      '',
      'IMPORTANT INSTRUCTIONS:',
      '1. Category must be EXACTLY one of: rebalancing, dividends, share redemption, fund updates, other',
      '2. Preserve original string formats in additionalFields, but normalize numbers in "numbers" field',
      '3. For trades array: extract all buy/sell operations mentioned in the text',
      '4. For numbers: convert text like "1 234,56" to 1234.56, "1.5 млрд" to 1500000000',
      '5. Return ONLY the JSON object, no explanations or markdown',
      '',
      'Financial news content to analyze:',
      `Symbol: ${content.symbol}`,
      `ID: ${content.id}`,
      `Title: ${content.title}`,
      `Date: ${content.date}`,
      '',
      'Content:',
      content.content
    ];

    return [...contextLines, '', ...promptSchema].join('\n');
  }

  private async callLLMWithTimeout(prompt: string): Promise<string> {
    const { timeoutMs } = this.config.getConfig().llmFallback;

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`LLM request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        this.apiCallCount++;
        const response = await this.callOpenRouter(prompt);
        clearTimeout(timeoutId);
        resolve(response);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  private async callOpenRouter(prompt: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new HybridAnalysisError(
        'OPENROUTER_API_KEY is not set in environment variables',
        'API_KEY_MISSING'
      );
    }

    const llmConfig = this.config.getLLMConfig();
    const baseUrl = process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1';
    const url = `${baseUrl}/chat/completions`;

    const requestBody = {
      model: llmConfig.model,
      messages: [
        {
          role: 'system',
          content: 'You are a financial news analyst. Return only valid JSON. No comments. No markdown.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: llmConfig.temperature,
      max_tokens: llmConfig.maxTokens,
      stream: false
    };

    this.config.log('debug', `Calling OpenRouter API: ${llmConfig.model}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/suenot/deep-tinkoff-invest-api',
        'X-Title': 'tinkoff-invest-etf-balancer-bot-hybrid'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new HybridAnalysisError(
        `OpenRouter API error ${response.status}: ${errorText}`,
        'API_REQUEST_FAILED'
      );
    }

    const responseData = await response.json();

    if (!responseData.choices || responseData.choices.length === 0) {
      throw new HybridAnalysisError(
        'No choices returned from OpenRouter API',
        'API_NO_CHOICES'
      );
    }

    const content = responseData.choices[0]?.message?.content;
    if (!content) {
      throw new HybridAnalysisError(
        'No content in OpenRouter API response',
        'API_NO_CONTENT'
      );
    }

    return content;
  }

  private parseAndValidateLLMResponse(response: string, originalContent: NewsContent): StructuredData {
    let parsedData: LLMResponse;

    try {
      // Try to extract JSON from response
      const cleanedResponse = this.extractJsonFromResponse(response);
      parsedData = JSON.parse(cleanedResponse);
    } catch (error) {
      throw new HybridAnalysisError(
        `Failed to parse LLM JSON response: ${error}`,
        'JSON_PARSE_ERROR',
        undefined,
        error as Error
      );
    }

    // Validate required fields
    this.validateLLMResponse(parsedData, originalContent);

    // Convert to StructuredData format
    return this.convertToStructuredData(parsedData);
  }

  private extractJsonFromResponse(response: string): string {
    const trimmed = response.trim();

    // Try parsing as-is first
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {}

    // Try to extract JSON from markdown code blocks
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*({[\s\S]*?})\s*```/i);
    if (codeBlockMatch) {
      return codeBlockMatch[1];
    }

    // Try to find JSON object boundaries
    const jsonMatch = trimmed.match(/{[\s\S]*}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    throw new Error('No valid JSON found in response');
  }

  private validateLLMResponse(data: LLMResponse, originalContent: NewsContent): void {
    const errors: string[] = [];

    // Check required fields
    if (!data.id) errors.push('Missing id field');
    if (!data.symbol) errors.push('Missing symbol field');
    if (!data.title) errors.push('Missing title field');
    if (!data.category) errors.push('Missing category field');
    if (!data.summary) errors.push('Missing summary field');

    // Validate category
    const validCategories = ['rebalancing', 'dividends', 'share redemption', 'fund updates', 'other'];
    if (data.category && !validCategories.includes(data.category)) {
      errors.push(`Invalid category: ${data.category}. Must be one of: ${validCategories.join(', ')}`);
    }

    // Validate arrays
    if (data.bullets && !Array.isArray(data.bullets)) {
      errors.push('bullets must be an array');
    }
    if (data.trades && !Array.isArray(data.trades)) {
      errors.push('trades must be an array');
    }

    // Validate trade objects
    if (data.trades && Array.isArray(data.trades)) {
      for (let i = 0; i < data.trades.length; i++) {
        const trade = data.trades[i];
        if (!trade.ticker) errors.push(`Trade ${i}: missing ticker`);
        if (!trade.name) errors.push(`Trade ${i}: missing name`);
        if (!trade.side || !['Buy', 'Sell'].includes(trade.side)) {
          errors.push(`Trade ${i}: side must be "Buy" or "Sell"`);
        }
      }
    }

    // Validate numbers object
    if (data.numbers && typeof data.numbers !== 'object') {
      errors.push('numbers must be an object');
    }

    if (errors.length > 0) {
      throw new HybridAnalysisError(
        `LLM response validation failed: ${errors.join('; ')}`,
        'RESPONSE_VALIDATION_FAILED'
      );
    }
  }

  private convertToStructuredData(llmResponse: LLMResponse): StructuredData {
    return {
      id: llmResponse.id,
      symbol: llmResponse.symbol,
      title: llmResponse.title,
      date: llmResponse.date,
      category: this.mapCategory(llmResponse.category),
      summary: llmResponse.summary || '',
      bullets: llmResponse.bullets || [],
      trades: llmResponse.trades || [],
      additionalFields: llmResponse.additionalFields || {},
      numbers: llmResponse.numbers || {}
    };
  }

  private mapCategory(category: string): NewsCategory {
    const categoryMap: Record<string, NewsCategory> = {
      'rebalancing': NewsCategory.REBALANCING,
      'dividends': NewsCategory.DIVIDENDS,
      'share redemption': NewsCategory.SHARE_REDEMPTION,
      'fund updates': NewsCategory.FUND_UPDATES,
      'other': NewsCategory.OTHER
    };

    return categoryMap[category.toLowerCase()] || NewsCategory.OTHER;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getApiCallCount(): number {
    return this.apiCallCount;
  }

  resetApiCallCount(): void {
    this.apiCallCount = 0;
  }
}