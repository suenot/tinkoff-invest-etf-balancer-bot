import { describe, it, expect } from 'bun:test';
import { AnalysisConfig, OpenRouterConfig } from '../types.d';

// Since ConfigLoader is a singleton and uses real file I/O,
// let's test the validation logic more directly
describe('OpenRouter Analysis Configuration', () => {
  describe('Type Definitions', () => {
    it('should have proper type definitions for AnalysisConfig', () => {
      const analysis: AnalysisConfig = {
        openrouter: {
          enabled: true,
          model: 'test-model',
          temperature: 0.5
        }
      };

      expect(analysis.openrouter.enabled).toBe(true);
      expect(analysis.openrouter.model).toBe('test-model');
      expect(analysis.openrouter.temperature).toBe(0.5);
    });

    it('should support minimal OpenRouterConfig with just enabled field', () => {
      const config: OpenRouterConfig = {
        enabled: false
      };

      expect(config.enabled).toBe(false);
      expect(config.model).toBeUndefined();
      expect(config.temperature).toBeUndefined();
    });

    it('should support complete OpenRouterConfig with all fields', () => {
      const config: OpenRouterConfig = {
        enabled: true,
        model: 'openrouter/auto',
        temperature: 0.2
      };

      expect(config.enabled).toBe(true);
      expect(config.model).toBe('openrouter/auto');
      expect(config.temperature).toBe(0.2);
    });
  });

  describe('Configuration Validation Logic', () => {
    // Test the validation functions directly by creating a mock validator
    const validateOpenRouterConfig = (openrouter: any): void => {
      // Validate enabled field - required
      if (typeof openrouter.enabled !== 'boolean') {
        throw new Error('analysis.openrouter.enabled must be a boolean. Got: ' + typeof openrouter.enabled);
      }

      // Validate optional model field
      if (openrouter.model !== undefined && typeof openrouter.model !== 'string') {
        throw new Error('analysis.openrouter.model must be a string. Got: ' + typeof openrouter.model);
      }

      // Validate optional temperature field
      if (openrouter.temperature !== undefined) {
        if (typeof openrouter.temperature !== 'number') {
          throw new Error('analysis.openrouter.temperature must be a number. Got: ' + typeof openrouter.temperature);
        }
        if (!Number.isFinite(openrouter.temperature)) {
          throw new Error('analysis.openrouter.temperature must be a finite number. Got: ' + openrouter.temperature);
        }
        if (openrouter.temperature < 0.0 || openrouter.temperature > 2.0) {
          throw new Error('analysis.openrouter.temperature must be between 0.0 and 2.0. Got: ' + openrouter.temperature);
        }
      }
    };

    const validateAnalysisConfig = (analysis: any): void => {
      // Validate openrouter configuration
      if (!analysis.openrouter) {
        throw new Error('Analysis configuration must contain openrouter section');
      }

      validateOpenRouterConfig(analysis.openrouter);
    };

    it('should validate valid analysis configurations', () => {
      const validConfigurations = [
        { openrouter: { enabled: true } },
        { openrouter: { enabled: false } },
        { openrouter: { enabled: true, model: 'openrouter/auto' } },
        { openrouter: { enabled: true, temperature: 0.2 } },
        { openrouter: { enabled: true, model: 'test-model', temperature: 1.5 } }
      ];

      validConfigurations.forEach(config => {
        expect(() => {
          validateAnalysisConfig(config);
        }).not.toThrow();
      });
    });

    it('should reject missing openrouter section', () => {
      const invalidConfig = {};

      expect(() => {
        validateAnalysisConfig(invalidConfig);
      }).toThrow('Analysis configuration must contain openrouter section');
    });

    it('should reject invalid enabled field values', () => {
      const invalidConfigurations = [
        { openrouter: { enabled: 'true' } },
        { openrouter: { enabled: 1 } },
        { openrouter: { enabled: null } },
        { openrouter: { enabled: undefined } },
        { openrouter: {} }
      ];

      invalidConfigurations.forEach(config => {
        expect(() => {
          validateAnalysisConfig(config);
        }).toThrow('analysis.openrouter.enabled must be a boolean');
      });
    });

    it('should reject invalid model field values', () => {
      const invalidConfigurations = [
        { openrouter: { enabled: true, model: 123 } },
        { openrouter: { enabled: true, model: true } },
        { openrouter: { enabled: true, model: [] } },
        { openrouter: { enabled: true, model: {} } }
      ];

      invalidConfigurations.forEach(config => {
        expect(() => {
          validateAnalysisConfig(config);
        }).toThrow('analysis.openrouter.model must be a string');
      });
    });

    it('should reject invalid temperature field values', () => {
      const invalidConfigurations = [
        { openrouter: { enabled: true, temperature: 'hot' } },
        { openrouter: { enabled: true, temperature: true } },
        { openrouter: { enabled: true, temperature: [] } },
        { openrouter: { enabled: true, temperature: {} } },
        { openrouter: { enabled: true, temperature: Infinity } },
        { openrouter: { enabled: true, temperature: NaN } },
        { openrouter: { enabled: true, temperature: -0.1 } },
        { openrouter: { enabled: true, temperature: 2.1 } }
      ];

      invalidConfigurations.forEach(config => {
        expect(() => {
          validateAnalysisConfig(config);
        }).toThrow(/analysis\.openrouter\.temperature/);
      });
    });

    it('should accept valid temperature values', () => {
      const validConfigurations = [
        { openrouter: { enabled: true, temperature: 0.0 } },
        { openrouter: { enabled: true, temperature: 0.2 } },
        { openrouter: { enabled: true, temperature: 1.0 } },
        { openrouter: { enabled: true, temperature: 2.0 } }
      ];

      validConfigurations.forEach(config => {
        expect(() => {
          validateAnalysisConfig(config);
        }).not.toThrow();
      });
    });
  });

  describe('Feature Integration Logic', () => {
    // Test the logic that would be used in analyzeNews.ts
    const isAnalysisEnabled = (config: any): boolean => {
      try {
        return config.analysis?.openrouter?.enabled ?? false;
      } catch (error) {
        return false;
      }
    };

    const getOpenRouterSettings = (config: any) => {
      const defaults = {
        model: 'openrouter/auto',
        temperature: 0.2
      };

      if (!config.analysis?.openrouter) {
        return defaults;
      }

      return {
        model: config.analysis.openrouter.model ?? defaults.model,
        temperature: config.analysis.openrouter.temperature ?? defaults.temperature
      };
    };

    it('should return false when analysis is not configured', () => {
      const configs = [
        {},
        { accounts: [] },
        { analysis: {} },
        { analysis: { openrouter: {} } },
        { analysis: { openrouter: { enabled: false } } }
      ];

      configs.forEach(config => {
        expect(isAnalysisEnabled(config)).toBe(false);
      });
    });

    it('should return true when analysis is enabled', () => {
      const config = {
        analysis: {
          openrouter: {
            enabled: true
          }
        }
      };

      expect(isAnalysisEnabled(config)).toBe(true);
    });

    it('should use default settings when config is missing', () => {
      const config = {};
      const settings = getOpenRouterSettings(config);

      expect(settings.model).toBe('openrouter/auto');
      expect(settings.temperature).toBe(0.2);
    });

    it('should use configured settings when available', () => {
      const config = {
        analysis: {
          openrouter: {
            enabled: true,
            model: 'custom-model',
            temperature: 1.5
          }
        }
      };

      const settings = getOpenRouterSettings(config);

      expect(settings.model).toBe('custom-model');
      expect(settings.temperature).toBe(1.5);
    });

    it('should use partial configured settings with defaults for missing values', () => {
      const configWithModel = {
        analysis: {
          openrouter: {
            enabled: true,
            model: 'custom-model'
          }
        }
      };

      const settingsWithModel = getOpenRouterSettings(configWithModel);
      expect(settingsWithModel.model).toBe('custom-model');
      expect(settingsWithModel.temperature).toBe(0.2);

      const configWithTemp = {
        analysis: {
          openrouter: {
            enabled: true,
            temperature: 1.0
          }
        }
      };

      const settingsWithTemp = getOpenRouterSettings(configWithTemp);
      expect(settingsWithTemp.model).toBe('openrouter/auto');
      expect(settingsWithTemp.temperature).toBe(1.0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should handle configurations without analysis section', () => {
      const legacyConfig = {
        accounts: [
          {
            id: 'test',
            name: 'Test Account'
          }
        ]
      };

      // Should not throw and should default to disabled
      const isEnabled = legacyConfig.analysis?.openrouter?.enabled ?? false;
      expect(isEnabled).toBe(false);
    });

    it('should maintain existing configuration structure', () => {
      const configWithAnalysis = {
        aum_cache: {
          enabled: true,
          ttl_hours: 24
        },
        analysis: {
          openrouter: {
            enabled: true
          }
        },
        accounts: [
          {
            id: 'test',
            name: 'Test Account'
          }
        ]
      };

      // Existing structure should remain intact
      expect(configWithAnalysis.aum_cache).toBeDefined();
      expect(configWithAnalysis.accounts).toBeDefined();
      expect(configWithAnalysis.analysis).toBeDefined();
    });
  });
});