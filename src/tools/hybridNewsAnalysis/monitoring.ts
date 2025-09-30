import { ProcessingMethod, NewsCategory, HybridAnalysisResult, ProcessingStats } from './types';
import { ConfigManager } from './config';

export interface ProcessingMetrics {
  processingMethod: ProcessingMethod;
  category: NewsCategory;
  confidence: number;
  processingTimeMs: number;
  fallbackUsed: boolean;
  apiCalls: number;
  success: boolean;
  errorCode?: string;
  timestamp: Date;
  newsId: string;
  symbol: string;
}

export interface AggregatedStats {
  totalProcessed: number;
  successRate: number;
  ruleBasedSuccesses: number;
  ruleBasedSuccessRate: number;
  llmFallbacks: number;
  llmFallbackRate: number;
  averageProcessingTime: number;
  averageConfidence: number;
  totalApiCalls: number;
  estimatedCost: number;
  categoryDistribution: Record<NewsCategory, number>;
  errorDistribution: Record<string, number>;
  timeRange: {
    start: Date;
    end: Date;
  };
}

export class HybridAnalysisMonitor {
  private metrics: ProcessingMetrics[] = [];
  private config: ConfigManager;
  private readonly LOG_PREFIX = '[HybridMonitor]';
  private readonly MAX_METRICS_IN_MEMORY = 10000;
  private readonly COST_PER_API_CALL = 0.001; // Estimated cost in USD

  constructor(config: ConfigManager) {
    this.config = config;
  }

  recordProcessing(result: HybridAnalysisResult, newsId: string, symbol: string): void {
    if (!this.config.getMonitoringConfig().enabled) return;

    const metric: ProcessingMetrics = {
      processingMethod: result.processingMethod,
      category: result.category,
      confidence: result.confidence,
      processingTimeMs: result.processingTimeMs,
      fallbackUsed: result.fallbackUsed,
      apiCalls: result.metadata.apiCalls,
      success: true,
      timestamp: new Date(),
      newsId,
      symbol
    };

    this.addMetric(metric);
    this.logProcessing(metric);
  }

  recordError(
    error: Error,
    newsId: string,
    symbol: string,
    processingMethod: ProcessingMethod,
    processingTimeMs: number = 0
  ): void {
    if (!this.config.getMonitoringConfig().enabled) return;

    const metric: ProcessingMetrics = {
      processingMethod,
      category: NewsCategory.OTHER,
      confidence: 0,
      processingTimeMs,
      fallbackUsed: false,
      apiCalls: 0,
      success: false,
      errorCode: error.name || 'UnknownError',
      timestamp: new Date(),
      newsId,
      symbol
    };

    this.addMetric(metric);
    this.logError(metric, error);
  }

  private addMetric(metric: ProcessingMetrics): void {
    this.metrics.push(metric);

    // Trim metrics if we exceed the limit
    if (this.metrics.length > this.MAX_METRICS_IN_MEMORY) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS_IN_MEMORY);
      this.config.log('debug', 'Trimmed metrics to maintain memory limit');
    }
  }

  private logProcessing(metric: ProcessingMetrics): void {
    const methodColor = this.getMethodColor(metric.processingMethod);
    const confidenceColor = this.getConfidenceColor(metric.confidence);

    this.config.log('info',
      `Processed ${metric.symbol}/${metric.newsId} | ` +
      `Method: ${methodColor}${metric.processingMethod}${this.resetColor()} | ` +
      `Category: ${metric.category} | ` +
      `Confidence: ${confidenceColor}${metric.confidence.toFixed(2)}${this.resetColor()} | ` +
      `Time: ${metric.processingTimeMs}ms | ` +
      `API Calls: ${metric.apiCalls}`
    );

    if (metric.fallbackUsed) {
      this.config.log('warn', `Fallback used for ${metric.symbol}/${metric.newsId}`);
    }
  }

  private logError(metric: ProcessingMetrics, error: Error): void {
    this.config.log('error',
      `Failed to process ${metric.symbol}/${metric.newsId} | ` +
      `Method: ${metric.processingMethod} | ` +
      `Error: ${metric.errorCode} | ` +
      `Time: ${metric.processingTimeMs}ms`,
      error
    );
  }

  private getMethodColor(method: ProcessingMethod): string {
    if (!process.stdout.isTTY) return '';

    switch (method) {
      case ProcessingMethod.RULE_BASED: return '\x1b[32m'; // Green
      case ProcessingMethod.LLM_FALLBACK: return '\x1b[33m'; // Yellow
      case ProcessingMethod.LLM_FORCED: return '\x1b[31m'; // Red
      case ProcessingMethod.LLM_VALIDATION: return '\x1b[36m'; // Cyan
      default: return '';
    }
  }

  private getConfidenceColor(confidence: number): string {
    if (!process.stdout.isTTY) return '';

    if (confidence >= 0.8) return '\x1b[32m'; // Green
    if (confidence >= 0.6) return '\x1b[33m'; // Yellow
    return '\x1b[31m'; // Red
  }

  private resetColor(): string {
    return process.stdout.isTTY ? '\x1b[0m' : '';
  }

  getAggregatedStats(timeRangeHours?: number): AggregatedStats {
    let relevantMetrics = this.metrics;

    // Filter by time range if specified
    if (timeRangeHours) {
      const cutoff = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
      relevantMetrics = this.metrics.filter(m => m.timestamp >= cutoff);
    }

    if (relevantMetrics.length === 0) {
      return this.getEmptyStats();
    }

    const totalProcessed = relevantMetrics.length;
    const successfulMetrics = relevantMetrics.filter(m => m.success);
    const ruleBasedSuccesses = successfulMetrics.filter(m => m.processingMethod === ProcessingMethod.RULE_BASED);
    const llmFallbacks = successfulMetrics.filter(m => m.fallbackUsed);

    const totalProcessingTime = relevantMetrics.reduce((sum, m) => sum + m.processingTimeMs, 0);
    const totalConfidence = successfulMetrics.reduce((sum, m) => sum + m.confidence, 0);
    const totalApiCalls = relevantMetrics.reduce((sum, m) => sum + m.apiCalls, 0);

    // Category distribution
    const categoryDistribution = {} as Record<NewsCategory, number>;
    Object.values(NewsCategory).forEach(category => {
      categoryDistribution[category] = successfulMetrics.filter(m => m.category === category).length;
    });

    // Error distribution
    const errorDistribution: Record<string, number> = {};
    relevantMetrics.filter(m => !m.success).forEach(m => {
      const errorCode = m.errorCode || 'Unknown';
      errorDistribution[errorCode] = (errorDistribution[errorCode] || 0) + 1;
    });

    const timestamps = relevantMetrics.map(m => m.timestamp);

    return {
      totalProcessed,
      successRate: successfulMetrics.length / totalProcessed,
      ruleBasedSuccesses: ruleBasedSuccesses.length,
      ruleBasedSuccessRate: ruleBasedSuccesses.length / totalProcessed,
      llmFallbacks: llmFallbacks.length,
      llmFallbackRate: llmFallbacks.length / totalProcessed,
      averageProcessingTime: totalProcessingTime / totalProcessed,
      averageConfidence: successfulMetrics.length > 0 ? totalConfidence / successfulMetrics.length : 0,
      totalApiCalls,
      estimatedCost: totalApiCalls * this.COST_PER_API_CALL,
      categoryDistribution,
      errorDistribution,
      timeRange: {
        start: new Date(Math.min(...timestamps.map(t => t.getTime()))),
        end: new Date(Math.max(...timestamps.map(t => t.getTime())))
      }
    };
  }

  private getEmptyStats(): AggregatedStats {
    return {
      totalProcessed: 0,
      successRate: 0,
      ruleBasedSuccesses: 0,
      ruleBasedSuccessRate: 0,
      llmFallbacks: 0,
      llmFallbackRate: 0,
      averageProcessingTime: 0,
      averageConfidence: 0,
      totalApiCalls: 0,
      estimatedCost: 0,
      categoryDistribution: Object.values(NewsCategory).reduce((acc, cat) => {
        acc[cat] = 0;
        return acc;
      }, {} as Record<NewsCategory, number>),
      errorDistribution: {},
      timeRange: {
        start: new Date(),
        end: new Date()
      }
    };
  }

  printDetailedReport(timeRangeHours?: number): void {
    const stats = this.getAggregatedStats(timeRangeHours);

    console.log('\n' + '='.repeat(60));
    console.log('📊 HYBRID NEWS ANALYSIS PERFORMANCE REPORT');
    console.log('='.repeat(60));

    console.log(`\n📈 Overall Statistics:`);
    console.log(`   Total Processed: ${stats.totalProcessed}`);
    console.log(`   Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
    console.log(`   Average Processing Time: ${stats.averageProcessingTime.toFixed(0)}ms`);
    console.log(`   Average Confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`);

    console.log(`\n🎯 Processing Methods:`);
    console.log(`   Rule-Based Successes: ${stats.ruleBasedSuccesses} (${(stats.ruleBasedSuccessRate * 100).toFixed(1)}%)`);
    console.log(`   LLM Fallbacks: ${stats.llmFallbacks} (${(stats.llmFallbackRate * 100).toFixed(1)}%)`);

    console.log(`\n💰 Cost Analysis:`);
    console.log(`   Total API Calls: ${stats.totalApiCalls}`);
    console.log(`   Estimated Cost: $${stats.estimatedCost.toFixed(4)}`);

    console.log(`\n📋 Category Distribution:`);
    Object.entries(stats.categoryDistribution).forEach(([category, count]) => {
      if (count > 0) {
        const percentage = (count / stats.totalProcessed * 100).toFixed(1);
        console.log(`   ${category}: ${count} (${percentage}%)`);
      }
    });

    if (Object.keys(stats.errorDistribution).length > 0) {
      console.log(`\n⚠️  Error Distribution:`);
      Object.entries(stats.errorDistribution).forEach(([error, count]) => {
        const percentage = (count / stats.totalProcessed * 100).toFixed(1);
        console.log(`   ${error}: ${count} (${percentage}%)`);
      });
    }

    console.log(`\n⏰ Time Range:`);
    console.log(`   From: ${stats.timeRange.start.toISOString()}`);
    console.log(`   To: ${stats.timeRange.end.toISOString()}`);

    console.log('\n' + '='.repeat(60));
  }

  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2);
    }

    // CSV format
    const headers = [
      'timestamp', 'newsId', 'symbol', 'processingMethod', 'category',
      'confidence', 'processingTimeMs', 'fallbackUsed', 'apiCalls',
      'success', 'errorCode'
    ];

    const rows = this.metrics.map(m => [
      m.timestamp.toISOString(),
      m.newsId,
      m.symbol,
      m.processingMethod,
      m.category,
      m.confidence.toString(),
      m.processingTimeMs.toString(),
      m.fallbackUsed.toString(),
      m.apiCalls.toString(),
      m.success.toString(),
      m.errorCode || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  clearMetrics(): void {
    this.metrics = [];
    this.config.log('info', 'Cleared all metrics');
  }

  getRecentMetrics(count: number = 10): ProcessingMetrics[] {
    return this.metrics.slice(-count);
  }

  checkHealthStatus(): {
    status: 'healthy' | 'warning' | 'error';
    message: string;
    recommendations: string[];
  } {
    const stats = this.getAggregatedStats(1); // Last hour
    const recommendations: string[] = [];

    if (stats.totalProcessed === 0) {
      return {
        status: 'warning',
        message: 'No recent processing activity',
        recommendations: ['Check if news analysis is running', 'Verify input data availability']
      };
    }

    if (stats.successRate < 0.8) {
      recommendations.push('High error rate detected - check logs for issues');
    }

    if (stats.llmFallbackRate > 0.5) {
      recommendations.push('High LLM fallback rate - consider improving rule patterns');
    }

    if (stats.averageProcessingTime > 5000) {
      recommendations.push('Slow processing times - consider optimizing LLM calls');
    }

    if (stats.estimatedCost > 1.0) {
      recommendations.push('High API costs - consider enabling more rule-based processing');
    }

    const status = recommendations.length === 0 ? 'healthy' :
                  stats.successRate < 0.5 ? 'error' : 'warning';

    const message = status === 'healthy' ?
      'System operating normally' :
      `${recommendations.length} issues detected`;

    return { status, message, recommendations };
  }
}