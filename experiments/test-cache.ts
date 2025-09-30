import { promises as fs } from 'fs';
import path from 'path';
import { configLoader } from '../src/configLoader';

// Test the cache configuration loading and validation
async function testCacheConfig() {
  console.log('=== Testing Cache Configuration ===');

  try {
    const config = configLoader.loadConfig();
    console.log('✅ Configuration loaded successfully');

    if (config.analysis?.openrouter?.cache) {
      const cacheConfig = config.analysis.openrouter.cache;
      console.log(`✅ Cache config found: enabled=${cacheConfig.enabled}, ttl_hours=${cacheConfig.ttl_hours}`);

      if (typeof cacheConfig.enabled === 'boolean' && typeof cacheConfig.ttl_hours === 'number') {
        console.log('✅ Cache config types are valid');
      } else {
        console.log('❌ Cache config types are invalid');
      }
    } else {
      console.log('⚠️  Cache config not found, will use defaults');
    }
  } catch (error) {
    console.log('❌ Configuration loading failed:', error);
  }
}

// Test cache entry structure
async function testCacheEntry() {
  console.log('\n=== Testing Cache Entry Structure ===');

  const mockAnalysisResult = {
    id: "test123",
    symbol: "TRUR",
    title: "Test News",
    date: "2024-01-01",
    category: "other",
    summary: "Test summary",
    bullets: ["Point 1", "Point 2"],
    trades: [],
    additionalFields: {},
    numbers: {
      redeemedShares: null,
      redeemedAmountRub: null,
      totalShares: null,
      navPriceRub: null
    }
  };

  // Simulate adding cache metadata
  const cacheEntry = {
    ...mockAnalysisResult,
    cached_at: new Date().toISOString(),
    cache_ttl_hours: 24
  };

  console.log('✅ Mock cache entry created with metadata:');
  console.log(`   - cached_at: ${cacheEntry.cached_at}`);
  console.log(`   - cache_ttl_hours: ${cacheEntry.cache_ttl_hours}`);

  // Test if timestamp is valid
  const cachedAt = new Date(cacheEntry.cached_at);
  if (!isNaN(cachedAt.getTime())) {
    console.log('✅ Timestamp is valid');
  } else {
    console.log('❌ Timestamp is invalid');
  }
}

// Test TTL calculation
async function testTTLCalculation() {
  console.log('\n=== Testing TTL Calculation ===');

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - (1 * 60 * 60 * 1000));
  const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

  const ageOneHour = (now.getTime() - oneHourAgo.getTime()) / (1000 * 60 * 60);
  const ageOneDay = (now.getTime() - oneDayAgo.getTime()) / (1000 * 60 * 60);

  console.log(`✅ One hour ago - Age: ${ageOneHour.toFixed(2)} hours`);
  console.log(`✅ One day ago - Age: ${ageOneDay.toFixed(2)} hours`);

  // Test TTL validation
  const ttlHours = 24;
  console.log(`Cache TTL: ${ttlHours} hours`);
  console.log(`One hour old entry is ${ageOneHour > ttlHours ? 'EXPIRED' : 'VALID'}`);
  console.log(`One day old entry is ${ageOneDay > ttlHours ? 'EXPIRED' : 'VALID'}`);
}

// Test creating a mock cache file
async function testCacheFile() {
  console.log('\n=== Testing Cache File Operations ===');

  const testDir = './experiments/test-cache-data';
  const testFilePath = path.join(testDir, 'test123.json');

  try {
    // Ensure directory exists
    await fs.mkdir(testDir, { recursive: true });

    // Create a mock cache entry
    const cacheEntry = {
      id: "test123",
      symbol: "TRUR",
      title: "Test Cache Entry",
      date: "2024-01-01",
      category: "other",
      summary: "This is a test cache entry",
      bullets: ["Test point 1", "Test point 2"],
      trades: [],
      additionalFields: {},
      numbers: {
        redeemedShares: null,
        redeemedAmountRub: null,
        totalShares: null,
        navPriceRub: null
      },
      cached_at: new Date().toISOString(),
      cache_ttl_hours: 24
    };

    // Write cache file
    await fs.writeFile(testFilePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
    console.log(`✅ Cache file created: ${testFilePath}`);

    // Read and validate cache file
    const content = await fs.readFile(testFilePath, 'utf-8');
    const parsed = JSON.parse(content);

    if (parsed.cached_at && parsed.cache_ttl_hours) {
      console.log('✅ Cache file contains required metadata');
      console.log(`   - Cached at: ${parsed.cached_at}`);
      console.log(`   - TTL hours: ${parsed.cache_ttl_hours}`);
    } else {
      console.log('❌ Cache file missing required metadata');
    }

    // Test age calculation
    const cachedAt = new Date(parsed.cached_at);
    const now = new Date();
    const ageMinutes = (now.getTime() - cachedAt.getTime()) / (1000 * 60);
    console.log(`✅ Cache entry age: ${ageMinutes.toFixed(2)} minutes`);

    // Cleanup
    await fs.unlink(testFilePath).catch(() => {});
    await fs.rmdir(testDir).catch(() => {});
    console.log('✅ Cleanup completed');

  } catch (error) {
    console.log('❌ Cache file test failed:', error);
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 Starting LLM Cache Implementation Tests\n');

  await testCacheConfig();
  await testCacheEntry();
  await testTTLCalculation();
  await testCacheFile();

  console.log('\n🎉 All tests completed!');
}

runTests().catch(console.error);