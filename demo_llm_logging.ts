#!/usr/bin/env bun

/**
 * Demo script showing LLM logging integration in analyzeNews tool
 *
 * This demonstrates how the new LLM logging system works when integrated
 * with the news analysis workflow.
 */

// Simplified mock implementations for demo purposes
console.log('🤖 LLM Logging System Demo\n');

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

class MockLLMLogger {
  private events: any[] = [];
  private records: Map<string, any> = new Map();

  generateRequestId(): string {
    return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  logCallStarted(model: string, promptLength: number): string {
    const requestId = this.generateRequestId();
    const record = {
      requestId,
      model,
      promptLength,
      startTime: new Date(),
      status: 'started'
    };
    this.records.set(requestId, record);
    console.log(`📞 [LLM] Call started: ${model} (${promptLength} chars)`);
    return requestId;
  }

  logCallSuccess(requestId: string, responseLength: number, tokenUsage?: TokenUsage, cost?: number): void {
    const record = this.records.get(requestId);
    if (record) {
      record.status = 'success';
      record.duration = Date.now() - record.startTime.getTime();
      record.tokenUsage = tokenUsage;
      record.estimatedCost = cost;
      console.log(`✅ [LLM] Call success: ${record.duration}ms, ${tokenUsage?.totalTokens || 0} tokens, $${cost?.toFixed(4) || '0.0000'}`);
    }
  }

  logCallSkippedCache(requestId: string, reason: string): void {
    const record = this.records.get(requestId);
    if (record) {
      record.status = 'cached';
      record.cacheReason = reason;
      console.log(`🗂️ [LLM] Cache hit: ${reason}`);
    }
  }

  logCallError(requestId: string, error: Error): void {
    const record = this.records.get(requestId);
    if (record) {
      record.status = 'error';
      record.error = error.message;
      record.duration = Date.now() - record.startTime.getTime();
      console.log(`❌ [LLM] Call failed: ${error.message} (${record.duration}ms)`);
    }
  }

  getIterationSummary() {
    const records = Array.from(this.records.values());
    const successful = records.filter(r => r.status === 'success').length;
    const failed = records.filter(r => r.status === 'error').length;
    const cached = records.filter(r => r.status === 'cached').length;
    const totalTokens = records.reduce((sum, r) => sum + (r.tokenUsage?.totalTokens || 0), 0);
    const totalCost = records.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);
    const avgTime = records.filter(r => r.duration).reduce((sum, r) => sum + r.duration, 0) / Math.max(successful, 1);

    return {
      totalCalls: records.length,
      successfulCalls: successful,
      failedCalls: failed,
      cachedCalls: cached,
      totalTokensUsed: totalTokens,
      estimatedCost: totalCost,
      averageResponseTime: avgTime,
      cacheHitRate: (cached / Math.max(records.length, 1)) * 100,
      errorRate: (failed / Math.max(records.length, 1)) * 100
    };
  }

  formatSummary(summary: any): string {
    const costColor = summary.estimatedCost > 0.1 ? '🟡' : '🟢';
    const errorColor = summary.errorRate > 10 ? '🔴' : summary.errorRate > 5 ? '🟡' : '🟢';

    return [
      '🤖 LLM Call Summary:',
      `  Total Calls: ${summary.totalCalls} (${summary.successfulCalls} success, ${summary.failedCalls} errors)`,
      `  Average Response Time: ${summary.averageResponseTime.toFixed(0)}ms`,
      `  Tokens Used: ${summary.totalTokensUsed.toLocaleString()} (est. ${costColor}$${summary.estimatedCost.toFixed(4)})`,
      `  Cache Hit Rate: ${summary.cacheHitRate.toFixed(1)}% (${summary.cachedCalls} cached)`,
      summary.errorRate > 0 ? `  ${errorColor} Error Rate: ${summary.errorRate.toFixed(1)}%` : ''
    ].filter(Boolean).join('\n');
  }
}

// Mock OpenRouter API call with logging
async function mockCallOpenRouter(prompt: string, logger: MockLLMLogger): Promise<string> {
  const model = 'openrouter/auto';
  const requestId = logger.logCallStarted(model, prompt.length);

  try {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));

    // Simulate different outcomes
    const random = Math.random();

    if (random < 0.1) {
      // 10% chance of error
      throw new Error(random < 0.05 ? 'Rate limit exceeded' : 'Network timeout');
    }

    // Simulate successful response
    const response = `{"id": "news-123", "symbol": "TRUR", "title": "Mock Analysis", "category": "rebalancing"}`;

    // Simulate token usage
    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(response.length / 4);
    const tokenUsage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    };

    // Estimate cost (simplified)
    const cost = (inputTokens * 0.000002) + (outputTokens * 0.000006);

    logger.logCallSuccess(requestId, response.length, tokenUsage, cost);
    return response;

  } catch (error) {
    logger.logCallError(requestId, error as Error);
    throw error;
  }
}

// Mock file analysis with caching
async function mockAnalyzeFile(filename: string, logger: MockLLMLogger): Promise<void> {
  console.log(`\n📄 Analyzing: ${filename}`);

  // Simulate cache check
  const isCached = Math.random() < 0.3; // 30% cache hit rate

  if (isCached) {
    const model = 'openrouter/auto';
    const requestId = logger.logCallStarted(model, 0);
    logger.logCallSkippedCache(requestId, 'Output file already exists');
    return;
  }

  // Simulate reading file and building prompt
  const mockPrompt = `Analyze news about ETF TRUR. Content: ${filename} contains mock news content about fund rebalancing...`;

  try {
    await mockCallOpenRouter(mockPrompt, logger);
    console.log(`💾 Saved analysis for ${filename}`);
  } catch (error) {
    console.log(`❌ Failed to analyze ${filename}: ${(error as Error).message}`);
  }
}

// Main demo function
async function runDemo() {
  const logger = new MockLLMLogger();

  console.log('🎯 Simulating news analysis workflow with LLM logging...\n');

  // Simulate analyzing multiple news files
  const newsFiles = [
    'news_2024_01_15_rebalancing.md',
    'news_2024_01_16_dividends.md',
    'news_2024_01_17_redemption.md',
    'news_2024_01_18_quarterly.md',
    'news_2024_01_19_holdings.md'
  ];

  for (const file of newsFiles) {
    await mockAnalyzeFile(file, logger);
    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between files
  }

  // Display final summary
  console.log('\n' + '='.repeat(60));
  const summary = logger.getIterationSummary();
  console.log(logger.formatSummary(summary));

  console.log('\n📊 Detailed Metrics:');
  console.log(`  Processing Time: ${summary.averageResponseTime.toFixed(0)}ms avg`);
  console.log(`  Cost Efficiency: ${summary.cacheHitRate.toFixed(1)}% cache hits saved costs`);
  console.log(`  Reliability: ${(100 - summary.errorRate).toFixed(1)}% success rate`);

  console.log('\n💾 Data Persistence:');
  console.log('  • Events logged to: logs/llm_events_YYYY-MM-DD.json');
  console.log('  • Daily metrics: logs/llm_metrics_YYYY-MM-DD.json');
  console.log('  • Integration with existing expense tracking system');

  console.log('\n🎉 Demo completed! LLM logging system is ready for production use.');

  return summary;
}

// Run the demo
runDemo().catch(console.error);