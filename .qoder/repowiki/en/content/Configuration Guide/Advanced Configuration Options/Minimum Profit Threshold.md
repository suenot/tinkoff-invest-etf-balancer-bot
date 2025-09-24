# Minimum Profit Threshold

<cite>
**Referenced Files in This Document **   
- [CONFIG.json](file://CONFIG.json)
- [configLoader.ts](file://src/configLoader.ts)
- [index.ts](file://src/balancer/index.ts)
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts)
- [min-profit-threshold-logic.test.ts](file://src/__tests__/min-profit-threshold-logic.test.ts)
- [min-profit-threshold-validation.test.ts](file://src/__tests__/configLoader/min-profit-threshold-validation.test.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Configuration Syntax and Default Behavior](#configuration-syntax-and-default-behavior)
3. [Threshold Validation Rules](#threshold-validation-rules)
4. [Integration with diffCalculator and marginCalculator](#integration-with-diffcalculator-and-margincalculator)
5. [Profit Calculation Logic](#profit-calculation-logic)
6. [Edge Cases Handling](#edge-cases-handling)
7. [Interaction with Dry-Run Modes](#interaction-with-dry-run-modes)
8. [Test Scenarios](#test-scenarios)
9. [Common Issues and Troubleshooting](#common-issues-and-troubleshooting)
10. [Threshold Tuning Strategies](#threshold-tuning-strategies)

## Introduction
The `minProfitThreshold` configuration option prevents the closure of positions unless a minimum profit target is met, reducing unnecessary trading and associated tax implications. This feature enables users to set a percentage threshold that must be achieved before sell orders are executed, ensuring that trades only occur when they meet predefined profitability criteria. The implementation supports both positive profit targets and negative values representing maximum allowable losses (stop-loss functionality). When configured, the system evaluates each potential sell position against this threshold before including it in the order execution plan.

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L318-L344)
- [index.ts](file://src/balancer/index.ts#L794-L794)

## Configuration Syntax and Default Behavior
The `min_profit_percent_for_close_position` parameter is defined at the account level within the CONFIG.json file as a numeric value representing the minimum required profit percentage for closing positions. The configuration accepts positive values for profit targets, negative values for stop-loss thresholds, and zero to require break-even execution. When omitted or set to undefined, the feature is disabled and all sell decisions proceed without profit validation. In the provided CONFIG.json example, a threshold of 1% is applied to two accounts, requiring all closed positions to achieve at least 1% profit. The default behavior without this configuration is to allow all sell operations regardless of profitability status.

```json
{
  "accounts": [
    {
      "id": "2272547076",
      "name": "Основной брокерский счет",
      "desired_wallet": {
        "TGLD": 8.33,
        "TRUR": 8.33
      },
      "min_profit_percent_for_close_position": 1
    }
  ]
}
```

**Diagram sources **
- [CONFIG.json](file://CONFIG.json#L78-L88)

**Section sources**
- [CONFIG.json](file://CONFIG.json#L78-L88)
- [configLoader.ts](file://src/configLoader.ts#L318-L344)

## Threshold Validation Rules
The validation rules for `min_profit_percent_for_close_position` enforce strict type and range requirements during configuration loading. The value must be a finite number within the range of -100 to 1000 percent, where -100 represents complete loss tolerance and 1000 represents a 10x profit requirement. Non-numeric types (strings, booleans, objects) trigger validation errors with descriptive messages indicating the account ID and expected type. The validation occurs in the ConfigLoader class's `validateMinProfitPercentForClosePosition` method, which checks both data type integrity and boundary conditions. Multiple accounts can have different threshold values, but any invalid configuration in one account will prevent the entire configuration from loading. Boundary testing confirms acceptance of edge values like -100% (maximum loss) and 1000% (extreme profit target).

**Section sources**
- [configLoader.ts](file://src/configLoader.ts#L318-L344)
- [min-profit-threshold-validation.test.ts](file://src/__tests__/configLoader/min-profit-threshold-validation.test.ts#L1-L411)

## Integration with diffCalculator and marginCalculator
The minimum profit threshold integrates with the diffCalculator module by operating on the final selling decisions after all portfolio rebalancing calculations are complete. While diffCalculator determines position adjustments based on desired allocations and market differences, the profit threshold acts as a final filter on sell orders. For margin trading accounts, the threshold works in conjunction with marginCalculator by evaluating profitability of margin positions before executing closure strategies. When margin positions are identified for removal according to the balancing strategy, each position must still meet the profit threshold before being included in the execution plan. This creates a dual validation process where both margin requirements and profitability criteria must be satisfied for position closures.

**Section sources**
- [index.ts](file://src/balancer/index.ts#L794-L794)
- [diffCalculator.ts](file://src/balancer/diffCalculator.ts#L0-L241)
- [marginCalculator.ts](file://src/utils/marginCalculator.ts#L6-L275)

## Profit Calculation Logic
The profit calculation logic compares the current market value of a position against its original purchase cost using FIFO (First-In, First-Out) accounting when available, falling back to average cost basis if FIFO data is unavailable. The system calculates profit percentage as `(currentValue - purchaseCost) / purchaseCost * 100`, then compares this against the configured threshold. Positions with insufficient data (missing purchase price, zero quantity, or invalid pricing) are excluded from selling consideration. The calculation handles various scenarios including partial fills, where only the portion of the position meeting the threshold may be sold. For positions exactly meeting the threshold (e.g., 5.0% profit with 5.0% threshold), the system allows the sale since the condition uses greater-than-or-equal comparison.

**Section sources**
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts#L10-L100)
- [min-profit-threshold-logic.test.ts](file://src/__tests__/min-profit-threshold-logic.test.ts#L1-L287)

## Edge Cases Handling
The implementation handles several edge cases including partial fills, market volatility, and extreme market conditions. During periods of high volatility, positions may temporarily meet the threshold due to price spikes, but the system evaluates prices at order generation time rather than maintaining continuous monitoring. For partially filled positions, the calculation uses the remaining position's average cost basis. Positions with zero or negative total value are excluded from consideration. The system also handles cases where multiple positions in the same instrument have different cost bases by using the available average or FIFO cost information. When market data is unavailable or delayed, the last known valid price is used for calculation, with appropriate logging to indicate potential inaccuracies.

**Section sources**
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts#L10-L100)
- [index.ts](file://src/balancer/index.ts#L794-L794)

## Interaction with Dry-Run Modes
In dry-run mode, the minimum profit threshold functions identically to live execution but without placing actual orders. The system evaluates all potential sell positions against the threshold and reports which positions would be allowed or blocked based on profitability. This allows users to test their threshold settings and observe the impact on portfolio rebalancing without executing trades. The dry-run output includes detailed logging showing the profit percentage of each position and whether it meets the threshold criteria. This diagnostic capability helps users fine-tune their threshold values based on historical performance and market conditions before enabling live trading with the constraint.

**Section sources**
- [index.ts](file://src/balancer/index.ts#L794-L794)
- [configLoader.ts](file://src/configLoader.ts#L318-L344)

## Test Scenarios
The test suite includes comprehensive scenarios validating both logic and validation rules. The `min-profit-threshold-logic.test.ts` file contains unit tests verifying correct profit calculations across various scenarios including profitable positions, losing positions, break-even cases, and edge conditions. Tests confirm proper handling of negative thresholds (stop-loss) and exact threshold matches. The `min-profit-threshold-validation.test.ts` file validates configuration integrity, testing acceptable ranges, data types, and error conditions. Integration tests verify that positions below the threshold are excluded from sell orders while those meeting or exceeding it are processed normally. Real-world scenarios test typical conservative (3%) and aggressive (1%) thresholds, decimal values, and stop-loss configurations (-5%).

**Section sources**
- [min-profit-threshold-logic.test.ts](file://src/__tests__/min-profit-threshold-logic.test.ts#L1-L287)
- [min-profit-threshold-validation.test.ts](file://src/__tests__/configLoader/min-profit-threshold-validation.test.ts#L1-L411)

## Common Issues and Troubleshooting
Common issues include unexecuted sell orders when positions fail to meet the threshold, particularly during sideways markets where profits remain stagnant. Users may experience frustration when rebalancing is blocked despite significant market movements if the specific position hasn't reached the threshold. Another issue occurs when FIFO cost data is unavailable, causing the system to fall back to average cost basis which may produce different profit calculations. To troubleshoot, users should verify position cost data availability, check logging output for profit percentage calculations, and consider adjusting thresholds based on current market volatility. Temporary disabling of the feature can help isolate whether the threshold is preventing necessary rebalancing.

**Section sources**
- [index.ts](file://src/balancer/index.ts#L794-L794)
- [buyRequiresTotalMarginalSell.ts](file://src/utils/buyRequiresTotalMarginalSell.ts#L10-L100)

## Threshold Tuning Strategies
Effective threshold tuning depends on portfolio size, risk tolerance, and market conditions. Conservative investors with large portfolios may use higher thresholds (3-5%) to minimize trading frequency and tax implications, while active traders might employ lower thresholds (0.5-1%) to maintain portfolio balance. During high-volatility periods, temporary reduction of thresholds prevents excessive deviation from target allocations. Portfolio size influences threshold selection as larger portfolios generate more absolute profit at lower percentages, making smaller percentage thresholds viable. Risk-averse investors often combine positive profit thresholds with stop-loss levels (negative thresholds) to protect gains while limiting downside. Regular review of threshold effectiveness through performance analysis helps optimize settings for changing market environments.

**Section sources**
- [index.ts](file://src/balancer/index.ts#L794-L794)
- [min-profit-threshold-logic.test.ts](file://src/__tests__/min-profit-threshold-logic.test.ts#L1-L287)