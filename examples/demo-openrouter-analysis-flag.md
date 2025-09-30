# OpenRouter Analysis Flag Demo

This demo shows the new OpenRouter analysis flag feature in action.

## Configuration Examples

### Example 1: Analysis Enabled
```json
{
  "analysis": {
    "openrouter": {
      "enabled": true,
      "model": "openrouter/auto",
      "temperature": 0.2
    }
  },
  "accounts": [...]
}
```

**Result**: OpenRouter API calls will be made when running `analyzeNews.ts`

### Example 2: Analysis Disabled
```json
{
  "analysis": {
    "openrouter": {
      "enabled": false
    }
  },
  "accounts": [...]
}
```

**Result**: OpenRouter API calls will be skipped, with appropriate log messages

### Example 3: Backward Compatibility (No Analysis Section)
```json
{
  "accounts": [...]
}
```

**Result**: Analysis defaults to disabled, maintaining backward compatibility

## Log Output Examples

### When Analysis is Enabled
```
[analyzeNews] symbol=TRUR total=5 toAnalyze=3
[analyzeNews] analyze TRUR/news-001 via OpenRouter
[analyzeNews] saved /path/to/news_meta/TRUR/news-001.json
```

### When Analysis is Disabled
```
[analyzeNews] symbol=TRUR total=5 toAnalyze=3
[analyzeNews] skip analysis for TRUR/news-001 - OpenRouter analysis disabled in configuration
[analyzeNews] skip analysis for TRUR/news-002 - OpenRouter analysis disabled in configuration
```

## Configuration Validation

The system validates all configuration options:

- `analysis.openrouter.enabled` (required): Must be a boolean
- `analysis.openrouter.model` (optional): Must be a string if provided
- `analysis.openrouter.temperature` (optional): Must be a number between 0.0 and 2.0 if provided

Invalid configurations will produce clear error messages:

```
Configuration loading error: analysis.openrouter.enabled must be a boolean. Got: string
```

## Integration with Environment Variables

The feature gracefully integrates with existing environment variable configuration:

1. **API Key**: Still read from `OPENROUTER_API_KEY` environment variable
2. **Base URL**: Still read from `OPENROUTER_BASE` environment variable
3. **Model Override**: Configuration `analysis.openrouter.model` takes precedence over `OPENROUTER_MODEL` env var
4. **Temperature Override**: Configuration `analysis.openrouter.temperature` takes precedence over hardcoded default

## Usage Scenarios

### Development/Testing
Set `analysis.openrouter.enabled: false` to avoid API costs during development

### Production with Cost Control
Enable analysis only for specific environments or configurations

### Feature Rollout
Gradually enable analysis across different instances

### Debug/Troubleshooting
Quickly disable analysis to isolate issues without code changes