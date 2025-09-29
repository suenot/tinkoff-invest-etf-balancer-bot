import {
  HybridAnalysisRequest,
  HybridAnalysisResult,
  NewsContent,
  ProcessingMethod,
  ProcessingMetadata,
  HybridAnalysisError,
  ValidationResult
} from './types';
import { ConfigManager } from './config';
import { RuleEngine } from './ruleEngine';
import { LLMProcessor } from './llmProcessor';
import { HybridAnalysisMonitor } from './monitoring';

export class HybridAnalysisCoordinator {
  private config: ConfigManager;
  private ruleEngine: RuleEngine;
  private llmProcessor: LLMProcessor;
  private monitor: HybridAnalysisMonitor;
  private readonly LOG_PREFIX = '[HybridCoordinator]';

  constructor(config?: ConfigManager) {
    this.config = config || ConfigManager.fromEnvironment();
    this.ruleEngine = new RuleEngine(this.config);
    this.llmProcessor = new LLMProcessor(this.config);
    this.monitor = new HybridAnalysisMonitor(this.config);
  }

  async processNews(request: HybridAnalysisRequest): Promise<HybridAnalysisResult> {
    const startTime = Date.now();
    const metadata: ProcessingMetadata = {
      ruleMatches: [],
      llmUsed: false,
      apiCalls: 0,
      errors: [],
      validationResults: [],
      processingTimeMs: 0
    };

    try {
      this.config.log('info', `Starting hybrid analysis for ${request.content.id}`);

      // Check if hybrid processing is enabled
      if (!this.config.isHybridEnabled()) {
        throw new HybridAnalysisError(
          'Hybrid analysis is disabled',
          'HYBRID_DISABLED'
        );
      }

      // Handle forced processing method
      if (request.options.forceMethod) {
        return await this.processWithForcedMethod(request, metadata, startTime);
      }

      // Try rule-based processing first
      const ruleResult = await this.tryRuleBasedProcessing(request.content, metadata);

      if (ruleResult.success) {
        metadata.processingTimeMs = Date.now() - startTime;
        const result = this.createSuccessResult(
          ProcessingMethod.RULE_BASED,
          ruleResult.data!,
          ruleResult.confidence!,
          false,
          metadata
        );

        // Record successful processing
        this.monitor.recordProcessing(result, request.content.id, request.content.symbol);

        return result;
      }

      // Rule-based failed, try LLM fallback if enabled
      if (this.config.isLLMFallbackEnabled() && request.options.enableLLM) {
        this.config.log('info', `Rules failed for ${request.content.id}, trying LLM fallback`);

        const llmResult = await this.tryLLMProcessing(
          request.content,
          ProcessingMethod.LLM_FALLBACK,
          ruleResult.failureReason,
          metadata
        );

        if (llmResult.success) {
          metadata.processingTimeMs = Date.now() - startTime;
          const result = this.createSuccessResult(
            ProcessingMethod.LLM_FALLBACK,
            llmResult.data!,
            0.8, // Default LLM confidence
            true,
            metadata
          );

          // Record successful LLM fallback
          this.monitor.recordProcessing(result, request.content.id, request.content.symbol);

          return result;
        }
      }

      // Both methods failed
      throw new HybridAnalysisError(
        `Both rule-based and LLM processing failed. Rule failure: ${ruleResult.failureReason}. LLM failure: ${ruleResult.failureReason}`,
        'ALL_METHODS_FAILED'
      );

    } catch (error) {
      metadata.errors.push((error as Error).message);
      metadata.processingTimeMs = Date.now() - startTime;

      this.config.log('error', `Hybrid analysis failed for ${request.content.id}:`, error);

      // Record error
      this.monitor.recordError(
        error as Error,
        request.content.id,
        request.content.symbol,
        ProcessingMethod.RULE_BASED,
        metadata.processingTimeMs
      );

      // Return a default result with error information
      return this.createErrorResult(error as Error, metadata);
    }
  }

  private async processWithForcedMethod(
    request: HybridAnalysisRequest,
    metadata: ProcessingMetadata,
    startTime: number
  ): Promise<HybridAnalysisResult> {
    const { forceMethod } = request.options;

    this.config.log('info', `Forced processing method: ${forceMethod} for ${request.content.id}`);

    switch (forceMethod) {
      case ProcessingMethod.RULE_BASED:
        const ruleResult = await this.tryRuleBasedProcessing(request.content, metadata);
        if (!ruleResult.success) {
          throw new HybridAnalysisError(
            `Forced rule-based processing failed: ${ruleResult.failureReason}`,
            'FORCED_RULE_FAILED'
          );
        }
        metadata.processingTimeMs = Date.now() - startTime;
        return this.createSuccessResult(
          ProcessingMethod.RULE_BASED,
          ruleResult.data!,
          ruleResult.confidence!,
          false,
          metadata
        );

      case ProcessingMethod.LLM_FORCED:
        const llmResult = await this.tryLLMProcessing(
          request.content,
          ProcessingMethod.LLM_FORCED,
          undefined,
          metadata
        );
        if (!llmResult.success) {
          throw new HybridAnalysisError(
            `Forced LLM processing failed: ${llmResult.failureReason}`,
            'FORCED_LLM_FAILED'
          );
        }
        metadata.processingTimeMs = Date.now() - startTime;
        return this.createSuccessResult(
          ProcessingMethod.LLM_FORCED,
          llmResult.data!,
          0.8,
          true,
          metadata
        );

      case ProcessingMethod.LLM_VALIDATION:
        // First try rules, then validate with LLM
        const validationRuleResult = await this.tryRuleBasedProcessing(request.content, metadata);
        if (validationRuleResult.success) {
          // Validate with LLM
          const validationLLMResult = await this.tryLLMProcessing(
            request.content,
            ProcessingMethod.LLM_VALIDATION,
            'Rule validation',
            metadata
          );

          metadata.processingTimeMs = Date.now() - startTime;

          // Compare results and choose the best one
          if (validationLLMResult.success) {
            const finalData = this.reconcileResults(validationRuleResult.data!, validationLLMResult.data!);
            return this.createSuccessResult(
              ProcessingMethod.LLM_VALIDATION,
              finalData,
              Math.max(validationRuleResult.confidence!, 0.8),
              true,
              metadata
            );
          }
        }

        throw new HybridAnalysisError(
          'Validation processing failed on both rule and LLM methods',
          'VALIDATION_FAILED'
        );

      default:
        throw new HybridAnalysisError(
          `Unknown forced processing method: ${forceMethod}`,
          'UNKNOWN_FORCED_METHOD'
        );
    }
  }

  private async tryRuleBasedProcessing(
    content: NewsContent,
    metadata: ProcessingMetadata
  ): Promise<{success: boolean; data?: any; confidence?: number; failureReason?: string}> {
    try {
      if (!this.config.isRulesEnabled()) {
        return {
          success: false,
          failureReason: 'Rule-based processing is disabled'
        };
      }

      this.config.log('debug', `Trying rule-based processing for ${content.id}`);

      const ruleResult = this.ruleEngine.processContent(content);

      if (ruleResult.matched && ruleResult.extractedData) {
        if (ruleResult.ruleMatch) {
          metadata.ruleMatches.push(ruleResult.ruleMatch);
        }

        // Validate result if strict validation is enabled
        if (this.config.isStrictValidation()) {
          const validation = this.validateStructuredData(ruleResult.extractedData);
          metadata.validationResults.push(validation);

          if (!validation.isValid) {
            return {
              success: false,
              failureReason: `Validation failed: ${validation.errors.join(', ')}`
            };
          }
        }

        this.config.log('info', `Rule-based processing succeeded for ${content.id} with confidence ${ruleResult.confidence}`);

        return {
          success: true,
          data: ruleResult.extractedData,
          confidence: ruleResult.confidence
        };
      }

      return {
        success: false,
        failureReason: 'No rule patterns matched the content'
      };

    } catch (error) {
      this.config.log('error', `Rule-based processing error for ${content.id}:`, error);
      return {
        success: false,
        failureReason: `Rule processing error: ${(error as Error).message}`
      };
    }
  }

  private async tryLLMProcessing(
    content: NewsContent,
    method: ProcessingMethod,
    ruleFailureContext: string | undefined,
    metadata: ProcessingMetadata
  ): Promise<{success: boolean; data?: any; failureReason?: string}> {
    try {
      this.config.log('debug', `Trying LLM processing for ${content.id} with method ${method}`);

      const apiCallsBefore = this.llmProcessor.getApiCallCount();

      const llmResult = await this.llmProcessor.processContent(content, method, ruleFailureContext);

      const apiCallsAfter = this.llmProcessor.getApiCallCount();
      metadata.apiCalls += (apiCallsAfter - apiCallsBefore);
      metadata.llmUsed = true;

      // Validate result if strict validation is enabled
      if (this.config.isStrictValidation()) {
        const validation = this.validateStructuredData(llmResult);
        metadata.validationResults.push(validation);

        if (!validation.isValid) {
          return {
            success: false,
            failureReason: `LLM result validation failed: ${validation.errors.join(', ')}`
          };
        }
      }

      this.config.log('info', `LLM processing succeeded for ${content.id}`);

      return {
        success: true,
        data: llmResult
      };

    } catch (error) {
      this.config.log('error', `LLM processing error for ${content.id}:`, error);
      return {
        success: false,
        failureReason: `LLM processing error: ${(error as Error).message}`
      };
    }
  }

  private validateStructuredData(data: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!data.id) errors.push('Missing id field');
    if (!data.symbol) errors.push('Missing symbol field');
    if (!data.title) errors.push('Missing title field');
    if (!data.category) errors.push('Missing category field');

    // Check array types
    if (data.bullets && !Array.isArray(data.bullets)) {
      errors.push('bullets must be an array');
    }
    if (data.trades && !Array.isArray(data.trades)) {
      errors.push('trades must be an array');
    }

    // Check object types
    if (data.additionalFields && typeof data.additionalFields !== 'object') {
      errors.push('additionalFields must be an object');
    }
    if (data.numbers && typeof data.numbers !== 'object') {
      errors.push('numbers must be an object');
    }

    // Content quality checks
    if (data.summary && data.summary.length < 10) {
      warnings.push('Summary appears too short');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private reconcileResults(ruleData: any, llmData: any): any {
    // Simple reconciliation strategy: use LLM data but preserve rule-extracted numbers
    const result = { ...llmData };

    // Prefer rule-based numerical extractions if they exist
    if (ruleData.numbers && Object.keys(ruleData.numbers).length > 0) {
      result.numbers = { ...llmData.numbers, ...ruleData.numbers };
    }

    // Prefer rule-based trade data if it's more complete
    if (ruleData.trades && ruleData.trades.length > 0 &&
        (!llmData.trades || llmData.trades.length < ruleData.trades.length)) {
      result.trades = ruleData.trades;
    }

    return result;
  }

  private createSuccessResult(
    method: ProcessingMethod,
    data: any,
    confidence: number,
    fallbackUsed: boolean,
    metadata: ProcessingMetadata
  ): HybridAnalysisResult {
    return {
      processingMethod: method,
      category: data.category,
      confidence,
      extractedData: data,
      processingTimeMs: metadata.processingTimeMs,
      fallbackUsed,
      metadata
    };
  }

  private createErrorResult(error: Error, metadata: ProcessingMetadata): HybridAnalysisResult {
    return {
      processingMethod: ProcessingMethod.RULE_BASED, // Default
      category: 'other' as any,
      confidence: 0,
      extractedData: {
        id: '',
        symbol: '',
        title: '',
        date: '',
        category: 'other' as any,
        summary: `Processing failed: ${error.message}`,
        bullets: [],
        trades: [],
        additionalFields: { error: error.message },
        numbers: {}
      },
      processingTimeMs: metadata.processingTimeMs,
      fallbackUsed: false,
      metadata
    };
  }

  // Public methods for configuration and monitoring
  getConfig(): ConfigManager {
    return this.config;
  }

  getRuleEngine(): RuleEngine {
    return this.ruleEngine;
  }

  getLLMProcessor(): LLMProcessor {
    return this.llmProcessor;
  }

  getMonitor(): HybridAnalysisMonitor {
    return this.monitor;
  }

  async processMultipleNews(requests: HybridAnalysisRequest[]): Promise<HybridAnalysisResult[]> {
    const results: HybridAnalysisResult[] = [];

    for (const request of requests) {
      try {
        const result = await this.processNews(request);
        results.push(result);
      } catch (error) {
        this.config.log('error', `Failed to process news ${request.content.id}:`, error);
        // Continue processing other news items
      }
    }

    return results;
  }

  getProcessingStats(): any {
    return {
      apiCalls: this.llmProcessor.getApiCallCount(),
      rulesLoaded: this.ruleEngine.getRuleNames().length,
      configEnabled: this.config.isHybridEnabled(),
      llmFallbackEnabled: this.config.isLLMFallbackEnabled()
    };
  }
}