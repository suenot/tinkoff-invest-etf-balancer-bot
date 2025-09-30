#!/usr/bin/env bun

/**
 * Demonstration script for the Hybrid News Analysis system
 *
 * This script shows how to use the hybrid analysis system with both
 * rule-based and LLM-based processing.
 */

import {
  HybridNewsAnalysis,
  createNewsContent,
  ProcessingMethod,
  NewsCategory
} from '../src/tools/hybridNewsAnalysis';

// Sample news content for testing
const sampleNews = [
  {
    id: 'div-001',
    symbol: 'TRUR',
    title: 'Дивидендные выплаты по фонду TRUR',
    content: `
Уважаемые инвесторы!

Фонд TRUR объявляет о выплате дивидендов за четвертый квартал 2023 года.

Размер дивиденда: 12.50 рублей на акцию
Дата выплаты: 20 декабря 2023 года
Доходность: 4.2% годовых

Дивиденды будут зачислены автоматически на счета держателей акций.
    `,
    date: '2023-12-01',
    source: 'tbank'
  },
  {
    id: 'reb-001',
    symbol: 'TRUR',
    title: 'Ребалансировка портфеля фонда TRUR',
    content: `
Проведена плановая ребалансировка портфеля фонда TRUR:

Операции купли-продажи:
SBER Сбербанк | Buy | 1500 | 375000 ₽
GAZP Газпром | Sell | 800 | 240000 ₽
LKOH Лукойл | Buy | 300 | 180000 ₽

Общий объем торгов: 795,000 рублей
Портфель приведен в соответствие с целевой структурой.
    `,
    date: '2023-12-02',
    source: 'tbank'
  },
  {
    id: 'red-001',
    symbol: 'TRUR',
    title: 'Погашение акций фонда',
    content: `
Проведено погашение акций фонда TRUR:

Дата погашения: 15 декабря 2023
Погашено акций: 2,500 штук
Сумма погашения: 125,000 рублей
Цена погашения: 50.00 рублей за акцию
Всего акций в обращении: 97,500 штук

Средства зачислены на счета инвесторов.
    `,
    date: '2023-12-03',
    source: 'tbank'
  },
  {
    id: 'complex-001',
    symbol: 'TRUR',
    title: 'Сложная финансовая новость',
    content: `
В связи с изменениями в макроэкономической ситуации и корректировкой инвестиционной стратегии,
руководство фонда принимает решение о пересмотре подходов к управлению активами с учетом
новых геополитических рисков и возможностей на развивающихся рынках.

Данное решение может повлечь за собой корректировку портфеля в следующем квартале.
    `,
    date: '2023-12-04',
    source: 'tbank'
  }
];

async function runDemo() {
  console.log('🚀 Starting Hybrid News Analysis Demo\n');

  // Create hybrid analysis instance with demo configuration
  const hybridAnalysis = new HybridNewsAnalysis({
    enabled: true,
    llmFallback: {
      enabled: false, // Disable LLM for demo (to avoid API calls)
      confidenceThreshold: 0.7,
      maxRetries: 2,
      timeoutMs: 30000
    },
    rules: {
      enabled: true,
      confidenceThreshold: 0.6,
      strictMode: false
    },
    monitoring: {
      enabled: true,
      logLevel: 'info'
    }
  });

  console.log('📊 Current Configuration:');
  console.log(JSON.stringify(hybridAnalysis.getConfig(), null, 2));
  console.log('\n' + '='.repeat(60) + '\n');

  // Process each news article
  for (const news of sampleNews) {
    console.log(`📰 Processing: ${news.title}`);
    console.log(`   ID: ${news.id} | Symbol: ${news.symbol}`);

    try {
      const newsContent = createNewsContent(
        news.id,
        news.symbol,
        news.title,
        news.content,
        news.date,
        news.source
      );

      // Analyze with rule-based approach
      const result = await hybridAnalysis.analyzeNews(newsContent, {
        enableLLM: false, // Force rules-only for demo
        confidenceThreshold: 0.6,
        validateResults: true,
        includeMetrics: true
      });

      console.log(`   ✅ Processed successfully!`);
      console.log(`   📊 Method: ${result.processingMethod}`);
      console.log(`   📂 Category: ${result.category}`);
      console.log(`   🎯 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`   ⏱️  Time: ${result.processingTimeMs}ms`);
      console.log(`   🔄 Fallback Used: ${result.fallbackUsed ? 'Yes' : 'No'}`);

      if (result.extractedData.trades.length > 0) {
        console.log(`   💰 Trades Found: ${result.extractedData.trades.length}`);
        result.extractedData.trades.forEach((trade, i) => {
          console.log(`      ${i + 1}. ${trade.side} ${trade.ticker} - ${trade.qty} for ${trade.amount}`);
        });
      }

      if (Object.keys(result.extractedData.numbers).length > 0) {
        console.log(`   🔢 Numbers Extracted:`);
        Object.entries(result.extractedData.numbers).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            console.log(`      ${key}: ${value}`);
          }
        });
      }

      console.log(`   📝 Summary: ${result.extractedData.summary.substring(0, 100)}...`);

    } catch (error) {
      console.log(`   ❌ Processing failed: ${error}`);
    }

    console.log('\n' + '-'.repeat(40) + '\n');
  }

  // Demonstrate forced LLM processing (with mock)
  console.log('🤖 Demonstrating LLM Processing Methods:\n');

  const complexNews = createNewsContent(
    sampleNews[3].id,
    sampleNews[3].symbol,
    sampleNews[3].title,
    sampleNews[3].content,
    sampleNews[3].date,
    sampleNews[3].source
  );

  try {
    // This would normally call LLM, but will fail gracefully in demo
    console.log('📝 Attempting LLM_FORCED method (will fail gracefully in demo)...');
    const llmResult = await hybridAnalysis.analyzeWithMethod(
      complexNews,
      ProcessingMethod.LLM_FORCED,
      { enableLLM: true }
    );
    console.log('✅ LLM processing successful (unexpected in demo)');
  } catch (error) {
    console.log('❌ LLM processing failed as expected (no API key in demo)');
  }

  // Show performance statistics
  console.log('\n' + '='.repeat(60));
  console.log('📈 PERFORMANCE STATISTICS');
  console.log('='.repeat(60));

  hybridAnalysis.printPerformanceReport();

  const stats = hybridAnalysis.getPerformanceStats();
  console.log('\n💡 Optimization Recommendations:');

  if (stats.ruleBasedSuccessRate > 0.8) {
    console.log('✅ Excellent rule-based processing rate!');
  } else if (stats.ruleBasedSuccessRate > 0.6) {
    console.log('⚠️  Consider improving rule patterns for better coverage');
  } else {
    console.log('❌ Low rule success rate - rules need significant improvement');
  }

  if (stats.averageProcessingTime < 100) {
    console.log('✅ Fast processing times!');
  } else {
    console.log('⚠️  Processing times could be optimized');
  }

  // Health check
  const health = hybridAnalysis.getHealthStatus();
  console.log(`\n🏥 System Health: ${health.status}`);
  console.log(`📋 Status: ${health.message}`);

  if (health.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    health.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`);
    });
  }

  // Export metrics
  console.log('\n📤 Exporting metrics...');
  const jsonMetrics = hybridAnalysis.exportMetrics('json');
  console.log(`📊 Exported ${JSON.parse(jsonMetrics).length} metric records`);

  console.log('\n🎉 Demo completed successfully!');
  console.log('\nTo use hybrid analysis in your code:');
  console.log(`
import { HybridNewsAnalysis, createNewsContent } from './src/tools/hybridNewsAnalysis';

const analysis = new HybridNewsAnalysis();
const news = createNewsContent('id', 'SYMBOL', 'Title', 'Content...', '2023-12-01');
const result = await analysis.analyzeNews(news);
console.log(result);
  `);
}

if (import.meta.main) {
  runDemo().catch(console.error);
}