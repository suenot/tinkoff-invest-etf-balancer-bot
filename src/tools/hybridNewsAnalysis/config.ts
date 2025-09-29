import { HybridConfig } from './types';

const DEFAULT_CONFIG: HybridConfig = {
  enabled: true,
  llmFallback: {
    enabled: false, // Disabled by default to prioritize rule-based processing
    confidenceThreshold: 0.7,
    maxRetries: 3,
    timeoutMs: 30000
  },
  rules: {
    enabled: true,
    confidenceThreshold: 0.7,
    strictMode: true
  },
  llm: {
    model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
    temperature: 0.2,
    maxTokens: 2000
  },
  validation: {
    strict: true,
    requireAllFields: false
  },
  monitoring: {
    enabled: true,
    logLevel: 'info'
  }
};

export class ConfigManager {
  private config: HybridConfig;
  private readonly LOG_PREFIX = '[HybridConfig]';

  constructor(customConfig?: Partial<HybridConfig>) {
    this.config = this.mergeConfig(DEFAULT_CONFIG, customConfig);
    this.validateConfig();
  }

  private mergeConfig(defaultConfig: HybridConfig, customConfig?: Partial<HybridConfig>): HybridConfig {
    if (!customConfig) return { ...defaultConfig };

    return {
      enabled: customConfig.enabled ?? defaultConfig.enabled,
      llmFallback: {
        ...defaultConfig.llmFallback,
        ...customConfig.llmFallback
      },
      rules: {
        ...defaultConfig.rules,
        ...customConfig.rules
      },
      llm: {
        ...defaultConfig.llm,
        ...customConfig.llm
      },
      validation: {
        ...defaultConfig.validation,
        ...customConfig.validation
      },
      monitoring: {
        ...defaultConfig.monitoring,
        ...customConfig.monitoring
      }
    };
  }

  private validateConfig(): void {
    if (this.config.llmFallback.confidenceThreshold < 0 || this.config.llmFallback.confidenceThreshold > 1) {
      throw new Error('LLM fallback confidence threshold must be between 0 and 1');
    }

    if (this.config.rules.confidenceThreshold < 0 || this.config.rules.confidenceThreshold > 1) {
      throw new Error('Rules confidence threshold must be between 0 and 1');
    }

    if (this.config.llm.temperature < 0 || this.config.llm.temperature > 2) {
      throw new Error('LLM temperature must be between 0 and 2');
    }

    if (this.config.llmFallback.maxRetries < 1 || this.config.llmFallback.maxRetries > 10) {
      throw new Error('LLM max retries must be between 1 and 10');
    }
  }

  getConfig(): HybridConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<HybridConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    this.validateConfig();
    this.log('info', 'Configuration updated');
  }

  isHybridEnabled(): boolean {
    return this.config.enabled;
  }

  isLLMFallbackEnabled(): boolean {
    return this.config.enabled && this.config.llmFallback.enabled;
  }

  isRulesEnabled(): boolean {
    return this.config.enabled && this.config.rules.enabled;
  }

  getRulesConfidenceThreshold(): number {
    return this.config.rules.confidenceThreshold;
  }

  getLLMFallbackThreshold(): number {
    return this.config.llmFallback.confidenceThreshold;
  }

  getLLMConfig() {
    return { ...this.config.llm };
  }

  getValidationConfig() {
    return { ...this.config.validation };
  }

  getMonitoringConfig() {
    return { ...this.config.monitoring };
  }

  isStrictValidation(): boolean {
    return this.config.validation.strict;
  }

  shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    if (!this.config.monitoring.enabled) return false;

    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.monitoring.logLevel);
    const requestedLevelIndex = levels.indexOf(level);

    return requestedLevelIndex >= currentLevelIndex;
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} ${this.LOG_PREFIX} [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case 'debug':
        console.debug(logMessage, ...args);
        break;
      case 'info':
        console.info(logMessage, ...args);
        break;
      case 'warn':
        console.warn(logMessage, ...args);
        break;
      case 'error':
        console.error(logMessage, ...args);
        break;
    }
  }

  // Factory method to create config from environment variables
  static fromEnvironment(): ConfigManager {
    const envConfig: Partial<HybridConfig> = {};

    // LLM Fallback configuration
    if (process.env.HYBRID_LLM_FALLBACK_ENABLED !== undefined) {
      envConfig.llmFallback = {
        enabled: process.env.HYBRID_LLM_FALLBACK_ENABLED === 'true',
        confidenceThreshold: parseFloat(process.env.HYBRID_LLM_CONFIDENCE_THRESHOLD || '0.7'),
        maxRetries: parseInt(process.env.HYBRID_LLM_MAX_RETRIES || '3'),
        timeoutMs: parseInt(process.env.HYBRID_LLM_TIMEOUT_MS || '30000')
      };
    }

    // Rules configuration
    if (process.env.HYBRID_RULES_ENABLED !== undefined) {
      envConfig.rules = {
        enabled: process.env.HYBRID_RULES_ENABLED === 'true',
        confidenceThreshold: parseFloat(process.env.HYBRID_RULES_CONFIDENCE_THRESHOLD || '0.7'),
        strictMode: process.env.HYBRID_RULES_STRICT_MODE !== 'false'
      };
    }

    // LLM model configuration
    if (process.env.OPENROUTER_MODEL || process.env.HYBRID_LLM_TEMPERATURE) {
      envConfig.llm = {
        model: process.env.OPENROUTER_MODEL || 'openrouter/auto',
        temperature: parseFloat(process.env.HYBRID_LLM_TEMPERATURE || '0.2'),
        maxTokens: parseInt(process.env.HYBRID_LLM_MAX_TOKENS || '2000')
      };
    }

    // Validation configuration
    if (process.env.HYBRID_VALIDATION_STRICT !== undefined) {
      envConfig.validation = {
        strict: process.env.HYBRID_VALIDATION_STRICT === 'true',
        requireAllFields: process.env.HYBRID_VALIDATION_REQUIRE_ALL_FIELDS === 'true'
      };
    }

    // Monitoring configuration
    if (process.env.HYBRID_MONITORING_ENABLED !== undefined) {
      envConfig.monitoring = {
        enabled: process.env.HYBRID_MONITORING_ENABLED === 'true',
        logLevel: (process.env.HYBRID_LOG_LEVEL as any) || 'info'
      };
    }

    // Global enable/disable
    if (process.env.HYBRID_ENABLED !== undefined) {
      envConfig.enabled = process.env.HYBRID_ENABLED === 'true';
    }

    return new ConfigManager(envConfig);
  }
}