import {
  Rule,
  RuleResult,
  NewsContent,
  StructuredData,
  NewsCategory,
  TradeData,
  NumberData,
  ValidationResult,
  RuleMatch
} from './types';
import { ConfigManager } from './config';

export class RuleEngine {
  private rules: Rule[] = [];
  private config: ConfigManager;
  private readonly LOG_PREFIX = '[RuleEngine]';

  constructor(config: ConfigManager) {
    this.config = config;
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    // Dividend rules
    this.addRule({
      name: 'dividend_detection',
      pattern: /(?:дивиденд|dividend|доходность|выплат)/i,
      category: NewsCategory.DIVIDENDS,
      priority: 1,
      extractor: this.extractDividendData.bind(this),
      validator: this.validateDividendData.bind(this)
    });

    // Share redemption rules
    this.addRule({
      name: 'redemption_detection',
      pattern: /(?:погашение|выкуп|redemption|redeem)/i,
      category: NewsCategory.SHARE_REDEMPTION,
      priority: 1,
      extractor: this.extractRedemptionData.bind(this),
      validator: this.validateRedemptionData.bind(this)
    });

    // Rebalancing rules - look for trading tables
    this.addRule({
      name: 'rebalancing_detection',
      pattern: /(?:ребаланс|rebalanc|покуп|продаж|buy|sell).*(?:таблица|table|список|list)/is,
      category: NewsCategory.REBALANCING,
      priority: 1,
      extractor: this.extractRebalancingData.bind(this),
      validator: this.validateRebalancingData.bind(this)
    });

    // Fund updates rules
    this.addRule({
      name: 'fund_update_detection',
      pattern: /(?:обновление|update|изменение|change).*(?:фонд|fund|портфель|portfolio)/i,
      category: NewsCategory.FUND_UPDATES,
      priority: 2,
      extractor: this.extractFundUpdateData.bind(this),
      validator: this.validateFundUpdateData.bind(this)
    });

    this.config.log('info', `Initialized ${this.rules.length} default rules`);
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
    this.config.log('debug', `Added rule: ${rule.name}`);
  }

  removeRule(ruleName: string): boolean {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(rule => rule.name !== ruleName);
    const removed = this.rules.length < initialLength;
    if (removed) {
      this.config.log('debug', `Removed rule: ${ruleName}`);
    }
    return removed;
  }

  processContent(content: NewsContent): RuleResult {
    if (!this.config.isRulesEnabled()) {
      this.config.log('debug', 'Rules processing disabled');
      return {
        matched: false,
        confidence: 0,
        extractedData: null,
        category: null
      };
    }

    const normalizedContent = this.normalizeContent(content.content);

    for (const rule of this.rules) {
      try {
        const match = normalizedContent.match(rule.pattern);
        if (match) {
          this.config.log('debug', `Rule matched: ${rule.name}`);

          const extractedData = rule.extractor(content.content, match);
          const baseData = this.createBaseStructuredData(content);
          const mergedData = { ...baseData, ...extractedData };

          // Calculate confidence based on match quality and validation
          let confidence = this.calculateConfidence(rule, match, mergedData);

          // Run validation if available
          let validationResult: ValidationResult = { isValid: true, errors: [], warnings: [] };
          if (rule.validator) {
            validationResult = rule.validator(mergedData);
            if (!validationResult.isValid) {
              confidence *= 0.5; // Reduce confidence for failed validation
            }
          }

          const ruleMatch: RuleMatch = {
            ruleName: rule.name,
            pattern: rule.pattern.source,
            confidence,
            matchedText: match[0]
          };

          // Check if confidence meets threshold
          if (confidence >= this.config.getRulesConfidenceThreshold()) {
            return {
              matched: true,
              confidence,
              extractedData: mergedData,
              category: rule.category,
              ruleMatch
            };
          } else {
            this.config.log('debug', `Rule ${rule.name} confidence ${confidence} below threshold ${this.config.getRulesConfidenceThreshold()}`);
          }
        }
      } catch (error) {
        this.config.log('error', `Error processing rule ${rule.name}:`, error);
      }
    }

    return {
      matched: false,
      confidence: 0,
      extractedData: null,
      category: null
    };
  }

  private normalizeContent(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private createBaseStructuredData(content: NewsContent): StructuredData {
    return {
      id: content.id,
      symbol: content.symbol,
      title: content.title,
      date: content.date,
      category: NewsCategory.OTHER,
      summary: '',
      bullets: [],
      trades: [],
      additionalFields: {},
      numbers: {}
    };
  }

  private calculateConfidence(rule: Rule, match: RegExpMatchArray, data: Partial<StructuredData>): number {
    let baseConfidence = 0.6; // Base confidence for pattern match

    // Increase confidence based on match specificity
    if (match[0].length > 10) baseConfidence += 0.1;
    if (match.length > 1) baseConfidence += 0.1; // Has capture groups

    // Increase confidence based on extracted data quality
    if (data.summary && data.summary.length > 0) baseConfidence += 0.1;
    if (data.bullets && data.bullets.length > 0) baseConfidence += 0.05;
    if (data.trades && data.trades.length > 0) baseConfidence += 0.1;
    if (data.numbers && Object.keys(data.numbers).some(key => data.numbers![key as keyof NumberData] !== null)) {
      baseConfidence += 0.05;
    }

    return Math.min(baseConfidence, 1.0);
  }

  // Dividend data extraction
  private extractDividendData(content: string, match: RegExpMatchArray): Partial<StructuredData> {
    const result: Partial<StructuredData> = {
      category: NewsCategory.DIVIDENDS,
      summary: this.extractSummaryAroundMatch(content, match),
      bullets: this.extractBulletPoints(content, ['дивиденд', 'доходность', 'выплат']),
      additionalFields: {}
    };

    // Extract dividend-specific information
    const dividendAmountMatch = content.match(/(\d+[.,]\d+)\s*(?:₽|руб|rub)/i);
    if (dividendAmountMatch) {
      result.additionalFields!['Dividend Amount'] = dividendAmountMatch[1];
    }

    const dividendDateMatch = content.match(/(?:дата\s+выплаты|payment\s+date)[:\s]*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})/i);
    if (dividendDateMatch) {
      result.additionalFields!['Payment Date'] = dividendDateMatch[1];
    }

    return result;
  }

  // Share redemption data extraction
  private extractRedemptionData(content: string, match: RegExpMatchArray): Partial<StructuredData> {
    const result: Partial<StructuredData> = {
      category: NewsCategory.SHARE_REDEMPTION,
      summary: this.extractSummaryAroundMatch(content, match),
      bullets: this.extractBulletPoints(content, ['погашение', 'выкуп', 'цена']),
      additionalFields: {},
      numbers: {}
    };

    // Extract redemption-specific numbers
    const redeemedSharesMatch = content.match(/(?:погашено|redeemed)[:\s]*(\d+(?:\s?\d{3})*(?:[.,]\d+)?)/i);
    if (redeemedSharesMatch) {
      const shares = this.parseNumber(redeemedSharesMatch[1]);
      result.numbers!.redeemedShares = shares;
      result.additionalFields!['Redeemed Shares'] = redeemedSharesMatch[1];
    }

    const redemptionAmountMatch = content.match(/(?:сумма|amount)[:\s]*(\d+(?:\s?\d{3})*(?:[.,]\d+)?)\s*(?:₽|руб|rub)/i);
    if (redemptionAmountMatch) {
      const amount = this.parseNumber(redemptionAmountMatch[1]);
      result.numbers!.redeemedAmountRub = amount;
      result.additionalFields!['Redemption Amount'] = redemptionAmountMatch[1];
    }

    const navPriceMatch = content.match(/(?:цена|price|nav)[:\s]*(\d+(?:[.,]\d+)?)\s*(?:₽|руб|rub)/i);
    if (navPriceMatch) {
      const price = this.parseNumber(navPriceMatch[1]);
      result.numbers!.navPriceRub = price;
      result.additionalFields!['NAV Price'] = navPriceMatch[1];
    }

    return result;
  }

  // Rebalancing data extraction
  private extractRebalancingData(content: string, match: RegExpMatchArray): Partial<StructuredData> {
    const result: Partial<StructuredData> = {
      category: NewsCategory.REBALANCING,
      summary: this.extractSummaryAroundMatch(content, match),
      bullets: this.extractBulletPoints(content, ['покуп', 'продаж', 'buy', 'sell']),
      trades: this.extractTradingData(content),
      additionalFields: {}
    };

    return result;
  }

  // Fund update data extraction
  private extractFundUpdateData(content: string, match: RegExpMatchArray): Partial<StructuredData> {
    const result: Partial<StructuredData> = {
      category: NewsCategory.FUND_UPDATES,
      summary: this.extractSummaryAroundMatch(content, match),
      bullets: this.extractBulletPoints(content, ['обновление', 'изменение', 'фонд']),
      additionalFields: {}
    };

    return result;
  }

  private extractSummaryAroundMatch(content: string, match: RegExpMatchArray): string {
    const matchIndex = content.indexOf(match[0]);
    const start = Math.max(0, matchIndex - 100);
    const end = Math.min(content.length, matchIndex + match[0].length + 100);
    return content.substring(start, end).trim();
  }

  private extractBulletPoints(content: string, keywords: string[]): string[] {
    const bullets: string[] = [];
    const sentences = content.split(/[.!?]+/);

    for (const sentence of sentences) {
      for (const keyword of keywords) {
        if (sentence.toLowerCase().includes(keyword.toLowerCase()) && sentence.trim().length > 10) {
          bullets.push(sentence.trim());
          break;
        }
      }
    }

    return bullets.slice(0, 8); // Limit to 8 bullets
  }

  private extractTradingData(content: string): TradeData[] {
    const trades: TradeData[] = [];

    // Look for table-like structures
    const lines = content.split('\n');
    for (const line of lines) {
      const trade = this.parseTradeLine(line);
      if (trade) {
        trades.push(trade);
      }
    }

    return trades;
  }

  private parseTradeLine(line: string): TradeData | null {
    // Try to match various table formats
    const patterns = [
      /([A-Z]{3,5})\s+([^|]+?)\s+\|\s*(Buy|Sell|Покупка|Продажа)\s*\|\s*([0-9.,]+)\s*\|\s*([0-9.,\s₽]+)/i,
      /([A-Z]{3,5})\s+([^,]+),\s*(Buy|Sell|Покупка|Продажа)[:\s]*([0-9.,]+)(?:\s*шт)?\s*(?:на\s*)?([0-9.,\s₽]+)?/i
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return {
          ticker: match[1].trim(),
          name: match[2].trim(),
          side: this.normalizeSide(match[3]),
          qty: match[4].trim(),
          amount: match[5]?.trim() || '',
          weightFrom: null,
          weightTo: null
        };
      }
    }

    return null;
  }

  private normalizeSide(side: string): 'Buy' | 'Sell' {
    const normalized = side.toLowerCase();
    return (normalized.includes('buy') || normalized.includes('покуп')) ? 'Buy' : 'Sell';
  }

  private parseNumber(numStr: string): number | null {
    if (!numStr) return null;

    // Remove spaces and replace comma with dot
    const cleaned = numStr.replace(/\s/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);

    return isNaN(parsed) ? null : parsed;
  }

  // Validation methods
  private validateDividendData(data: Partial<StructuredData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.additionalFields?.['Dividend Amount'] && !data.additionalFields?.['Payment Date']) {
      warnings.push('No specific dividend information extracted');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateRedemptionData(data: Partial<StructuredData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.numbers?.redeemedShares && !data.numbers?.redeemedAmountRub) {
      warnings.push('No redemption numbers extracted');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateRebalancingData(data: Partial<StructuredData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.trades || data.trades.length === 0) {
      warnings.push('No trading data extracted');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateFundUpdateData(data: Partial<StructuredData>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data.summary || data.summary.length < 10) {
      warnings.push('Summary seems too short for fund update');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  getRuleNames(): string[] {
    return this.rules.map(rule => rule.name);
  }

  getRuleByName(name: string): Rule | undefined {
    return this.rules.find(rule => rule.name === name);
  }
}