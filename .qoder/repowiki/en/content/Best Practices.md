# Best Practices

<cite>
**Referenced Files in This Document**   
- [configLoader.ts](file://src/configLoader.ts)
- [index.ts](file://src/balancer/index.ts)
- [configManager.ts](file://src/tools/configManager.ts)
- [marginCalculator.ts](file://src/utils/marginCalculator.ts)
- [provider/index.ts](file://src/provider/index.ts)
- [CONFIG.example.json](file://CONFIG.example.json)
- [README.config.md](file://README.config.md)
- [MARGIN_TRADING_SUMMARY.md](file://MARGIN_TRADING_SUMMARY.md)
- [pollEtfMetrics.ts](file://src/tools/pollEtfMetrics.ts)
- [analyzeNews.ts](file://src/tools/analyzeNews.ts)
- [ha/index.ts](file://src/ha/index.ts)
- [diffCalculator.ts](file://src/balancer/diffCalculator.ts)
- [desiredBuilder.ts](file://src/balancer/desiredBuilder.ts)
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Risk Management Principles](#risk-management-principles)
3. [Configuration Optimization](#configuration-optimization)
4. [Performance Considerations](#performance-considerations)
5. [Security Practices](#security-practices)
6. [Monitoring and Verification Procedures](#monitoring-and-verification-procedures)
7. [Parameter Tuning Based on Market Conditions](#parameter-tuning-based-on-market-conditions)
8. [Conclusion](#conclusion)

## Introduction
The Tinkoff Invest ETF Balancer Bot is an automated trading system designed to rebalance investment portfolios according to predefined ETF allocations. It supports advanced features such as margin trading, news sentiment analysis, and dynamic metric polling for informed decision-making. This document outlines best practices for safe and effective usage, focusing on risk management, configuration optimization, performance tuning, security, monitoring, and adaptive parameter selection.

**Section sources**
- [README.config.md](file://README.config.md#L1-L50)
- [CONFIG.example.json](file://CONFIG.example.json#L1-L100)

## Risk Management Principles

### Position Sizing
Proper position sizing ensures that no single trade excessively impacts the overall portfolio. The bot calculates position sizes based on current holdings, target weights, and available capital. Users should avoid allocating more than a predetermined percentage of their portfolio to any single ETF unless justified by strong conviction and diversification across uncorrelated assets.

### Diversification
Diversification reduces exposure to individual asset volatility. The bot enables users to define multi-ETF portfolios with customizable weightings in the configuration file. Community insights suggest maintaining at least 5–7 ETFs across different sectors or regions to mitigate systemic risks.

### Stop-Loss Strategies
While the bot does not natively implement stop-loss orders for individual ETFs, it incorporates circuit-breaker logic through `minProfitThreshold` and rebalancing mode constraints. These mechanisms prevent trades that would result in immediate losses or excessive churn. For additional protection, users are advised to set external stop-loss rules via the Tinkoff API or use conservative thresholds within the bot’s logic.

**Section sources**
- [index.ts](file://src/balancer/index.ts#L20-L80)
- [diffCalculator.ts](file://src/balancer/diffCalculator.ts#L15-L60)
- [desiredBuilder.ts](file://src/balancer/desiredBuilder.ts#L10-L50)

## Configuration Optimization

### Rebalancing Frequency
Rebalancing frequency can be tuned using the `rebalancingMode` parameter:
- **"daily"**: Triggers rebalancing once per day.
- **"manual"**: Requires explicit activation.
- **"continuous"**: Runs whenever market data updates (higher API usage).

To minimize transaction costs, select less frequent modes unless high volatility demands active adjustment. Use `pollEtfMetrics.ts` to analyze historical drift before deciding on optimal intervals.

### Minimizing Transaction Costs
Transaction cost efficiency is achieved through:
- Setting appropriate `minProfitThreshold` values to avoid micro-adjustments.
- Using `buyRequiresTotalMarginalSell` logic to ensure purchases are funded by prior sales, reducing cash drag and loan dependency.
- Avoiding unnecessary trades during low-volatility periods.

Community testing shows that setting `minProfitThreshold` between 0.5% and 1.5% balances responsiveness with cost efficiency.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L30-L90)
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts#L5-L40)
- [configManager.ts](file://src/tools/configManager.ts#L10-L70)

## Performance Considerations

### Execution Timing Relative to Market Hours
The bot respects exchange closure rules documented in `EXCHANGE_CLOSURE_IMPLEMENTATION.md`. All trading operations are suspended outside Moscow time market hours (10:00–18:50). To maximize execution reliability:
- Schedule bot runs just after market open.
- Avoid initiating rebalances near close to allow full settlement window.
- Monitor logs for skipped cycles due to timing.

### API Rate Limit Awareness
Tinkoff API imposes rate limits. The provider layer (`provider/index.ts`) includes retry logic and request throttling. However, aggressive polling in `pollEtfMetrics.ts` or frequent config reloads may trigger throttling. Recommended practices:
- Limit metric polling to once every 5–10 minutes.
- Cache responses where possible.
- Use `provider-network-retry-logic.test.ts` as reference for resilience patterns.

**Section sources**
- [provider/index.ts](file://src/provider/index.ts#L25-L100)
- [pollEtfMetrics.ts](file://src/tools/pollEtfMetrics.ts#L15-L80)
- [EXCHANGE_CLOSURE_IMPLEMENTATION.md](file://EXCHANGE_CLOSURE_IMPLEMENTATION.md#L1-L30)

## Security Practices

### Protecting API Tokens
API keys must never be committed to version control. The bot uses environment variables or external config files (e.g., `CONFIG.json`) for credentials. Always:
- Store tokens outside the repository.
- Use restricted API keys with only necessary permissions (read portfolio, place orders).
- Rotate keys periodically.

### Financial Data Protection
All local configurations containing financial data should be encrypted or access-controlled. Avoid running the bot on shared machines. Use `debug-config.js` only in secure environments and remove sensitive outputs immediately.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L5-L25)
- [CONFIG.example.json](file://CONFIG.example.json#L1-L20)

## Monitoring and Verification Procedures

### Monitoring Bot Activity
Enable logging via `debug_with_logs.ts` to track:
- Portfolio drift over time.
- Trade decisions and rationale.
- API call status and errors.

Use `expenseTracker/index.ts` and `profitCalculator/index.ts` to audit performance post-trade. Integrate with external alerting tools if available.

### Pre-Live Trading Verification
Before enabling live trading:
1. Test configurations using `CONFIG.test.json` and `test_balancer_logic.ts`.
2. Validate order simulation output with `demoDetailedOutput.ts`.
3. Run integration tests like `comprehensive-integration.test.ts`.
4. Confirm margin calculations using `marginCalculator.ts` under various scenarios.

Only proceed when simulated results match expectations across multiple test cases.

**Section sources**
- [test-setup.ts](file://src/test-setup.ts#L1-L20)
- [demo-enhancements.ts](file://demo-enhancements.ts#L10-L40)
- [debug_balancer.ts](file://debug_balancer.ts#L5-L30)

## Parameter Tuning Based on Market Conditions

### minProfitThreshold Adjustment
Community-driven insights recommend:
- **High Volatility Markets**: Lower `minProfitThreshold` (0.3%–0.7%) to capture rapid movements.
- **Low Volatility Markets**: Raise threshold (1.0%–2.0%) to reduce noise-driven trades.
- Combine with `ha/index.ts` (Hurst exponent analysis) to detect trending vs. mean-reverting regimes.

### rebalancingMode Selection
- **"daily"**: Ideal for stable markets; prevents overtrading.
- **"manual"**: Preferred during uncertain macroeconomic events.
- **"continuous"**: Suitable for arbitrage-focused strategies but increases operational load.

Use `analyzeNews.ts` to ingest T-Bank news sentiment and adjust mode dynamically—e.g., switch to manual during negative macro headlines.

**Section sources**
- [ha/index.ts](file://src/ha/index.ts#L1-L40)
- [analyzeNews.ts](file://src/tools/analyzeNews.ts#L10-L60)
- [min-profit-threshold-logic.test.ts](file://src/__tests__/min-profit-threshold-logic.test.ts#L1-L50)

## Conclusion
Safe and effective usage of the Tinkoff Invest ETF Balancer Bot requires disciplined application of risk management, thoughtful configuration, awareness of performance constraints, robust security, thorough pre-deployment verification, and adaptive parameter tuning. By following these best practices, users can optimize returns while minimizing exposure to avoidable risks. Always validate changes in test environments before applying them to live accounts.