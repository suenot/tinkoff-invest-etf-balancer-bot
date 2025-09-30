import debug from 'debug';
import { promises as fs } from 'fs';
import path from 'path';

const debugLLM = debug('bot').extend('llm');

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

export interface LLMMetrics {
  date: string; // YYYY-MM-DD format in Moscow timezone
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  cachedCalls: number;
  averageResponseTime: number;
  totalTokensUsed: number;
  estimatedCost: number;
  errorBreakdown: Record<string, number>;
  modelUsage: Record<string, number>;
  hourlyDistribution: number[]; // 24-hour distribution
  lastUpdated: Date;
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

export class LLMLogger {
  private events: LLMEvent[] = [];
  private records: Map<string, LLMRecord> = new Map();

  private generateRequestId(): string {
    return `llm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getMoscowDate(): string {
    // Get current date in Moscow timezone (UTC+3)
    const now = new Date();
    const moscowOffset = 3 * 60; // Moscow is UTC+3
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const moscowTime = new Date(utcTime + moscowOffset * 60000);

    const year = moscowTime.getFullYear();
    const month = String(moscowTime.getMonth() + 1).padStart(2, '0');
    const day = String(moscowTime.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private getMoscowHour(): number {
    const now = new Date();
    const moscowOffset = 3 * 60; // Moscow is UTC+3
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const moscowTime = new Date(utcTime + moscowOffset * 60000);
    return moscowTime.getHours();
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

    debugLLM(`Call started: ${requestId} - Model: ${model}, Prompt length: ${promptLength}`);
    return requestId;
  }

  logCallSuccess(requestId: string, responseLength: number, tokenUsage?: TokenUsage, estimatedCost?: number): void {
    const record = this.records.get(requestId);
    if (!record) {
      debugLLM(`Warning: No record found for request ${requestId}`);
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

    debugLLM(`Call success: ${requestId} - Duration: ${duration}ms, Tokens: ${tokenUsage?.totalTokens || 'N/A'}, Cost: $${estimatedCost?.toFixed(4) || 'N/A'}`);
  }

  logCallSkippedCache(requestId: string, cacheReason: string, savedCost?: number): void {
    const record = this.records.get(requestId);
    if (!record) {
      debugLLM(`Warning: No record found for request ${requestId}`);
      return;
    }

    const event: LLMEvent = {
      eventType: 'llm.call_skipped_cache',
      timestamp: new Date(),
      requestId,
      model: record.model,
      cacheReason,
      estimatedCost: savedCost
    };

    // Update record
    record.status = 'cached';
    record.cacheReason = cacheReason;
    record.estimatedCost = savedCost;

    this.events.push(event);

    debugLLM(`Call cached: ${requestId} - Reason: ${cacheReason}, Saved: $${savedCost?.toFixed(4) || 'N/A'}`);
  }

  logCallError(requestId: string, error: Error | string, retryCount: number = 0): void {
    const record = this.records.get(requestId);
    if (!record) {
      debugLLM(`Warning: No record found for request ${requestId}`);
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

    debugLLM(`Call error: ${requestId} - Error: ${errorType}, Duration: ${duration}ms, Retries: ${retryCount}`);
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

  clearIterationData(): void {
    debugLLM(`Clearing ${this.events.length} events and ${this.records.size} records`);
    this.events = [];
    this.records.clear();
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

  // Export events and records to files
  async exportData(logsDir?: string): Promise<void> {
    const dir = logsDir || path.join(process.cwd(), 'logs');

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      debugLLM('Error creating logs directory:', error);
      return;
    }

    const today = this.getMoscowDate();

    try {
      // Export events
      const eventsFile = path.join(dir, `llm_events_${today}.json`);
      await fs.writeFile(eventsFile, JSON.stringify(this.events, null, 2));

      // Export records summary
      const summary = this.getIterationSummary();
      const summaryFile = path.join(dir, `llm_summary_${today}.json`);
      await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2));

      debugLLM(`LLM data exported to ${dir}`);
    } catch (error) {
      debugLLM('Error exporting LLM data:', error);
    }
  }
}

export class LLMMetricsCollector {
  private currentDay: string;
  private dailyMetrics: LLMMetrics;

  constructor() {
    this.currentDay = this.getMoscowDate();
    this.dailyMetrics = this.initializeDailyMetrics();
  }

  private getMoscowDate(): string {
    // Get current date in Moscow timezone (UTC+3)
    const now = new Date();
    const moscowOffset = 3 * 60; // Moscow is UTC+3
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const moscowTime = new Date(utcTime + moscowOffset * 60000);

    const year = moscowTime.getFullYear();
    const month = String(moscowTime.getMonth() + 1).padStart(2, '0');
    const day = String(moscowTime.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private getMoscowHour(): number {
    const now = new Date();
    const moscowOffset = 3 * 60; // Moscow is UTC+3
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const moscowTime = new Date(utcTime + moscowOffset * 60000);
    return moscowTime.getHours();
  }

  private initializeDailyMetrics(): LLMMetrics {
    return {
      date: this.currentDay,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      cachedCalls: 0,
      averageResponseTime: 0,
      totalTokensUsed: 0,
      estimatedCost: 0,
      errorBreakdown: {},
      modelUsage: {},
      hourlyDistribution: new Array(24).fill(0),
      lastUpdated: new Date()
    };
  }

  addEvent(event: LLMEvent): void {
    const currentDate = this.getMoscowDate();

    // Check if we need to reset for a new day
    if (currentDate !== this.currentDay) {
      debugLLM(`New day detected: ${currentDate}. Resetting daily metrics.`);
      this.currentDay = currentDate;
      this.dailyMetrics = this.initializeDailyMetrics();
    }

    // Update hourly distribution
    const hour = this.getMoscowHour();
    this.dailyMetrics.hourlyDistribution[hour]++;

    // Update model usage
    this.dailyMetrics.modelUsage[event.model] = (this.dailyMetrics.modelUsage[event.model] || 0) + 1;

    // Update metrics based on event type
    switch (event.eventType) {
      case 'llm.call_started':
        // Don't count started events toward total calls to avoid double counting
        break;

      case 'llm.call_success':
        this.dailyMetrics.totalCalls++;
        this.dailyMetrics.successfulCalls++;
        if (event.duration) {
          // Recalculate average response time
          const previousTotal = this.dailyMetrics.averageResponseTime * (this.dailyMetrics.successfulCalls - 1);
          this.dailyMetrics.averageResponseTime = (previousTotal + event.duration) / this.dailyMetrics.successfulCalls;
        }
        if (event.tokenUsage) {
          this.dailyMetrics.totalTokensUsed += event.tokenUsage.totalTokens;
        }
        if (event.estimatedCost) {
          this.dailyMetrics.estimatedCost += event.estimatedCost;
        }
        break;

      case 'llm.call_skipped_cache':
        this.dailyMetrics.totalCalls++;
        this.dailyMetrics.cachedCalls++;
        break;

      case 'llm.call_error':
        this.dailyMetrics.totalCalls++;
        this.dailyMetrics.failedCalls++;
        if (event.errorType) {
          this.dailyMetrics.errorBreakdown[event.errorType] =
            (this.dailyMetrics.errorBreakdown[event.errorType] || 0) + 1;
        }
        break;
    }

    this.dailyMetrics.lastUpdated = new Date();

    debugLLM(`Updated daily metrics: Total calls: ${this.dailyMetrics.totalCalls}, ` +
              `Success: ${this.dailyMetrics.successfulCalls}, ` +
              `Errors: ${this.dailyMetrics.failedCalls}, ` +
              `Cached: ${this.dailyMetrics.cachedCalls}`);
  }

  getCurrentMetrics(): LLMMetrics {
    return { ...this.dailyMetrics };
  }

  resetDailyMetrics(): void {
    debugLLM('Manually resetting daily metrics');
    this.dailyMetrics = this.initializeDailyMetrics();
  }

  async exportMetrics(filepath?: string): Promise<void> {
    const dir = path.join(process.cwd(), 'logs');

    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      debugLLM('Error creating logs directory:', error);
      return;
    }

    const filename = filepath || path.join(dir, `llm_metrics_${this.currentDay}.json`);

    try {
      await fs.writeFile(filename, JSON.stringify(this.dailyMetrics, null, 2));
      debugLLM(`Daily LLM metrics exported to ${filename}`);
    } catch (error) {
      debugLLM('Error exporting LLM metrics:', error);
    }
  }

  formatDailySummary(): string {
    const metrics = this.dailyMetrics;
    const successRate = metrics.totalCalls > 0 ? (metrics.successfulCalls / metrics.totalCalls) * 100 : 0;
    const errorRate = metrics.totalCalls > 0 ? (metrics.failedCalls / metrics.totalCalls) * 100 : 0;
    const cacheRate = metrics.totalCalls > 0 ? (metrics.cachedCalls / metrics.totalCalls) * 100 : 0;

    const healthColor = successRate >= 95 ? '🟢' : successRate >= 85 ? '🟡' : '🔴';
    const costColor = metrics.estimatedCost > 1 ? '🔴' : metrics.estimatedCost > 0.1 ? '🟡' : '🟢';

    let output = `\n🤖 Daily LLM Summary (${metrics.date} MSK):\n`;
    output += `  Total Calls: ${metrics.totalCalls}\n`;
    output += `  ${healthColor} Success Rate: ${successRate.toFixed(1)}% (${metrics.successfulCalls} successful)\n`;
    output += `  Error Rate: ${errorRate.toFixed(1)}% (${metrics.failedCalls} errors)\n`;
    output += `  Cache Hit Rate: ${cacheRate.toFixed(1)}% (${metrics.cachedCalls} cached)\n`;

    if (metrics.successfulCalls > 0) {
      output += `  Avg Response Time: ${metrics.averageResponseTime.toFixed(0)}ms\n`;
    }

    output += `  Tokens Used: ${metrics.totalTokensUsed.toLocaleString()}\n`;
    output += `  ${costColor} Estimated Cost: $${metrics.estimatedCost.toFixed(4)}`;

    return output;
  }
}

// Global instances for tracking LLM usage across the application
export const llmLogger = new LLMLogger();
export const llmMetricsCollector = new LLMMetricsCollector();