import {
  HybridNewsAnalysis,
  createNewsContent,
  ConfigManager,
  ProcessingMethod,
  NewsCategory,
  HybridConfig
} from '../../tools/hybridNewsAnalysis';

describe('HybridNewsAnalysis', () => {
  let hybridAnalysis: HybridNewsAnalysis;

  beforeEach(() => {
    // Create instance with test configuration
    const testConfig: Partial<HybridConfig> = {
      enabled: true,
      llmFallback: {
        enabled: false, // Disable LLM for most tests to avoid API calls
        confidenceThreshold: 0.7,
        maxRetries: 1,
        timeoutMs: 5000
      },
      rules: {
        enabled: true,
        confidenceThreshold: 0.6,
        strictMode: false
      },
      monitoring: {
        enabled: false,
        logLevel: 'error'
      }
    };

    hybridAnalysis = new HybridNewsAnalysis(testConfig);
  });

  describe('Configuration Management', () => {
    it('should create instance with default config', () => {
      const defaultInstance = new HybridNewsAnalysis();
      const config = defaultInstance.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.rules.enabled).toBe(true);
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<HybridConfig> = {
        rules: { enabled: false, confidenceThreshold: 0.9, strictMode: true }
      };
      const customInstance = new HybridNewsAnalysis(customConfig);
      const config = customInstance.getConfig();
      expect(config.rules.enabled).toBe(false);
      expect(config.rules.confidenceThreshold).toBe(0.9);
    });

    it('should update configuration at runtime', () => {
      hybridAnalysis.updateConfig({
        rules: { enabled: false, confidenceThreshold: 0.8, strictMode: true }
      });
      const config = hybridAnalysis.getConfig();
      expect(config.rules.enabled).toBe(false);
      expect(config.rules.confidenceThreshold).toBe(0.8);
    });
  });

  describe('Rule-Based Processing', () => {
    it('should detect dividend news', async () => {
      const dividendNews = createNewsContent(
        'test-div-1',
        'TRUR',
        'Дивидендные выплаты по фонду',
        'Фонд TRUR объявляет о выплате дивидендов в размере 15.50 рублей на акцию. Дата выплаты: 15.12.2023.',
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(dividendNews);

      expect(result.processingMethod).toBe(ProcessingMethod.RULE_BASED);
      expect(result.category).toBe(NewsCategory.DIVIDENDS);
      expect(result.extractedData.category).toBe(NewsCategory.DIVIDENDS);
      expect(result.extractedData.additionalFields).toHaveProperty('Dividend Amount');
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.fallbackUsed).toBe(false);
    });

    it('should detect share redemption news', async () => {
      const redemptionNews = createNewsContent(
        'test-red-1',
        'TRUR',
        'Погашение акций фонда',
        'Проведено погашение 1000 акций фонда TRUR на сумму 50000 рублей. Цена погашения составила 50.00 рублей за акцию.',
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(redemptionNews);

      expect(result.processingMethod).toBe(ProcessingMethod.RULE_BASED);
      expect(result.category).toBe(NewsCategory.SHARE_REDEMPTION);
      expect(result.extractedData.numbers.redeemedShares).toBe(1000);
      expect(result.extractedData.numbers.redeemedAmountRub).toBe(50000);
      expect(result.extractedData.numbers.navPriceRub).toBe(50);
    });

    it('should detect rebalancing news with trades', async () => {
      const rebalancingNews = createNewsContent(
        'test-reb-1',
        'TRUR',
        'Ребалансировка портфеля фонда',
        `Проведена ребалансировка портфеля:
        SBER Сбербанк | Buy | 100 | 25000 ₽
        GAZP Газпром | Sell | 50 | 15000 ₽
        Таблица операций обновлена.`,
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(rebalancingNews);

      expect(result.processingMethod).toBe(ProcessingMethod.RULE_BASED);
      expect(result.category).toBe(NewsCategory.REBALANCING);
      expect(result.extractedData.trades).toHaveLength(2);
      expect(result.extractedData.trades[0]).toMatchObject({
        ticker: 'SBER',
        side: 'Buy',
        qty: '100'
      });
      expect(result.extractedData.trades[1]).toMatchObject({
        ticker: 'GAZP',
        side: 'Sell',
        qty: '50'
      });
    });

    it('should handle unknown news types', async () => {
      const unknownNews = createNewsContent(
        'test-unk-1',
        'TRUR',
        'Общие новости',
        'Это обычная новость без специфических финансовых терминов.',
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(unknownNews);

      // Should not match any rules
      expect(result.confidence).toBeLessThan(0.7);
      expect(result.extractedData.category).toBe(NewsCategory.OTHER);
    });
  });

  describe('LLM Processing', () => {
    beforeEach(() => {
      // Enable LLM for these tests (will use mocked responses)
      hybridAnalysis.updateConfig({
        llmFallback: { enabled: true, confidenceThreshold: 0.7, maxRetries: 1, timeoutMs: 5000 }
      });
    });

    it('should force LLM processing when requested', async () => {
      const testNews = createNewsContent(
        'test-llm-1',
        'TRUR',
        'Complex financial news',
        'This is a complex financial news article that requires LLM processing.',
        '2023-12-01',
        'test'
      );

      // Mock the LLM response
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{
            message: {
              content: JSON.stringify({
                id: 'test-llm-1',
                symbol: 'TRUR',
                title: 'Complex financial news',
                date: '2023-12-01',
                category: 'other',
                summary: 'Complex financial news processed by LLM',
                bullets: ['Key point 1', 'Key point 2'],
                trades: [],
                additionalFields: {},
                numbers: {}
              })
            }
          }]
        })
      });

      const result = await hybridAnalysis.analyzeWithMethod(
        testNews,
        ProcessingMethod.LLM_FORCED
      );

      expect(result.processingMethod).toBe(ProcessingMethod.LLM_FORCED);
      expect(result.fallbackUsed).toBe(true);
      expect(result.metadata.llmUsed).toBe(true);
      expect(result.metadata.apiCalls).toBeGreaterThan(0);
    });

    it('should handle LLM errors gracefully', async () => {
      const testNews = createNewsContent(
        'test-llm-error',
        'TRUR',
        'Error test',
        'This should trigger an LLM error.',
        '2023-12-01',
        'test'
      );

      // Mock API error
      global.fetch = jest.fn().mockRejectedValue(new Error('API Error'));

      await expect(
        hybridAnalysis.analyzeWithMethod(testNews, ProcessingMethod.LLM_FORCED)
      ).rejects.toThrow();
    });
  });

  describe('Batch Processing', () => {
    it('should process multiple news articles', async () => {
      const newsArray = [
        createNewsContent('batch-1', 'TRUR', 'News 1', 'Дивиденды фонда составят 10 рублей', '2023-12-01', 'test'),
        createNewsContent('batch-2', 'TRUR', 'News 2', 'Погашение 500 акций на сумму 25000 рублей', '2023-12-01', 'test'),
        createNewsContent('batch-3', 'TRUR', 'News 3', 'Обычная новость без специфики', '2023-12-01', 'test')
      ];

      const results = await hybridAnalysis.analyzeMultipleNews(newsArray);

      expect(results).toHaveLength(3);
      expect(results[0].extractedData.category).toBe(NewsCategory.DIVIDENDS);
      expect(results[1].extractedData.category).toBe(NewsCategory.SHARE_REDEMPTION);
      expect(results[2].extractedData.category).toBe(NewsCategory.OTHER);
    });
  });

  describe('Rule Management', () => {
    it('should list available rules', () => {
      const rules = hybridAnalysis.getAvailableRules();
      expect(rules).toContain('dividend_detection');
      expect(rules).toContain('redemption_detection');
      expect(rules).toContain('rebalancing_detection');
      expect(rules).toContain('fund_update_detection');
    });

    it('should allow adding custom rules', () => {
      const customRule = {
        name: 'test_rule',
        pattern: /test pattern/i,
        category: NewsCategory.OTHER,
        priority: 10,
        extractor: () => ({ category: NewsCategory.OTHER, summary: 'Test rule matched' })
      };

      hybridAnalysis.addCustomRule(customRule);
      const rules = hybridAnalysis.getAvailableRules();
      expect(rules).toContain('test_rule');
    });

    it('should allow removing rules', () => {
      const removed = hybridAnalysis.removeRule('dividend_detection');
      expect(removed).toBe(true);

      const rules = hybridAnalysis.getAvailableRules();
      expect(rules).not.toContain('dividend_detection');
    });
  });

  describe('Validation and Error Handling', () => {
    it('should validate structured data when strict mode is enabled', async () => {
      hybridAnalysis.updateConfig({
        validation: { strict: true, requireAllFields: true }
      });

      const invalidNews = createNewsContent(
        'invalid',
        'TRUR',
        'Invalid news',
        'Some content that produces invalid data',
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(invalidNews);

      // Should still process but with validation warnings/errors in metadata
      expect(result.metadata.validationResults).toBeDefined();
    });

    it('should handle disabled hybrid analysis', async () => {
      hybridAnalysis.updateConfig({ enabled: false });

      const testNews = createNewsContent(
        'disabled-test',
        'TRUR',
        'Test news',
        'Test content',
        '2023-12-01',
        'test'
      );

      await expect(
        hybridAnalysis.analyzeNews(testNews)
      ).rejects.toThrow('Hybrid analysis is disabled');
    });
  });

  describe('Performance and Statistics', () => {
    it('should track processing statistics', async () => {
      const testNews = createNewsContent(
        'stats-test',
        'TRUR',
        'Statistics test',
        'Дивиденды по фонду составят 5 рублей',
        '2023-12-01',
        'test'
      );

      await hybridAnalysis.analyzeNews(testNews);

      const stats = hybridAnalysis.getStats();
      expect(stats).toHaveProperty('rulesLoaded');
      expect(stats).toHaveProperty('configEnabled');
      expect(stats.rulesLoaded).toBeGreaterThan(0);
      expect(stats.configEnabled).toBe(true);
    });

    it('should measure processing time', async () => {
      const testNews = createNewsContent(
        'timing-test',
        'TRUR',
        'Timing test',
        'Дивиденды по фонду составят 5 рублей',
        '2023-12-01',
        'test'
      );

      const result = await hybridAnalysis.analyzeNews(testNews);

      expect(result.processingTimeMs).toBeGreaterThan(0);
      expect(result.processingTimeMs).toBeLessThan(1000); // Should be fast for rule-based
    });
  });
});

describe('ConfigManager', () => {
  it('should create config from environment variables', () => {
    // Mock environment variables
    process.env.HYBRID_LLM_FALLBACK_ENABLED = 'true';
    process.env.HYBRID_RULES_CONFIDENCE_THRESHOLD = '0.8';
    process.env.HYBRID_LOG_LEVEL = 'debug';

    const config = ConfigManager.fromEnvironment();
    const configData = config.getConfig();

    expect(configData.llmFallback.enabled).toBe(true);
    expect(configData.rules.confidenceThreshold).toBe(0.8);
    expect(configData.monitoring.logLevel).toBe('debug');

    // Clean up
    delete process.env.HYBRID_LLM_FALLBACK_ENABLED;
    delete process.env.HYBRID_RULES_CONFIDENCE_THRESHOLD;
    delete process.env.HYBRID_LOG_LEVEL;
  });

  it('should validate configuration values', () => {
    expect(() => {
      new ConfigManager({
        llmFallback: { enabled: true, confidenceThreshold: 1.5, maxRetries: 3, timeoutMs: 30000 }
      });
    }).toThrow('LLM fallback confidence threshold must be between 0 and 1');

    expect(() => {
      new ConfigManager({
        llm: { model: 'test', temperature: 3, maxTokens: 1000 }
      });
    }).toThrow('LLM temperature must be between 0 and 2');
  });
});

describe('Utility Functions', () => {
  it('should create NewsContent correctly', () => {
    const content = createNewsContent(
      'test-id',
      'TRUR',
      'Test Title',
      'Test Content',
      '2023-12-01',
      'test-source',
      { custom: 'metadata' }
    );

    expect(content).toMatchObject({
      id: 'test-id',
      symbol: 'TRUR',
      title: 'Test Title',
      content: 'Test Content',
      date: '2023-12-01',
      source: 'test-source',
      metadata: { custom: 'metadata' }
    });
  });
});