// Main entry point for the hybrid news analysis system

export * from './types';
export * from './config';
export * from './ruleEngine';
export * from './llmProcessor';
export * from './coordinator';
export * from './monitoring';

import { HybridAnalysisCoordinator } from './coordinator';
import { ConfigManager } from './config';
import {
  HybridAnalysisRequest,
  HybridAnalysisResult,
  NewsContent,
  AnalysisOptions,
  ProcessingMethod,
  HybridConfig
} from './types';

/**
 * Main class for hybrid news analysis
 * Provides a simplified interface for the hybrid analysis system
 */
export class HybridNewsAnalysis {
  private coordinator: HybridAnalysisCoordinator;

  constructor(config?: Partial<HybridConfig>) {
    const configManager = config ? new ConfigManager(config) : ConfigManager.fromEnvironment();
    this.coordinator = new HybridAnalysisCoordinator(configManager);
  }

  /**
   * Analyze a single news article using the hybrid approach
   */
  async analyzeNews(
    content: NewsContent,
    options?: Partial<AnalysisOptions>
  ): Promise<HybridAnalysisResult> {
    const defaultOptions: AnalysisOptions = {
      enableLLM: true,
      confidenceThreshold: 0.7,
      validateResults: true,
      includeMetrics: true
    };

    const finalOptions = { ...defaultOptions, ...options };

    const request: HybridAnalysisRequest = {
      content,
      options: finalOptions
    };

    return await this.coordinator.processNews(request);
  }

  /**
   * Analyze multiple news articles in batch
   */
  async analyzeMultipleNews(
    contentArray: NewsContent[],
    options?: Partial<AnalysisOptions>
  ): Promise<HybridAnalysisResult[]> {
    const defaultOptions: AnalysisOptions = {
      enableLLM: true,
      confidenceThreshold: 0.7,
      validateResults: true,
      includeMetrics: true
    };

    const finalOptions = { ...defaultOptions, ...options };

    const requests: HybridAnalysisRequest[] = contentArray.map(content => ({
      content,
      options: finalOptions
    }));

    return await this.coordinator.processMultipleNews(requests);
  }

  /**
   * Force processing with a specific method
   */
  async analyzeWithMethod(
    content: NewsContent,
    method: ProcessingMethod,
    options?: Partial<AnalysisOptions>
  ): Promise<HybridAnalysisResult> {
    const defaultOptions: AnalysisOptions = {
      enableLLM: true,
      confidenceThreshold: 0.7,
      validateResults: true,
      includeMetrics: true,
      forceMethod: method
    };

    const finalOptions = { ...defaultOptions, ...options };

    const request: HybridAnalysisRequest = {
      content,
      options: finalOptions
    };

    return await this.coordinator.processNews(request);
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return this.coordinator.getProcessingStats();
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<HybridConfig>): void {
    this.coordinator.getConfig().updateConfig(config);
  }

  /**
   * Get current configuration
   */
  getConfig(): HybridConfig {
    return this.coordinator.getConfig().getConfig();
  }

  /**
   * Add a custom rule to the rule engine
   */
  addCustomRule(rule: any): void {
    this.coordinator.getRuleEngine().addRule(rule);
  }

  /**
   * Remove a rule from the rule engine
   */
  removeRule(ruleName: string): boolean {
    return this.coordinator.getRuleEngine().removeRule(ruleName);
  }

  /**
   * Get list of available rules
   */
  getAvailableRules(): string[] {
    return this.coordinator.getRuleEngine().getRuleNames();
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(timeRangeHours?: number) {
    return this.coordinator.getMonitor().getAggregatedStats(timeRangeHours);
  }

  /**
   * Print detailed performance report
   */
  printPerformanceReport(timeRangeHours?: number): void {
    this.coordinator.getMonitor().printDetailedReport(timeRangeHours);
  }

  /**
   * Export processing metrics
   */
  exportMetrics(format: 'json' | 'csv' = 'json'): string {
    return this.coordinator.getMonitor().exportMetrics(format);
  }

  /**
   * Get system health status
   */
  getHealthStatus() {
    return this.coordinator.getMonitor().checkHealthStatus();
  }

  /**
   * Clear all monitoring metrics
   */
  clearMetrics(): void {
    this.coordinator.getMonitor().clearMetrics();
  }

  /**
   * Get recent processing metrics
   */
  getRecentMetrics(count: number = 10) {
    return this.coordinator.getMonitor().getRecentMetrics(count);
  }
}

/**
 * Factory function to create a HybridNewsAnalysis instance with environment configuration
 */
export function createHybridNewsAnalysis(config?: Partial<HybridConfig>): HybridNewsAnalysis {
  return new HybridNewsAnalysis(config);
}

/**
 * Utility function to create NewsContent from basic parameters
 */
export function createNewsContent(
  id: string,
  symbol: string,
  title: string,
  content: string,
  date: string,
  source: string = 'unknown',
  metadata?: Record<string, any>
): NewsContent {
  return {
    id,
    symbol,
    title,
    content,
    date,
    source,
    metadata
  };
}

/**
 * Default export for convenience
 */
export default HybridNewsAnalysis;