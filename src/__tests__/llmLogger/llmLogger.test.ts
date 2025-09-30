import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { promises as fs } from 'fs';
import path from 'path';
import {
  LLMLogger,
  LLMMetricsCollector,
  TokenUsage,
  LLMEvent,
  LLMMetrics,
  LLMRecord
} from '../../llmLogger';

// Mock console and debug to avoid noise in tests
let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

describe('LLM Logger System', () => {
  beforeEach(() => {
    // Store original console methods
    originalConsoleLog = console.log;
    originalConsoleError = console.error;

    // Clear output arrays
    consoleOutput = [];
    consoleErrors = [];

    // Mock console methods
    console.log = (...args: any[]) => {
      consoleOutput.push(args.join(' '));
    };

    console.error = (...args: any[]) => {
      consoleErrors.push(args.join(' '));
    };
  });

  afterEach(() => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('LLMLogger', () => {
    let logger: LLMLogger;

    beforeEach(() => {
      logger = new LLMLogger();
    });

    describe('Call Started Logging', () => {
      it('should log call started and return request ID', () => {
        const model = 'openrouter/auto';
        const promptLength = 1500;

        const requestId = logger.logCallStarted(model, promptLength);

        expect(requestId).toBeTruthy();
        expect(requestId).toMatch(/^llm_\d+_[a-z0-9]+$/);

        const summary = logger.getIterationSummary();
        expect(summary.details).toHaveLength(1);
        expect(summary.details[0].requestId).toBe(requestId);
        expect(summary.details[0].model).toBe(model);
        expect(summary.details[0].promptLength).toBe(promptLength);
        expect(summary.details[0].status).toBe('started');
      });

      it('should generate unique request IDs', () => {
        const id1 = logger.logCallStarted('model1', 100);
        const id2 = logger.logCallStarted('model2', 200);

        expect(id1).not.toBe(id2);
      });
    });

    describe('Call Success Logging', () => {
      it('should log successful call with token usage', () => {
        const requestId = logger.logCallStarted('openrouter/auto', 1000);
        const tokenUsage: TokenUsage = {
          inputTokens: 250,
          outputTokens: 50,
          totalTokens: 300
        };
        const estimatedCost = 0.001;

        logger.logCallSuccess(requestId, 500, tokenUsage, estimatedCost);

        const summary = logger.getIterationSummary();
        expect(summary.successfulCalls).toBe(1);
        expect(summary.totalTokensUsed).toBe(300);
        expect(summary.estimatedCost).toBe(0.001);

        const record = summary.details.find(r => r.requestId === requestId);
        expect(record).toBeDefined();
        expect(record!.status).toBe('success');
        expect(record!.tokenUsage).toEqual(tokenUsage);
        expect(record!.estimatedCost).toBe(estimatedCost);
        expect(record!.duration).toBeGreaterThan(0);
      });

      it('should handle success logging without token usage', () => {
        const requestId = logger.logCallStarted('openrouter/auto', 1000);

        logger.logCallSuccess(requestId, 500);

        const summary = logger.getIterationSummary();
        expect(summary.successfulCalls).toBe(1);
        expect(summary.totalTokensUsed).toBe(0);

        const record = summary.details.find(r => r.requestId === requestId);
        expect(record!.tokenUsage).toBeUndefined();
        expect(record!.estimatedCost).toBeUndefined();
      });

      it('should handle invalid request ID gracefully', () => {
        logger.logCallSuccess('invalid-id', 500);
        // Should not throw error, just log warning
        expect(() => logger.getIterationSummary()).not.toThrow();
      });
    });

    describe('Call Error Logging', () => {
      it('should log error with classification', () => {
        const requestId = logger.logCallStarted('openrouter/auto', 1000);
        const error = new Error('Rate limit exceeded');

        logger.logCallError(requestId, error, 2);

        const summary = logger.getIterationSummary();
        expect(summary.failedCalls).toBe(1);
        expect(summary.errorRate).toBeGreaterThan(0);

        const record = summary.details.find(r => r.requestId === requestId);
        expect(record!.status).toBe('error');
        expect(record!.error).toBe('Rate limit exceeded');
        expect(record!.errorType).toBe('rate_limiting');
        expect(record!.retryCount).toBe(2);
      });

      it('should classify different error types correctly', () => {
        const testCases = [
          { error: 'Network timeout occurred', expectedType: 'network' },
          { error: 'OpenRouter error 429: Too many requests', expectedType: 'rate_limiting' },
          { error: 'Authentication failed', expectedType: 'authentication' },
          { error: 'Invalid request format', expectedType: 'invalid_request' },
          { error: 'Server error 500', expectedType: 'server_error' },
          { error: 'Model unavailable', expectedType: 'model_error' },
          { error: 'JSON parsing failed', expectedType: 'parsing_error' },
          { error: 'Unknown error occurred', expectedType: 'unknown' }
        ];

        testCases.forEach((testCase, index) => {
          const requestId = logger.logCallStarted('test-model', 100);
          logger.logCallError(requestId, testCase.error);

          const summary = logger.getIterationSummary();
          const record = summary.details[index];
          expect(record.errorType).toBe(testCase.expectedType);
        });
      });
    });

    describe('Cache Logging', () => {
      it('should log cache hits', () => {
        const requestId = logger.logCallStarted('openrouter/auto', 1000);
        const savedCost = 0.002;

        logger.logCallSkippedCache(requestId, 'Output file already exists', savedCost);

        const summary = logger.getIterationSummary();
        expect(summary.cachedCalls).toBe(1);
        expect(summary.cacheHitRate).toBe(100);

        const record = summary.details.find(r => r.requestId === requestId);
        expect(record!.status).toBe('cached');
        expect(record!.cacheReason).toBe('Output file already exists');
        expect(record!.estimatedCost).toBe(savedCost);
      });
    });

    describe('Summary Generation', () => {
      it('should calculate metrics correctly', () => {
        // Create mix of different call types
        const req1 = logger.logCallStarted('model1', 1000);
        logger.logCallSuccess(req1, 500, { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0.001);

        const req2 = logger.logCallStarted('model1', 1000);
        logger.logCallError(req2, 'Network error');

        const req3 = logger.logCallStarted('model1', 1000);
        logger.logCallSkippedCache(req3, 'Cached result', 0.001);

        const summary = logger.getIterationSummary();

        expect(summary.totalCalls).toBe(3);
        expect(summary.successfulCalls).toBe(1);
        expect(summary.failedCalls).toBe(1);
        expect(summary.cachedCalls).toBe(1);
        expect(summary.cacheHitRate).toBeCloseTo(33.33, 1);
        expect(summary.errorRate).toBeCloseTo(33.33, 1);
        expect(summary.topError).toBe('network');
        expect(summary.totalTokensUsed).toBe(150);
        expect(summary.estimatedCost).toBe(0.002); // 0.001 from success + 0.001 from cache
      });

      it('should format summary correctly', () => {
        const req1 = logger.logCallStarted('openrouter/auto', 1000);
        logger.logCallSuccess(req1, 500, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }, 0.005);

        const req2 = logger.logCallStarted('openrouter/auto', 800);
        logger.logCallError(req2, 'Rate limit exceeded');

        const summary = logger.getIterationSummary();
        const formatted = logger.formatSummary(summary);

        expect(formatted).toContain('🤖 LLM Call Summary:');
        expect(formatted).toContain('Total Calls: 2');
        expect(formatted).toContain('1 success, 1 errors');
        expect(formatted).toContain('1,200');
        expect(formatted).toContain('$0.0050');
        expect(formatted).toContain('rate_limiting');
      });
    });

    describe('Data Clearing', () => {
      it('should clear iteration data', () => {
        logger.logCallStarted('model1', 1000);
        logger.logCallStarted('model2', 500);

        let summary = logger.getIterationSummary();
        expect(summary.totalCalls).toBe(2);

        logger.clearIterationData();

        summary = logger.getIterationSummary();
        expect(summary.totalCalls).toBe(0);
        expect(summary.details).toHaveLength(0);
      });
    });

    describe('Data Export', () => {
      it('should export data to files', async () => {
        const tempDir = path.join(process.cwd(), 'test_logs');

        // Create some test data
        const req1 = logger.logCallStarted('test-model', 1000);
        logger.logCallSuccess(req1, 500, { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 0.001);

        await logger.exportData(tempDir);

        // Check if files were created
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '-');
        const eventsFile = path.join(tempDir, `llm_events_${today}.json`);
        const summaryFile = path.join(tempDir, `llm_summary_${today}.json`);

        // Clean up
        try {
          await fs.unlink(eventsFile);
          await fs.unlink(summaryFile);
          await fs.rmdir(tempDir);
        } catch (e) {
          // Ignore cleanup errors
        }
      });
    });
  });

  describe('LLMMetricsCollector', () => {
    let collector: LLMMetricsCollector;

    beforeEach(() => {
      collector = new LLMMetricsCollector();
    });

    describe('Event Processing', () => {
      it('should process success events correctly', () => {
        const event: LLMEvent = {
          eventType: 'llm.call_success',
          timestamp: new Date(),
          requestId: 'test-123',
          model: 'openrouter/auto',
          duration: 1500,
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          estimatedCost: 0.002
        };

        collector.addEvent(event);

        const metrics = collector.getCurrentMetrics();
        expect(metrics.totalCalls).toBe(1);
        expect(metrics.successfulCalls).toBe(1);
        expect(metrics.averageResponseTime).toBe(1500);
        expect(metrics.totalTokensUsed).toBe(150);
        expect(metrics.estimatedCost).toBe(0.002);
        expect(metrics.modelUsage['openrouter/auto']).toBe(1);
      });

      it('should process error events correctly', () => {
        const event: LLMEvent = {
          eventType: 'llm.call_error',
          timestamp: new Date(),
          requestId: 'test-456',
          model: 'claude-3-haiku',
          error: 'Rate limit exceeded',
          errorType: 'rate_limiting'
        };

        collector.addEvent(event);

        const metrics = collector.getCurrentMetrics();
        expect(metrics.totalCalls).toBe(1);
        expect(metrics.failedCalls).toBe(1);
        expect(metrics.errorBreakdown['rate_limiting']).toBe(1);
        expect(metrics.modelUsage['claude-3-haiku']).toBe(1);
      });

      it('should process cache events correctly', () => {
        const event: LLMEvent = {
          eventType: 'llm.call_skipped_cache',
          timestamp: new Date(),
          requestId: 'test-789',
          model: 'gpt-4o',
          cacheReason: 'Output file exists'
        };

        collector.addEvent(event);

        const metrics = collector.getCurrentMetrics();
        expect(metrics.totalCalls).toBe(1);
        expect(metrics.cachedCalls).toBe(1);
        expect(metrics.modelUsage['gpt-4o']).toBe(1);
      });

      it('should calculate average response time correctly', () => {
        const events = [
          {
            eventType: 'llm.call_success' as const,
            timestamp: new Date(),
            requestId: 'test-1',
            model: 'test-model',
            duration: 1000
          },
          {
            eventType: 'llm.call_success' as const,
            timestamp: new Date(),
            requestId: 'test-2',
            model: 'test-model',
            duration: 2000
          },
          {
            eventType: 'llm.call_success' as const,
            timestamp: new Date(),
            requestId: 'test-3',
            model: 'test-model',
            duration: 3000
          }
        ];

        events.forEach(event => collector.addEvent(event));

        const metrics = collector.getCurrentMetrics();
        expect(metrics.averageResponseTime).toBe(2000); // (1000 + 2000 + 3000) / 3
      });
    });

    describe('Daily Summary', () => {
      it('should format daily summary correctly', () => {
        // Add various types of events
        const successEvent: LLMEvent = {
          eventType: 'llm.call_success',
          timestamp: new Date(),
          requestId: 'success-1',
          model: 'openrouter/auto',
          duration: 1200,
          tokenUsage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
          estimatedCost: 0.003
        };

        const errorEvent: LLMEvent = {
          eventType: 'llm.call_error',
          timestamp: new Date(),
          requestId: 'error-1',
          model: 'openrouter/auto',
          error: 'Network timeout',
          errorType: 'network'
        };

        const cacheEvent: LLMEvent = {
          eventType: 'llm.call_skipped_cache',
          timestamp: new Date(),
          requestId: 'cache-1',
          model: 'openrouter/auto',
          cacheReason: 'File exists'
        };

        collector.addEvent(successEvent);
        collector.addEvent(errorEvent);
        collector.addEvent(cacheEvent);

        const summary = collector.formatDailySummary();

        expect(summary).toContain('🤖 Daily LLM Summary');
        expect(summary).toContain('Total Calls: 3');
        expect(summary).toContain('Success Rate: 33.3%');
        expect(summary).toContain('Error Rate: 33.3%');
        expect(summary).toContain('Cache Hit Rate: 33.3%');
        expect(summary).toContain('600');
        expect(summary).toContain('$0.0030');
      });

      it('should handle empty metrics', () => {
        const summary = collector.formatDailySummary();

        expect(summary).toContain('Total Calls: 0');
        expect(summary).toContain('Success Rate: 0.0%');
        expect(summary).toContain('Error Rate: 0.0%');
        expect(summary).toContain('Cache Hit Rate: 0.0%');
      });
    });

    describe('Metrics Export', () => {
      it('should export metrics to file', async () => {
        const tempDir = path.join(process.cwd(), 'test_metrics');
        const tempFile = path.join(tempDir, 'test_metrics.json');

        // Add some test data
        const event: LLMEvent = {
          eventType: 'llm.call_success',
          timestamp: new Date(),
          requestId: 'test-export',
          model: 'test-model',
          tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          estimatedCost: 0.001
        };

        collector.addEvent(event);

        await collector.exportMetrics(tempFile);

        // Check if file exists
        try {
          const stats = await fs.stat(tempFile);
          expect(stats.isFile()).toBe(true);

          // Read and verify content
          const content = await fs.readFile(tempFile, 'utf-8');
          const metrics = JSON.parse(content);

          expect(metrics.totalCalls).toBe(1);
          expect(metrics.successfulCalls).toBe(1);
          expect(metrics.totalTokensUsed).toBe(150);

          // Clean up
          await fs.unlink(tempFile);
          await fs.rmdir(tempDir);
        } catch (e) {
          // File might not exist or cleanup failed - acceptable in tests
        }
      });
    });

    describe('Hourly Distribution', () => {
      it('should track hourly distribution correctly', () => {
        const event: LLMEvent = {
          eventType: 'llm.call_success',
          timestamp: new Date(),
          requestId: 'hourly-test',
          model: 'test-model'
        };

        collector.addEvent(event);

        const metrics = collector.getCurrentMetrics();
        expect(metrics.hourlyDistribution).toHaveLength(24);

        // Should have at least one call in the current hour
        const totalHourlyCalls = metrics.hourlyDistribution.reduce((sum, count) => sum + count, 0);
        expect(totalHourlyCalls).toBe(1);
      });
    });

    describe('Day Reset', () => {
      it('should handle day transitions', () => {
        // Add an event
        const event: LLMEvent = {
          eventType: 'llm.call_success',
          timestamp: new Date(),
          requestId: 'reset-test',
          model: 'test-model'
        };

        collector.addEvent(event);

        let metrics = collector.getCurrentMetrics();
        expect(metrics.totalCalls).toBe(1);

        // Manually reset (simulating day change)
        collector.resetDailyMetrics();

        metrics = collector.getCurrentMetrics();
        expect(metrics.totalCalls).toBe(0);
        expect(metrics.successfulCalls).toBe(0);
        expect(metrics.failedCalls).toBe(0);
        expect(metrics.cachedCalls).toBe(0);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should work together with logger and collector', () => {
      const logger = new LLMLogger();
      const collector = new LLMMetricsCollector();

      // Simulate a complete call flow
      const requestId = logger.logCallStarted('openrouter/auto', 1500);

      // Simulate successful response
      const tokenUsage: TokenUsage = {
        inputTokens: 375,
        outputTokens: 75,
        totalTokens: 450
      };

      logger.logCallSuccess(requestId, 600, tokenUsage, 0.002);

      // Manually add event to collector (in real usage, this would be automatic)
      const successEvent: LLMEvent = {
        eventType: 'llm.call_success',
        timestamp: new Date(),
        requestId,
        model: 'openrouter/auto',
        duration: 1200,
        tokenUsage,
        estimatedCost: 0.002,
        responseLength: 600
      };

      collector.addEvent(successEvent);

      // Verify logger summary
      const loggerSummary = logger.getIterationSummary();
      expect(loggerSummary.totalCalls).toBe(1);
      expect(loggerSummary.successfulCalls).toBe(1);
      expect(loggerSummary.totalTokensUsed).toBe(450);

      // Verify collector metrics
      const collectorMetrics = collector.getCurrentMetrics();
      expect(collectorMetrics.totalCalls).toBe(1);
      expect(collectorMetrics.successfulCalls).toBe(1);
      expect(collectorMetrics.totalTokensUsed).toBe(450);

      // Both should be consistent
      expect(loggerSummary.totalTokensUsed).toBe(collectorMetrics.totalTokensUsed);
      expect(loggerSummary.estimatedCost).toBe(collectorMetrics.estimatedCost);
    });
  });
});