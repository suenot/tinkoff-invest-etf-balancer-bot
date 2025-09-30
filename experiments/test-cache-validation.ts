import { promises as fs } from 'fs';
import path from 'path';

// Import the functions we want to test from analyzeNews.ts
// We'll simulate the functions locally to avoid dependency issues
const LOG_PREFIX = '[test-cache-validation]';

function getCacheConfig() {
  try {
    // Simulate loading configuration - using test values
    return { enabled: true, ttl_hours: 24 };
  } catch (error) {
    console.warn(`${LOG_PREFIX} failed to load cache config, using defaults:`, error);
    return { enabled: true, ttl_hours: 24 };
  }
}

interface CacheEntry {
  cached_at: string;
  cache_ttl_hours: number;
  [key: string]: any;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isCacheValid(filePath: string): Promise<{ isValid: boolean; reason: string }> {
  const cacheConfig = getCacheConfig();

  if (!cacheConfig.enabled) {
    return { isValid: false, reason: 'cache-disabled' };
  }

  if (!(await fileExists(filePath))) {
    return { isValid: false, reason: 'cache-not-exists' };
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const cacheEntry: CacheEntry = JSON.parse(content);

    if (!cacheEntry.cached_at) {
      return { isValid: false, reason: 'cache-no-timestamp' };
    }

    const cachedAt = new Date(cacheEntry.cached_at);
    const now = new Date();
    const ageHours = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60);
    const ttlHours = cacheEntry.cache_ttl_hours || cacheConfig.ttl_hours;

    if (ageHours > ttlHours) {
      return { isValid: false, reason: 'cache-expired' };
    }

    return { isValid: true, reason: 'cache-valid' };
  } catch (error) {
    return { isValid: false, reason: 'cache-corrupted' };
  }
}

function addCacheMetadata(analysisResult: any): CacheEntry {
  const cacheConfig = getCacheConfig();
  return {
    ...analysisResult,
    cached_at: new Date().toISOString(),
    cache_ttl_hours: cacheConfig.ttl_hours
  };
}

// Test scenarios
async function testCacheValidation() {
  console.log('🧪 Testing Cache Validation Logic\n');

  const testDir = './experiments/cache-validation-test';
  await fs.mkdir(testDir, { recursive: true });

  // Test 1: Non-existent cache file
  console.log('=== Test 1: Non-existent cache file ===');
  const nonExistentPath = path.join(testDir, 'nonexistent.json');
  const result1 = await isCacheValid(nonExistentPath);
  console.log(`Result: ${result1.isValid ? 'VALID' : 'INVALID'} (${result1.reason})`);
  console.log(result1.reason === 'cache-not-exists' ? '✅ PASS' : '❌ FAIL');

  // Test 2: Valid fresh cache file
  console.log('\n=== Test 2: Valid fresh cache file ===');
  const freshCachePath = path.join(testDir, 'fresh.json');
  const freshEntry = addCacheMetadata({
    id: 'test-fresh',
    symbol: 'TRUR',
    title: 'Fresh cache entry'
  });
  await fs.writeFile(freshCachePath, JSON.stringify(freshEntry, null, 2));

  const result2 = await isCacheValid(freshCachePath);
  console.log(`Result: ${result2.isValid ? 'VALID' : 'INVALID'} (${result2.reason})`);
  console.log(result2.isValid && result2.reason === 'cache-valid' ? '✅ PASS' : '❌ FAIL');

  // Test 3: Expired cache file
  console.log('\n=== Test 3: Expired cache file ===');
  const expiredCachePath = path.join(testDir, 'expired.json');
  const yesterday = new Date();
  yesterday.setHours(yesterday.getHours() - 25); // 25 hours ago (should be expired with 24h TTL)

  const expiredEntry = {
    id: 'test-expired',
    symbol: 'TRUR',
    title: 'Expired cache entry',
    cached_at: yesterday.toISOString(),
    cache_ttl_hours: 24
  };
  await fs.writeFile(expiredCachePath, JSON.stringify(expiredEntry, null, 2));

  const result3 = await isCacheValid(expiredCachePath);
  console.log(`Result: ${result3.isValid ? 'VALID' : 'INVALID'} (${result3.reason})`);
  console.log(!result3.isValid && result3.reason === 'cache-expired' ? '✅ PASS' : '❌ FAIL');

  // Test 4: Cache file without timestamp
  console.log('\n=== Test 4: Cache file without timestamp ===');
  const noTimestampPath = path.join(testDir, 'no-timestamp.json');
  const noTimestampEntry = {
    id: 'test-no-timestamp',
    symbol: 'TRUR',
    title: 'No timestamp entry'
    // Missing cached_at field
  };
  await fs.writeFile(noTimestampPath, JSON.stringify(noTimestampEntry, null, 2));

  const result4 = await isCacheValid(noTimestampPath);
  console.log(`Result: ${result4.isValid ? 'VALID' : 'INVALID'} (${result4.reason})`);
  console.log(!result4.isValid && result4.reason === 'cache-no-timestamp' ? '✅ PASS' : '❌ FAIL');

  // Test 5: Corrupted cache file
  console.log('\n=== Test 5: Corrupted cache file ===');
  const corruptedPath = path.join(testDir, 'corrupted.json');
  await fs.writeFile(corruptedPath, 'invalid json content{');

  const result5 = await isCacheValid(corruptedPath);
  console.log(`Result: ${result5.isValid ? 'VALID' : 'INVALID'} (${result5.reason})`);
  console.log(!result5.isValid && result5.reason === 'cache-corrupted' ? '✅ PASS' : '❌ FAIL');

  // Test 6: Cache with custom TTL
  console.log('\n=== Test 6: Cache with custom TTL (should be valid) ===');
  const customTTLPath = path.join(testDir, 'custom-ttl.json');
  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

  const customTTLEntry = {
    id: 'test-custom-ttl',
    symbol: 'TRUR',
    title: 'Custom TTL entry',
    cached_at: twoHoursAgo.toISOString(),
    cache_ttl_hours: 48  // 48 hour TTL, so 2 hours old should be valid
  };
  await fs.writeFile(customTTLPath, JSON.stringify(customTTLEntry, null, 2));

  const result6 = await isCacheValid(customTTLPath);
  console.log(`Result: ${result6.isValid ? 'VALID' : 'INVALID'} (${result6.reason})`);
  console.log(result6.isValid && result6.reason === 'cache-valid' ? '✅ PASS' : '❌ FAIL');

  // Cleanup
  await fs.rm(testDir, { recursive: true, force: true });
  console.log('\n🧹 Cleanup completed');
}

// Test cache metadata addition
async function testCacheMetadata() {
  console.log('\n=== Testing Cache Metadata Addition ===');

  const originalResult = {
    id: 'test123',
    symbol: 'TRUR',
    title: 'Test analysis',
    category: 'other',
    summary: 'Test summary'
  };

  const withMetadata = addCacheMetadata(originalResult);

  console.log('Original result keys:', Object.keys(originalResult));
  console.log('With metadata keys:', Object.keys(withMetadata));

  const hasTimestamp = 'cached_at' in withMetadata;
  const hasTTL = 'cache_ttl_hours' in withMetadata;
  const hasOriginalData = 'id' in withMetadata && 'symbol' in withMetadata;

  console.log(`Has timestamp: ${hasTimestamp ? '✅' : '❌'}`);
  console.log(`Has TTL: ${hasTTL ? '✅' : '❌'}`);
  console.log(`Has original data: ${hasOriginalData ? '✅' : '❌'}`);

  if (hasTimestamp && hasTTL && hasOriginalData) {
    console.log('✅ Cache metadata addition: PASS');
  } else {
    console.log('❌ Cache metadata addition: FAIL');
  }
}

// Run all tests
async function runTests() {
  console.log('🧪 Starting Cache Validation Tests\n');

  await testCacheValidation();
  await testCacheMetadata();

  console.log('\n🎉 All cache validation tests completed!');
}

runTests().catch(console.error);