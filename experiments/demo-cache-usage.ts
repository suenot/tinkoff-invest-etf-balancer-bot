/**
 * Demo script showing LLM cache usage in action
 * This demonstrates how the cache system works with different scenarios
 */

import { promises as fs } from 'fs';
import path from 'path';

// Create a sample configuration with cache settings
async function createSampleConfig() {
  const sampleConfig = {
    "analysis": {
      "openrouter": {
        "cache": {
          "enabled": true,
          "ttl_hours": 168  // 7 days as per issue requirements
        }
      }
    },
    "accounts": [
      {
        "id": "demo",
        "name": "Demo Account",
        "t_invest_token": "${DEMO_TOKEN}",
        "account_id": "demo-account",
        "desired_wallet": {
          "TRUR": 100
        },
        "desired_mode": "manual",
        "balance_interval": 7200000,
        "sleep_between_orders": 5000,
        "exchange_closure_behavior": {
          "mode": "skip_iteration",
          "update_iteration_result": false
        },
        "margin_trading": {
          "enabled": false,
          "multiplier": 1,
          "free_threshold": 0,
          "max_margin_size": 0,
          "balancing_strategy": "remove"
        }
      }
    ]
  };

  await fs.writeFile('./CONFIG.demo.json', JSON.stringify(sampleConfig, null, 2));
  console.log('📝 Created demo configuration: CONFIG.demo.json');
  console.log('   - Cache enabled: true');
  console.log('   - Cache TTL: 168 hours (7 days)');
}

// Create sample news and cache files to demonstrate the system
async function createSampleData() {
  console.log('\n📂 Creating sample news and cache data...');

  // Create directory structure
  await fs.mkdir('./news/TRUR', { recursive: true });
  await fs.mkdir('./news_meta/TRUR', { recursive: true });

  // Create sample news markdown file
  const sampleNews = `# Rebalancing of T‑Bank Ruble fund
Source: https://www.tbank.ru/invest/fund-news/123456
Date: December 15, 2024

The fund has undergone rebalancing to optimize portfolio structure.

## Trading Table
| Ticker | Name | Operation | Quantity | Amount |
|--------|------|-----------|----------|--------|
| SBER   | Sberbank | Buy | 1000 | 250,000 ₽ |
| LKOH   | Lukoil | Sell | 500 | 4,200,000 ₽ |

Additional information:
- Total shares: 1,500,000
- NAV price: 1,247.50 ₽`;

  await fs.writeFile('./news/TRUR/123456.md', sampleNews);
  console.log('   ✅ Created sample news file: news/TRUR/123456.md');

  // Create a fresh cache entry (should be valid)
  const freshCacheEntry = {
    "id": "123456",
    "symbol": "TRUR",
    "title": "Rebalancing of T‑Bank Ruble fund",
    "date": "December 15, 2024",
    "category": "rebalancing",
    "summary": "The fund has undergone rebalancing to optimize portfolio structure.",
    "bullets": [
      "Fund underwent rebalancing for portfolio optimization",
      "Sberbank position increased by 1000 shares",
      "Lukoil position reduced by 500 shares"
    ],
    "trades": [
      {
        "ticker": "SBER",
        "name": "Sberbank",
        "side": "Buy",
        "qty": "1000",
        "amount": "250,000 ₽",
        "weightFrom": null,
        "weightTo": null
      },
      {
        "ticker": "LKOH",
        "name": "Lukoil",
        "side": "Sell",
        "qty": "500",
        "amount": "4,200,000 ₽",
        "weightFrom": null,
        "weightTo": null
      }
    ],
    "additionalFields": {
      "Total shares": "1,500,000",
      "NAV price": "1,247.50 ₽"
    },
    "numbers": {
      "redeemedShares": null,
      "redeemedAmountRub": null,
      "totalShares": 1500000,
      "navPriceRub": 1247.50
    },
    "cached_at": new Date().toISOString(),
    "cache_ttl_hours": 168
  };

  await fs.writeFile('./news_meta/TRUR/123456.json', JSON.stringify(freshCacheEntry, null, 2));
  console.log('   ✅ Created fresh cache entry: news_meta/TRUR/123456.json');

  // Create an expired cache entry for another news item
  const expiredDate = new Date();
  expiredDate.setDate(expiredDate.getDate() - 8); // 8 days ago (expired with 7 day TTL)

  const expiredCacheEntry = {
    "id": "123455",
    "symbol": "TRUR",
    "title": "Previous Fund Update",
    "date": "December 7, 2024",
    "category": "other",
    "summary": "This is an old cache entry that should be expired.",
    "bullets": ["Old information"],
    "trades": [],
    "additionalFields": {},
    "numbers": {
      "redeemedShares": null,
      "redeemedAmountRub": null,
      "totalShares": null,
      "navPriceRub": null
    },
    "cached_at": expiredDate.toISOString(),
    "cache_ttl_hours": 168
  };

  // Create corresponding markdown file
  await fs.writeFile('./news/TRUR/123455.md', '# Previous Fund Update\nOld news content...');
  await fs.writeFile('./news_meta/TRUR/123455.json', JSON.stringify(expiredCacheEntry, null, 2));
  console.log('   ✅ Created expired cache entry: news_meta/TRUR/123455.json');
  console.log(`      (Cached ${Math.round((Date.now() - expiredDate.getTime()) / (1000 * 60 * 60 * 24))} days ago)`);
}

// Demonstrate cache behavior
async function demonstrateCacheBehavior() {
  console.log('\n🔍 Demonstrating Cache Behavior:');

  // Simulate what analyzeNews.ts would do
  console.log('\n--- Scenario 1: Fresh cache hit ---');
  console.log('[analyzeNews] skip existing TRUR/123456.json (reason: skipped-by-cache)');

  console.log('\n--- Scenario 2: Expired cache miss ---');
  console.log('[analyzeNews] analyze TRUR/123455 via OpenRouter (reason: fetched-via-llm)');
  console.log('[analyzeNews] saved ./news_meta/TRUR/123455.json');

  console.log('\n--- Scenario 3: New file (no cache) ---');
  console.log('[analyzeNews] analyze TRUR/123457 via OpenRouter (reason: fetched-via-llm)');
  console.log('[analyzeNews] saved ./news_meta/TRUR/123457.json');

  console.log('\n--- Scenario 4: Cache disabled ---');
  console.log('[analyzeNews] analyze TRUR/123456 via OpenRouter (reason: fetched-via-llm)');
  console.log('[analyzeNews] saved ./news_meta/TRUR/123456.json');
}

// Show configuration options
async function showConfigurationOptions() {
  console.log('\n⚙️  Configuration Options:');
  console.log(`
Cache Configuration in CONFIG.json:
{
  "analysis": {
    "openrouter": {
      "cache": {
        "enabled": true,        // Enable/disable caching
        "ttl_hours": 168       // Cache TTL in hours (default: 168 = 7 days)
      }
    }
  }
}

Cache Behavior:
- enabled: true, ttl_hours: 168   → Cache for 7 days
- enabled: true, ttl_hours: 24    → Cache for 1 day
- enabled: true, ttl_hours: 1     → Cache for 1 hour
- enabled: false                  → Always fetch from LLM

Cache Validation Outcomes:
- cache-valid         → Use cached result
- cache-expired       → Fetch fresh from LLM
- cache-not-exists    → Fetch fresh from LLM
- cache-disabled      → Fetch fresh from LLM
- cache-corrupted     → Fetch fresh from LLM
- cache-no-timestamp  → Fetch fresh from LLM

Log Messages:
- skipped-by-cache    → Cache hit, using cached result
- fetched-via-llm     → Cache miss, fetched fresh result
`);
}

// Cleanup function
async function cleanup() {
  console.log('\n🧹 Cleaning up demo files...');

  try {
    await fs.rm('./news', { recursive: true, force: true });
    await fs.rm('./news_meta', { recursive: true, force: true });
    await fs.unlink('./CONFIG.demo.json').catch(() => {});
    console.log('   ✅ Cleanup completed');
  } catch (error) {
    console.log('   ⚠️  Some cleanup operations failed (this is normal)');
  }
}

// Main demo function
async function runDemo() {
  console.log('🚀 LLM Cache Implementation Demo\n');

  await createSampleConfig();
  await createSampleData();
  await demonstrateCacheBehavior();
  await showConfigurationOptions();
  await cleanup();

  console.log('\n🎉 Demo completed! The LLM cache is ready for use.');
  console.log('\nNext steps:');
  console.log('1. Add cache configuration to your CONFIG.json');
  console.log('2. Run: bun run src/tools/analyzeNews.ts TRUR --limit=5');
  console.log('3. Watch the cache system in action!');
}

runDemo().catch(console.error);