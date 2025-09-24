# Configuration Structure

<cite>
**Referenced Files in This Document**   
- [CONFIG.example.json](file://CONFIG.example.json)
- [configLoader.ts](file://src/configLoader.ts)
- [types.d.ts](file://src/types.d.ts)
</cite>

## Table of Contents
1. [Configuration Overview](#configuration-overview)
2. [Top-Level Properties](#top-level-properties)
3. [Account Object Schema](#account-object-schema)
4. [Target Allocations (desired_wallet)](#target-allocations-desired_wallet)
5. [Environment Variable Interpolation](#environment-variable-interpolation)
6. [Advanced Features and Nested Structures](#advanced-features-and-nested-structures)
7. [Validation Rules and Error Handling](#validation-rules-and-error-handling)
8. [Common Structural Errors and Troubleshooting](#common-structural-errors-and-troubleshooting)
9. [Annotated Configuration Examples](#annotated-configuration-examples)

## Configuration Overview

The configuration system for the Tinkoff Invest ETF Balancer Bot is defined through a JSON structure that governs portfolio rebalancing behavior across multiple brokerage accounts. The primary configuration file, `CONFIG.json`, follows a schema validated by `configLoader.ts` and typed via `types.d.ts`. It supports both simple manual allocations and advanced strategies such as AUM-based or decorrelation-driven rebalancing.

The root object contains an array of account configurations and optional global settings like AUM caching. Each account defines its own rebalancing parameters, including target ETF weights, trading modes, margin settings, and exchange closure behavior.

**Section sources**
- [types.d.ts](file://src/types.d.ts#L137-L146)
- [configLoader.ts](file://src/configLoader.ts#L10-L344)

## Top-Level Properties

The top-level configuration object includes the following key properties:

- **accounts**: Array of individual account configurations, each representing a distinct brokerage account to manage.
- **aum_cache (optional)**: Global cache settings for Asset Under Management (AUM) data retrieval, improving performance during market-cap or AUM-based rebalancing.

Each account must define:
- `id`: Unique identifier for the account within the system.
- `name`: Human-readable name for display purposes.
- `t_invest_token`: API token for Tinkoff Invest, supporting environment variable interpolation via `${VAR_NAME}` syntax.
- `account_id`: Broker-assigned account number.
- `desired_wallet`: Mapping of ETF tickers to percentage allocation targets.
- `desired_mode`: Rebalancing strategy mode (`manual`, `marketcap`, `aum`, etc.).
- `balance_interval`: Time between rebalancing iterations in milliseconds.
- `sleep_between_orders`: Delay between order executions in milliseconds.
- `margin_trading`: Configuration for margin trading capabilities.
- `exchange_closure_behavior`: Behavior when financial markets are closed.

**Section sources**
- [types.d.ts](file://src/types.d.ts#L102-L135)
- [CONFIG.example.json](file://CONFIG.example.json#L1-L52)

## Account Object Schema

Each account object conforms to the `AccountConfig` interface defined in `types.d.ts`. Required fields include:

| Field | Type | Description |
|------|------|-------------|
| `id` | string | Unique internal identifier |
| `name` | string | Display name for logs/UI |
| `t_invest_token` | string | Authentication token (direct or env-ref) |
| `account_id` | string | Tinkoff platform account ID |
| `desired_wallet` | DesiredWallet | Target allocation map (ISIN → %) |

Optional but commonly used fields:
- `min_profit_percent_for_close_position`: Minimum profit threshold before selling (positive = min gain, negative = max loss)
- `diff`: Diff calculation mode (`off`, `iteration`, `day`)
- `diff_multiplier`: Influence factor (0–100%) of diff adjustments on final allocation

All accounts must pass validation in `validateAccount()` within `configLoader.ts`.

**Section sources**
- [types.d.ts](file://src/types.d.ts#L102-L135)
- [configLoader.ts](file://src/configLoader.ts#L150-L200)

## Target Allocations (desired_wallet)

The `desired_wallet` property specifies the target portfolio composition using ETF tickers as keys and percentage weights as values.

```json
"desired_wallet": {
  "TRUR": 25,
  "TMOS": 25,
  "TGLD": 25,
  "RUB": 25
}
```

### Validation Rules:
- All percentages must be numbers between 0 and 100.
- Total sum should be between 50% and 150% (normalization occurs at runtime).
- Empty wallets are invalid.
- Keys must be valid instrument tickers supported by Tinkoff.

This structure uses the `DesiredWallet` type:
```typescript
export interface DesiredWallet {
  [key: string]: number;
}
```

**Section sources**
- [types.d.ts](file://src/types.d.ts#L35-L37)
- [configLoader.ts](file://src/configLoader.ts#L170-L190)

## Environment Variable Interpolation

Tokens and other sensitive values can be securely referenced using environment variable interpolation with the `${VAR_NAME}` syntax.

Example:
```json
"t_invest_token": "${T_INVEST_TOKEN}"
```

At runtime, `getAccountToken()` in `configLoader.ts` detects this pattern and retrieves the value from `process.env[T_INVEST_TOKEN]`.

### Key Behavior:
- If the token starts with `${` and ends with `}`, it's treated as an environment reference.
- Missing environment variables will result in undefined tokens, causing authentication failure.
- Direct tokens (e.g., `"t.direct"`) are used as-is without interpolation.

This mechanism enables secure deployment without hardcoding credentials.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L110-L130)

## Advanced Features and Nested Structures

### Exchange Closure Behavior

Controls bot behavior when markets are closed:

```json
"exchange_closure_behavior": {
  "mode": "dry_run",
  "update_iteration_result": true
}
```

| Mode | Description |
|------|-------------|
| `skip_iteration` | Skip rebalancing entirely |
| `force_orders` | Attempt to place orders (may fail) |
| `dry_run` | Calculate changes but don't execute |

`update_iteration_result`: Whether to log results despite closure.

Defined via `ExchangeClosureBehavior` interface:
```typescript
export interface ExchangeClosureBehavior {
  mode: ExchangeClosureMode; // 'skip_iteration' | 'force_orders' | 'dry_run'
  update_iteration_result: boolean;
}
```

**Section sources**
- [types.d.ts](file://src/types.d.ts#L84-L98)
- [configLoader.ts](file://src/configLoader.ts#L300-L320)

### Margin Trading Settings

Enables leverage-based trading:

```json
"margin_trading": {
  "enabled": true,
  "multiplier": 2,
  "free_threshold": 5000,
  "max_margin_size": 50000,
  "balancing_strategy": "keep_if_small"
}
```

Strategies:
- `remove`: Close margin positions during rebalance
- `keep`: Maintain existing margin exposure
- `keep_if_small`: Keep only if below threshold

Type: `AccountMarginConfig`

**Section sources**
- [types.d.ts](file://src/types.d.ts#L73-L79)
- [configLoader.ts](file://src/configLoader.ts#L150-L200)

### Buy Requires Total Marginal Sell

Prevents buying non-marginable assets unless sufficient margin capacity exists:

```json
"buy_requires_total_marginal_sell": {
  "enabled": true,
  "instruments": ["TMON"],
  "allow_to_sell_others_positions_to_buy_non_marginal_positions": {
    "mode": "equal_in_percents"
  },
  "min_buy_rebalance_percent": 0.10
}
```

Modes:
- `only_positive_positions_sell`
- `equal_in_percents`
- `none`

Validated via `validateBuyRequiresTotalMarginalSell()`.

**Section sources**
- [types.d.ts](file://src/types.d.ts#L63-L68)
- [configLoader.ts](file://src/configLoader.ts#L322-L350)

### Decorrelation and AUM-Based Rebalancing

Supported via `desired_mode`:
- `decorrelation`: Adjusts weights based on correlation metrics
- `aum`: Uses asset under management data
- `marketcap_aum`: Combines market cap and AUM signals

These require external data sources and may throw `BalancingDataError` if data is missing.

**Section sources**
- [types.d.ts](file://src/types.d.ts#L71-L71)

## Validation Rules and Error Handling

The `configLoader.ts` enforces strict validation rules:

### Project-Level Validation:
- Must have `accounts` array
- Optional `aum_cache` must have `enabled` and `ttl_hours`

### Account-Level Validation:
- Required fields: `id`, `name`, `t_invest_token`, `account_id`, `desired_wallet`
- Wallet percentages: 0 ≤ x ≤ 100
- Sum of weights: 50 ≤ total ≤ 150
- `diff_multiplier`: 0–100, finite number
- `min_profit_percent_for_close_position`: -100 to 1000

Default values:
- `exchange_closure_behavior`: `{ mode: "skip_iteration", update_iteration_result: false }`
- `diff`: `"off"`
- `diff_multiplier`: `0`

Errors are thrown with descriptive messages and halt execution.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L150-L350)

## Common Structural Errors and Troubleshooting

| Error | Cause | Solution |
|------|-------|----------|
| `"Account X must contain field Y"` | Missing required field | Add missing key-value pair |
| `"Invalid percentage for ticker Z"` | Non-number or out-of-range value | Ensure value is numeric and 0–100 |
| `"Sum of weights equals N%"` | Outside 50–150% range | Normalize total closer to 100% |
| `"t_invest_token not found in env"` | Env var not set | Export variable or use direct token |
| `"Duplicate account ID"` | IDs must be unique | Assign unique `id` values |
| `"Unknown desired_mode"` | Invalid mode string | Use one of: `manual`, `marketcap`, etc. |

Use test configs like `CONFIG.test-simple.json` for validation.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L150-L350)
- [test-configs/CONFIG.test-simple.json](file://test-configs/CONFIG.test-simple.json)

## Annotated Configuration Examples

### Single Account (Manual Mode)

```json
{
  "accounts": [
    {
      "id": "main-account",
      "name": "Primary Portfolio",
      "t_invest_token": "${T_INVEST_MAIN}",
      "account_id": "BROKER_001",
      "desired_wallet": {
        "TRUR": 30,
        "TGLD": 30,
        "TMOS": 40
      },
      "desired_mode": "manual",
      "balance_interval": 3600000,
      "sleep_between_orders": 3000,
      "margin_trading": {
        "enabled": false,
        "multiplier": 1,
        "free_threshold": 10000,
        "balancing_strategy": "remove"
      },
      "exchange_closure_behavior": {
        "mode": "skip_iteration",
        "update_iteration_result": false
      }
    }
  ]
}
```

**Section sources**
- [CONFIG.example.json](file://CONFIG.example.json)

### Multi-Account Configuration

```json
{
  "accounts": [
    {
      "id": "conservative",
      "name": "Low Risk",
      "t_invest_token": "${TOKEN_A}",
      "account_id": "ACC001",
      "desired_wallet": { "TRUR": 100 },
      "desired_mode": "manual",
      "margin_trading": { "enabled": false, ... }
    },
    {
      "id": "aggressive",
      "name": "High Leverage",
      "t_invest_token": "${TOKEN_B}",
      "account_id": "ACC002",
      "desired_wallet": { "TMON": 50, "TGLD": 50 },
      "desired_mode": "marketcap",
      "margin_trading": { "enabled": true, "multiplier": 3, ... }
    }
  ]
}
```

Demonstrates different strategies per account.

**Section sources**
- [test-configs/CONFIG.test-ultimate.json](file://test-configs/CONFIG.test-ultimate.json)