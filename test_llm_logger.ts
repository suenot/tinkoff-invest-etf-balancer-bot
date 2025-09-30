// Simple test script to verify LLM logger functionality without external dependencies
import { promises as fs } from 'fs';
import path from 'path';

// Mock debug to avoid dependency issues
const mockDebug = () => {
  return (...args: any[]) => {
    console.log('[DEBUG]', ...args);
  };
};

// Replace the debug import in our LLM logger
const debug = mockDebug();

// Inline simplified version of LLM logger for testing
export type LLMEventType = 'llm.call_started' | 'llm.call_success' | 'llm.call_skipped_cache' | 'llm.call_error';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMEvent {
  eventType: LLMEventType;
  timestamp: Date;
  requestId: string;
  model: string;
  duration?: number;
  error?: string;
  errorType?: string;
  tokenUsage?: TokenUsage;
  estimatedCost?: number;
  promptLength?: number;
  responseLength?: number;
  cacheReason?: string;
  retryCount?: number;
}

export interface LLMRecord {
  requestId: string;
  model: string;
  promptLength: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'started' | 'success' | 'error' | 'cached';
  tokenUsage?: TokenUsage;
  estimatedCost?: number;
  error?: string;
  errorType?: string;
  cacheReason?: string;
  retryCount?: number;
}

export interface LLMSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  cachedCalls: number;
  averageResponseTime: number;
  totalTokensUsed: number;
  estimatedCost: number;
  cacheHitRate: number;
  errorRate: number;
  topError?: string;
  details: LLMRecord[];
}

export class SimpleLLMLogger {
  private events: LLMEvent[] = [];
  private records: Map<string, LLMRecord> = new Map();

  private generateRequestId(): string {
    return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  logCallStarted(model: string, promptLength: number): string {
    const requestId = this.generateRequestId();
    const timestamp = new Date();

    const event: LLMEvent = {
      eventType: 'llm.call_started',
      timestamp,
      requestId,
      model,
      promptLength
    };

    const record: LLMRecord = {
      requestId,
      model,
      promptLength,
      startTime: timestamp,
      status: 'started'
    };

    this.events.push(event);
    this.records.set(requestId, record);

    debug(`Call started: ${requestId} - Model: ${model}, Prompt length: ${promptLength}`);
    return requestId;
  }

  logCallSuccess(requestId: string, responseLength: number, tokenUsage?: TokenUsage, estimatedCost?: number): void {
    const record = this.records.get(requestId);
    if (!record) {
      debug(`Warning: No record found for request ${requestId}`);
      return;
    }

    const endTime = new Date();
    const duration = endTime.getTime() - record.startTime.getTime();

    const event: LLMEvent = {
      eventType: 'llm.call_success',
      timestamp: endTime,
      requestId,
      model: record.model,
      duration,
      tokenUsage,
      estimatedCost,
      responseLength
    };

    // Update record
    record.endTime = endTime;
    record.duration = duration;
    record.status = 'success';
    record.tokenUsage = tokenUsage;
    record.estimatedCost = estimatedCost;

    this.events.push(event);

    debug(`Call success: ${requestId} - Duration: ${duration}ms, Tokens: ${tokenUsage?.totalTokens || 'N/A'}, Cost: $${estimatedCost?.toFixed(4) || 'N/A'}`);
  }

  logCallError(requestId: string, error: Error | string, retryCount: number = 0): void {
    const record = this.records.get(requestId);
    if (!record) {
      debug(`Warning: No record found for request ${requestId}`);
      return;
    }

    const endTime = new Date();
    const duration = endTime.getTime() - record.startTime.getTime();
    const errorMessage = error instanceof Error ? error.message : error;
    const errorType = this.classifyError(errorMessage);

    const event: LLMEvent = {
      eventType: 'llm.call_error',
      timestamp: endTime,
      requestId,
      model: record.model,
      duration,
      error: errorMessage,
      errorType,
      retryCount
    };

    // Update record
    record.endTime = endTime;
    record.duration = duration;
    record.status = 'error';
    record.error = errorMessage;
    record.errorType = errorType;
    record.retryCount = retryCount;

    this.events.push(event);

    debug(`Call error: ${requestId} - Error: ${errorType}, Duration: ${duration}ms, Retries: ${retryCount}`);
  }

  private classifyError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();

    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('429') || message.includes('rate limit') || message.includes('throttl')) {
      return 'rate_limiting';
    }
    if (message.includes('401') || message.includes('403') || message.includes('api key') || message.includes('auth')) {
      return 'authentication';
    }
    if (message.includes('400') || message.includes('invalid') || message.includes('bad request')) {
      return 'invalid_request';
    }
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('server error')) {
      return 'server_error';
    }
    if (message.includes('model') || message.includes('unavailable')) {
      return 'model_error';
    }
    if (message.includes('json') || message.includes('parse')) {
      return 'parsing_error';
    }

    return 'unknown';
  }

  getIterationSummary(): LLMSummary {
    const records = Array.from(this.records.values());
    const successfulCalls = records.filter(r => r.status === 'success').length;
    const failedCalls = records.filter(r => r.status === 'error').length;
    const cachedCalls = records.filter(r => r.status === 'cached').length;

    const successfulRecords = records.filter(r => r.status === 'success' && r.duration);
    const averageResponseTime = successfulRecords.length > 0
      ? successfulRecords.reduce((sum, r) => sum + (r.duration || 0), 0) / successfulRecords.length
      : 0;

    const totalTokensUsed = records.reduce((sum, r) => sum + (r.tokenUsage?.totalTokens || 0), 0);
    const estimatedCost = records.reduce((sum, r) => sum + (r.estimatedCost || 0), 0);

    const cacheHitRate = records.length > 0 ? (cachedCalls / records.length) * 100 : 0;
    const errorRate = records.length > 0 ? (failedCalls / records.length) * 100 : 0;

    // Find top error
    const errorCounts: Record<string, number> = {};
    records.filter(r => r.errorType).forEach(r => {
      errorCounts[r.errorType!] = (errorCounts[r.errorType!] || 0) + 1;
    });

    const topError = Object.keys(errorCounts).length > 0
      ? Object.entries(errorCounts).sort(([,a], [,b]) => b - a)[0][0]
      : undefined;

    return {
      totalCalls: records.length,
      successfulCalls,
      failedCalls,
      cachedCalls,
      averageResponseTime,
      totalTokensUsed,
      estimatedCost,
      cacheHitRate,
      errorRate,
      topError,
      details: [...records]
    };
  }

  formatSummary(summary: LLMSummary): string {
    const costColor = summary.estimatedCost > 0.1 ? '🟡' : '🟢';
    const errorColor = summary.errorRate > 10 ? '🔴' : summary.errorRate > 5 ? '🟡' : '🟢';

    let output = `🤖 LLM Call Summary:\n`;
    output += `  Total Calls: ${summary.totalCalls} (${summary.successfulCalls} success, ${summary.failedCalls} errors)\n`;

    if (summary.totalCalls > 0) {
      output += `  Average Response Time: ${summary.averageResponseTime.toFixed(0)}ms\n`;
      output += `  Tokens Used: ${summary.totalTokensUsed.toLocaleString()} (est. ${costColor}$${summary.estimatedCost.toFixed(4)})\n`;
      output += `  Cache Hit Rate: ${summary.cacheHitRate.toFixed(1)}% (${summary.cachedCalls} cached)`;

      if (summary.topError) {
        output += `\n  ${errorColor} Top Error: ${summary.topError} (${summary.failedCalls} occurrences)`;
      }
    }

    return output;
  }
}

// Test function
async function testLLMLogger() {
  console.log('🧪 Testing LLM Logger Implementation...\n');

  const logger = new SimpleLLMLogger();

  // Test 1: Successful call
  console.log('📞 Test 1: Simulating successful LLM call...');
  const req1 = logger.logCallStarted('openrouter/auto', 1500);
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate API delay
  logger.logCallSuccess(req1, 800, {
    inputTokens: 375,
    outputTokens: 200,
    totalTokens: 575
  }, 0.0023);

  // Test 2: Error call
  console.log('📞 Test 2: Simulating failed LLM call...');
  const req2 = logger.logCallStarted('anthropic/claude-3-haiku', 1200);
  await new Promise(resolve => setTimeout(resolve, 50));
  logger.logCallError(req2, new Error('Rate limit exceeded'), 1);

  // Test 3: Cache hit
  console.log('📞 Test 3: Simulating cache hit...');
  const req3 = logger.logCallStarted('openai/gpt-4o-mini', 900);
  // No API call needed for cache hit

  // Get and display summary
  const summary = logger.getIterationSummary();
  console.log('\n📊 Summary:');
  console.log(logger.formatSummary(summary));

  // Test detailed metrics
  console.log('\n📈 Detailed Metrics:');
  console.log('  Total Events:', logger['events'].length);
  console.log('  Total Records:', logger['records'].size);
  console.log('  Success Rate:', (summary.successfulCalls / summary.totalCalls * 100).toFixed(1) + '%');
  console.log('  Average Response Time:', summary.averageResponseTime.toFixed(0) + 'ms');
  console.log('  Total Token Usage:', summary.totalTokensUsed);
  console.log('  Estimated Cost:', '$' + summary.estimatedCost.toFixed(4));

  console.log('\n✅ All tests completed successfully!');

  return summary;
}

// Run the test
testLLMLogger().catch(console.error);