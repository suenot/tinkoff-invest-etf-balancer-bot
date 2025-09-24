# Command Reference

<cite>
**Referenced Files in This Document **   
- [package.json](file://package.json)
- [src/index.ts](file://src/index.ts)
- [src/tools/configManager.ts](file://src/tools/configManager.ts)
- [src/tools/etfCap.ts](file://src/tools/etfCap.ts)
- [src/tools/pollEtfMetrics.ts](file://src/tools/pollEtfMetrics.ts)
- [src/tools/debugBalancer.ts](file://src/tools/debugBalancer.ts)
- [src/tools/testBalancerLogic.ts](file://src/tools/testBalancerLogic.ts)
- [src/configLoader.ts](file://src/configLoader.ts)
- [debug_tobuylots.ts](file://debug_tobuylots.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Core Commands](#core-commands)
3. [Configuration Management](#configuration-management)
4. [Market Data Tools](#market-data-tools)
5. [Debugging and Testing](#debugging-and-testing)
6. [Performance and Build](#performance-and-build)
7. [Command Interaction with Configuration](#command-interaction-with-configuration)
8. [Security Implications](#security-implications)
9. [Error Conditions and Exit Codes](#error-conditions-and-exit-codes)

## Introduction
This document provides comprehensive documentation for all CLI commands exposed in the package.json scripts of the Tinkoff Invest ETF Balancer Bot. The bot is designed to automatically rebalance investment portfolios according to predefined target allocations across multiple accounts. The command-line interface provides both operational and diagnostic functionality, enabling users to manage configurations, analyze market data, debug balancing logic, and execute trading operations.

The commands are organized into several categories: core operational commands that drive the main rebalancing functionality, configuration management tools, market data analysis utilities, debugging and testing commands, and performance/build-related operations. Each command interacts with the system's configuration files and external services through well-defined interfaces, with varying levels of security implications based on whether they trigger actual trades or perform read-only operations.

All commands are executed using Bun, a JavaScript runtime that offers improved performance over traditional Node.js environments. The system leverages the Tinkoff Investment API to retrieve market data and execute trades, with configuration managed through JSON files and environment variables for sensitive data like API tokens.

**Section sources**
- [package.json](file://package.json)

## Core Commands

### start
The primary command that initiates the portfolio rebalancing process across all configured accounts. It loads account configurations, establishes connections to the Tinkoff Investment API, and executes the rebalancing algorithm according to each account's specified parameters.

**Invocation Syntax**
```bash
npm run start [-- --once]
```

**Flags**
- `--once`: Executes a single rebalancing iteration and exits immediately. Without this flag, the command runs continuously according to each account's balance_interval setting.

**Workflow**
1. Loads configuration from CONFIG.json using configLoader
2. Processes each account sequentially
3. For each account, sets the ACCOUNT_ID environment variable and invokes the provider module
4. The provider retrieves current portfolio positions and triggers the balancer logic
5. Orders are executed based on the difference between current and desired portfolio allocations

When the `--once` flag is present, the command performs one complete cycle of rebalancing and terminates. Otherwise, it continues running, processing accounts according to their configured balance_interval values.

**Practical Usage**
```bash
# Run continuous rebalancing
npm run start

# Execute single rebalancing iteration
npm run start -- --once
```

**Implementation Link**
[SPEC SYMBOL](file://src/index.ts#L0-L65)

**Section sources**
- [src/index.ts](file://src/index.ts#L0-L65)
- [package.json](file://package.json)

### accounts
Retrieves and displays information about all available Tinkoff investment accounts accessible with the provided authentication token. This command helps users identify which accounts can be managed by the bot.

**Invocation Syntax**
```bash
npm run accounts
```

**Workflow**
1. Attempts to retrieve a valid API token either from the first configured account in CONFIG.json or from the T_INVEST_TOKEN environment variable
2. Creates an SDK instance with the obtained token
3. Calls the Tinkoff API to list all accessible accounts
4. Displays account details including ID, type, and name

**Error Handling**
- If no token is found in CONFIG.json or environment variables, the command exits with status code 1 and displays an error message instructing the user to configure the token properly.

**Practical Usage**
```bash
# List all accessible accounts
npm run accounts
```

**Implementation Link**
[SPEC SYMBOL](file://src/index.ts#L10-L48)

**Section sources**
- [src/index.ts](file://src/index.ts#L10-L48)

## Configuration Management

### config
A comprehensive tool for managing multiple account configurations. It provides various subcommands for viewing, validating, and troubleshooting configuration settings in CONFIG.json.

**Invocation Syntax**
```bash
npm run config [command] [arguments]
```

**Subcommands**
- `list`: Shows a summary of all configured accounts
- `show <account_id>`: Displays detailed information about a specific account
- `validate`: Validates the entire configuration for correctness
- `env`: Shows required environment variable setup
- `tokens`: Displays token information and resolution status
- `help`: Shows help documentation

**Account Information Displayed**
- Account name and ID
- Token source (environment variable or direct specification)
- Account number
- Rebalancing mode and interval
- Target portfolio weights with sum validation
- Margin trading configuration (if enabled)

**Validation Features**
The validate command checks for:
- Proper configuration structure
- Unique account IDs
- Token resolution (verifies environment variables exist)
- Portfolio weight sum (warns if not close to 100%)
- Configuration consistency

**Practical Usage**
```bash
# List all accounts
npm run config list

# Show details for specific account
npm run config show account_1

# Validate entire configuration
npm run config validate

# Show environment variable setup
npm run config env
```

**Implementation Link**
[SPEC SYMBOL](file://src/tools/configManager.ts#L0-L271)

**Section sources**
- [src/tools/configManager.ts](file://src/tools/configManager.ts#L0-L271)

## Market Data Tools

### etf-cap
Analyzes ETF and share market capitalization by combining data from the Tinkoff API with AUM (Assets Under Management) data scraped from T-Capital's statistics page. This command helps assess potential market impact and liquidity when executing large rebalancing orders.

**Invocation Syntax**
```bash
npm run etf-cap [ticker1,ticker2,...] [--once]
```

**Workflow**
1. Retrieves tickers from command arguments or falls back to those defined in the first account's desired_wallet
2. Fetches AUM data from T-Capital's website through HTML scraping
3. Retrieves market data (price, number of shares) from Tinkoff API
4. Calculates market capitalization as price × number of shares
5. Compares market cap with AUM to identify potential premium/discount situations

**Caching Mechanism**
The command implements a caching system for both AUM and market cap data:
- AUM cache stored in `.aum-cache-{accountId}.json`
- Market cap cache stored in `.marketcap-cache-{accountId}.json`
- Cache TTL configurable via aum_cache.ttl_hours in CONFIG.json

**Data Sources**
- T-Capital Funds website (https://t-capital-funds.ru/statistics/) for AUM data
- Tinkoff Investment API for pricing and instrument metadata
- Local cache files for performance optimization

**Practical Usage**
```bash
# Analyze default ETFs from configuration
npm run etf-cap

# Analyze specific ETFs
npm run etf-cap TGLD,TRUR,TRND

# Analyze all major ETFs
npm run poll:metrics:all
```

**Implementation Link**
[SPEC SYMBOL](file://src/tools/etfCap.ts#L0-L694)

**Section sources**
- [src/tools/etfCap.ts](file://src/tools/etfCap.ts#L0-L694)

### poll:metrics
Collects and stores comprehensive metrics for ETFs, including share count, pricing, market capitalization, and AUM. This command supports both one-time collection and continuous polling modes.

**Invocation Syntax**
```bash
npm run poll:metrics [ticker1,ticker2,...] [--once] [--interval=milliseconds]
```

**Workflow**
1. Determines tickers to analyze (from arguments or configuration)
2. For each ticker:
   - Fetches latest share count from Tinkoff's Smartfeed API using brand names
   - Falls back to local shares_count cache if API unavailable
   - Retrieves current price from Tinkoff API
   - Calculates market capitalization
   - Obtains AUM data from T-Capital
   - Computes decorrelation percentage (market cap vs AUM)
3. Stores results in JSON files in the etf_metrics directory

**Polling Modes**
- One-time mode (`--once`): Executes once and exits
- Continuous mode: Runs in a loop with configurable interval (default: 1 hour)

**Smartfeed Integration**
The command uses Tinkoff's Smartfeed API to obtain authoritative share count information by:
- Mapping tickers to brand names (e.g., TBRU → "Российские облигации")
- Querying the Smartfeed news feed for announcements containing share count updates
- Extracting share count from news item metadata

**Practical Usage**
```bash
# Collect metrics once for default ETFs
npm run poll:metrics -- --once

# Collect metrics for specific ETFs
npm run poll:metrics TGLD,TRUR -- --once

# Start continuous polling with custom interval
npm run poll:metrics -- --interval=1800000  # Every 30 minutes
```

**Implementation Link**
[SPEC SYMBOL](file://src/tools/pollEtfMetrics.ts#L0-L404)

**Section sources**
- [src/tools/pollEtfMetrics.ts](file://src/tools/pollEtfMetrics.ts#L0-L404)

## Debugging and Testing

### debug:balancer
Diagnoses issues in the portfolio balancing process by analyzing instrument availability and price data retrieval. This command is essential for troubleshooting why certain ETFs might not be included in rebalancing operations.

**Invocation Syntax**
```bash
npm run debug:balancer
```

**Diagnostic Workflow**
1. Loads the first account's desired_wallet configuration
2. Retrieves the complete list of instruments from Tinkoff API
3. For each configured ETF:
   - Checks if the instrument exists in the instruments list
   - Attempts to fetch the last price data
   - Reports success or failure with detailed reasons
4. Generates a comprehensive summary of findings

**Common Issues Identified**
- Instruments not found in INSTRUMENTS array (ticker mismatch or API access issues)
- Price data retrieval failures (market closed, API errors)
- Configuration inconsistencies

**Output Includes**
- Detailed analysis of each ETF's availability
- Summary statistics of successful vs failed instruments
- Recommendations for resolving identified issues
- Verification that all configured ETFs can be processed

**Practical Usage**
```bash
# Run full balancer diagnostics
npm run debug:balancer
```

**Implementation Link**
[SPEC SYMBOL](file://src/tools/debugBalancer.ts#L0-L287)

**Section sources**
- [src/tools/debugBalancer.ts](file://src/tools/debugBalancer.ts#L0-L287)

### test:balancer-logic
Tests the core logic of the portfolio rebalancing algorithm, specifically focusing on the normalizeDesire function that ensures target allocations sum to 100%. This command verifies fixes for known issues in portfolio normalization.

**Invocation Syntax**
```bash
npm run test:balancer-logic
```

**Test Scenario**
Uses a configuration where 12 ETFs are each assigned 25%, resulting in a total of 300%. The test verifies that the normalization function correctly:
- Scales percentages so they sum to exactly 100%
- Maintains proportional relationships between allocations
- Produces expected final percentages (~8.33% each)

**Problem Analysis**
The command includes built-in analysis of a previously identified issue:
- Original problem: When total desired allocation exceeded 100%, normalization produced incorrect target values
- Solution: Fixed normalizeDesire function that properly handles over-allocated portfolios
- Verification: Confirms that sum equals 100% and individual allocations are mathematically correct

**Practical Usage**
```bash
# Test balancer normalization logic
npm run test:balancer-logic
```

**Implementation Link**
[SPEC SYMBOL](file://src/tools/testBalancerLogic.ts#L0-L68)

**Section sources**
- [src/tools/testBalancerLogic.ts](file://src/tools/testBalancerLogic.ts#L0-L68)

### debug_tobuylots
Diagnoses issues in the order calculation logic, specifically focusing on the toBuyLots calculation that determines how many lots to buy or sell. This standalone script helps identify why selling orders might not be generated when expected.

**Invocation Syntax**
```bash
bun run debug_tobuylots.ts
```

**Test Case**
Simulates a portfolio with:
- 50 lots of TGLD valued at 100₽ each (total 5,000₽)
- 10 lots of TRUR valued at 100₽ each (total 1,000₽)
- 1,000₽ in cash
With a desired allocation of 50% TGLD and 50% TRUR, the script verifies that the system correctly identifies:
- Need to sell 20 lots of TGLD (raising 2,000₽)
- Need to buy 20 lots of TRUR (costing 2,000₽)

**Diagnostic Output**
- Current portfolio value breakdown
- Expected vs calculated order quantities
- Final portfolio percentages after hypothetical rebalancing
- Identification of missing sell orders if logic is flawed

**Practical Usage**
```bash
# Diagnose toBuyLots calculation issues
bun run debug_tobuylots.ts
```

**Implementation Link**
[SPEC SYMBOL](file://debug_tobuylots.ts#L0-L109)

**Section sources**
- [debug_tobuylots.ts](file://debug_tobuylots.ts#L0-L109)

## Performance and Build

### build
Compiles the TypeScript source code into optimized JavaScript for production deployment. This command prepares the application for execution in environments without Bun development tools.

**Invocation Syntax**
```bash
npm run build
```

**Build Process**
- Transpiles TypeScript to JavaScript
- Outputs to the dist directory
- Targets the Bun runtime environment
- Preserves source maps for debugging

**Practical Usage**
```bash
# Build for production
npm run build
```

### build:optimized
Creates a highly optimized production build with minification and code splitting to reduce file size and improve load times.

**Invocation Syntax**
```bash
npm run build:optimized
```

**Optimization Features**
- Code minification
- Source map generation
- Code splitting
- Tree shaking to eliminate unused code

**Practical Usage**
```bash
# Build optimized version
npm run build:optimized
```

### perf:*
Performance benchmarking commands that measure execution time for critical operations using the Unix time command.

**Available Benchmarks**
- `perf:etf-cap`: Measures execution time of the etf-cap command
- `perf:build`: Measures build process duration
- `perf:test`: Measures test suite execution time

**Practical Usage**
```bash
# Benchmark etf-cap performance
npm run perf:etf-cap

# Benchmark build performance
npm run perf:build
```

**Section sources**
- [package.json](file://package.json)

## Command Interaction with Configuration

### Configuration File Structure
Commands interact with two primary configuration sources:

**CONFIG.json**
Main configuration file containing:
- Multiple account definitions with unique IDs
- API tokens (direct or via environment variables)
- Desired portfolio allocations (desired_wallet)
- Rebalancing intervals and sleep times
- Margin trading settings
- Exchange closure behavior

**Environment Variables (.env file)**
Sensitive configuration stored separately:
- T_INVEST_TOKEN and related variables
- OPENROUTER_API_KEY for AI features
- Other authentication credentials

### Configuration Loading Process
The configLoader module (src/configLoader.ts) provides a unified interface for all commands to access configuration:

**Key Functions**
- `getAllAccounts()`: Returns all configured accounts
- `getAccountToken(accountId)`: Resolves token from direct value or environment variable
- `isTokenFromEnv(accountId)`: Determines token source
- `loadConfig()`: Parses and validates CONFIG.json

**Token Resolution Logic**
Tokens can be specified in two ways:
1. Directly: `"t_invest_token": "t.1234567890abcdef"`
2. Via environment variable: `"t_invest_token": "${T_INVEST_TOKEN_1}"`

The configLoader resolves environment variable references by extracting the variable name and looking it up in process.env.

**Validation Rules**
The configuration loader enforces several validation rules:
- Required fields for each account (id, name, token, etc.)
- Percentage values between 0-100
- Total wallet weight between 50-150% (before normalization)
- Valid exchange_closure_behavior modes
- Proper margin trading configuration

**Section sources**
- [src/configLoader.ts](file://src/configLoader.ts#L0-L344)

## Security Implications

### Read-Only Commands
Commands that only retrieve data from APIs without modifying account state:
- `accounts`: Reads account information
- `config`: Reads and validates configuration
- `etf-cap`: Retrieves market data and AUM information
- `poll:metrics`: Collects ETF metrics
- `debug:balancer`: Diagnoses instrument availability
- All test and performance commands

These commands pose minimal security risk as they cannot execute trades or modify portfolio holdings.

### Trading Commands
Commands that can trigger actual trades through the Tinkoff API:
- `start`: Primary rebalancing command that executes buy/sell orders
- `dev`: Development mode of the start command with enhanced logging

These commands require full trading permissions and can significantly alter portfolio composition. They should only be run with trusted configuration files and after thorough testing.

### Security Best Practices
1. **Token Protection**: Always use environment variables for API tokens rather than hardcoding them
2. **Configuration Validation**: Use `npm run config validate` before running trading commands
3. **Dry Runs**: Test rebalancing logic with simulated data before enabling real trading
4. **Access Control**: Restrict access to the configuration files and environment variables
5. **Monitoring**: Regularly review trade history to detect unintended operations

The system's security model relies on proper configuration management, with the most critical safeguard being the separation of API tokens from version-controlled configuration files.

**Section sources**
- [src/index.ts](file://src/index.ts#L0-L65)
- [src/configLoader.ts](file://src/configLoader.ts#L0-L344)

## Error Conditions and Exit Codes

### Common Error Conditions

**Authentication Errors**
- No token found in CONFIG.json or environment variables
- Invalid token format
- Expired or revoked token
- Insufficient API permissions

**Configuration Errors**
- Missing required fields in CONFIG.json
- Invalid percentage values
- Duplicate account IDs
- Unresolvable environment variables

**API and Network Errors**
- Tinkoff API rate limiting
- Network connectivity issues
- Service unavailability
- Invalid responses from external services

**Data Processing Errors**
- Instrument not found in API response
- Price data unavailable
- Parsing failures for HTML content
- Cache read/write failures

### Exit Codes
- **0**: Success - Command completed successfully
- **1**: Failure - Command encountered an error and could not complete
- **2**: Validation error - Configuration or input validation failed

### Error Handling Patterns
Commands follow consistent error handling patterns:
- Try-catch blocks around critical operations
- Descriptive error messages indicating cause and potential solutions
- Graceful degradation when possible (e.g., falling back to cached data)
- Comprehensive validation before executing potentially destructive operations

The system prioritizes safety over automation, preferring to fail explicitly rather than execute potentially harmful operations with invalid configuration.

**Section sources**
- [src/index.ts](file://src/index.ts#L0-L65)
- [src/tools/configManager.ts](file://src/tools/configManager.ts#L0-L271)
- [src/configLoader.ts](file://src/configLoader.ts#L0-L344)