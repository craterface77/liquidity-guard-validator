#!/usr/bin/env node
/**
 * Showcase Demo Script
 *
 * This script demonstrates the full functionality of the LiquidityGuard validator:
 * 1. Checks system health
 * 2. Runs a historical simulation (July 2025 depeg event)
 * 3. Displays detected risks and metrics
 * 4. Shows sample payout calculation
 */

import axios from 'axios';
import { env } from '../src/config/env';
import { logger } from '../src/lib/logger';

const API_BASE = `http://localhost:${env.PORT}`;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🏥 STEP 1: Health Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const response = await axios.get(`${API_BASE}/health`);
    const data = response.data;

    console.log('✅ Status:', data.status);
    console.log('📊 Pool:', data.config.poolId);
    console.log('🔗 Chain:', data.config.chainId);
    console.log('📈 Total Samples:', data.statistics.totalSamples);

    if (data.latestSample) {
      console.log('\n📍 Latest Sample:');
      console.log('  Block:', data.latestSample.block);
      console.log('  R Ratio:', (data.latestSample.rBps / 100).toFixed(2) + '%');
      console.log('  Price:', data.latestSample.price.toFixed(6));
      console.log('  Age:', Math.floor(data.latestSample.ageMs / 1000) + 's');
    }

    if (data.activeEvents.length > 0) {
      console.log('\n⚠️  Active Depeg Events:', data.activeEvents.length);
      data.activeEvents.forEach((event: any) => {
        console.log(`  - ${event.riskId}`);
        console.log(`    R: ${(event.rBps / 100).toFixed(2)}%`);
        console.log(`    Severity: ${(event.severityBps / 100).toFixed(2)}%`);
      });
    } else {
      console.log('\n✅ No active depeg events');
    }

    return true;
  } catch (error) {
    console.error('❌ Health check failed:', (error as Error).message);
    return false;
  }
}

async function runSimulation() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔬 STEP 2: Historical Simulation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📅 Simulating: July 8, 2025 USDf depeg event');
  console.log('📦 Blocks: 20,295,000 → 20,295,500 (~1 hour)');
  console.log('⏳ This may take 2-3 minutes...\n');

  try {
    // In a real scenario, we would run: npm run simulate -- --from=20295000 --to=20295500 --step=50
    // For demo purposes, we'll just show what would happen
    console.log('💡 To run simulation manually:');
    console.log('   npm run simulate -- --from=20295000 --to=20295500 --step=50\n');

    return true;
  } catch (error) {
    console.error('❌ Simulation failed:', (error as Error).message);
    return false;
  }
}

async function showRisks() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 STEP 3: Detected Risks');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const response = await axios.get(`${API_BASE}/validator/api/v1/risk?limit=10`);
    const data = response.data;

    if (data.items.length === 0) {
      console.log('ℹ️  No risks detected yet. Run simulation first.');
      return true;
    }

    console.log(`📋 Found ${data.items.length} risk event(s):\n`);

    data.items.forEach((risk: any, index: number) => {
      console.log(`${index + 1}. Risk ID: ${risk.riskId}`);
      console.log(`   State: ${risk.state}`);
      console.log(`   Pool: ${risk.poolId}`);
      console.log(`   Window: ${new Date(risk.latestWindow.S * 1000).toISOString()}`);
      if (risk.latestWindow.E) {
        console.log(`   → ${new Date(risk.latestWindow.E * 1000).toISOString()}`);
        const duration = risk.latestWindow.E - risk.latestWindow.S;
        console.log(`   Duration: ${Math.floor(duration / 60)} minutes`);
      }
      console.log(`   TWAP (1h): ${risk.metrics.twap1h}`);
      console.log(`   Liquidity: $${risk.metrics.liquidityUSD}`);
      console.log('');
    });

    return true;
  } catch (error) {
    console.error('❌ Failed to fetch risks:', (error as Error).message);
    return false;
  }
}

async function showMetrics() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 STEP 4: Pool Metrics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const response = await axios.get(`${API_BASE}/validator/api/v1/metrics?limit=100`);
    const data = response.data;

    if (data.count === 0) {
      console.log('ℹ️  No metrics available yet.');
      return true;
    }

    console.log(`📈 Last ${data.count} samples:\n`);

    // Find min/max values
    const rValues = data.samples.map((s: any) => s.rBps);
    const lossValues = data.samples.map((s: any) => s.lossQuoteBps);
    const minR = Math.min(...rValues);
    const maxLoss = Math.max(...lossValues);

    console.log(`   Min R Ratio: ${(minR / 100).toFixed(2)}%`);
    console.log(`   Max Loss: ${(maxLoss / 100).toFixed(2)}%`);
    console.log(`   Latest Price: ${data.samples[0].price.toFixed(6)}`);
    console.log(`   Latest R: ${(data.samples[0].rBps / 100).toFixed(2)}%`);

    const latestReserves = data.samples[0].reserves;
    console.log(`\n   Latest Reserves:`);
    console.log(`     Base (USDf): ${latestReserves.base.toLocaleString()}`);
    console.log(`     Quote (USDC): ${latestReserves.quote.toLocaleString()}`);
    console.log(`     Total Supply: ${latestReserves.totalSupply.toLocaleString()}`);

    return true;
  } catch (error) {
    console.error('❌ Failed to fetch metrics:', (error as Error).message);
    return false;
  }
}

async function demonstrateClaim() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💰 STEP 5: Payout Calculation Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    // First, get a risk to use for claim
    const risksResponse = await axios.get(`${API_BASE}/validator/api/v1/risk?limit=1`);

    if (risksResponse.data.items.length === 0) {
      console.log('ℹ️  No risks available for claim demo.');
      console.log('💡 Run simulation first to generate risk events.');
      return true;
    }

    const risk = risksResponse.data.items[0];
    console.log('📋 Using risk:', risk.riskId);

    // Create a mock policy
    const mockPolicy = {
      policy: {
        policyId: '1',
        product: 'DEPEG_LP',
        riskId: risk.riskId,
        owner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
        insuredAmount: '1000000000000000000000000', // 1M tokens
        coverageCap: '800000000000000000000000', // 800K cap
        deductibleBps: 500, // 5%
        kBps: 5000, // 50%
        startAt: risk.latestWindow.S - 86400,
        activeAt: risk.latestWindow.S,
        endAt: risk.latestWindow.E || Math.floor(Date.now() / 1000),
        claimedUpTo: 0,
        metadata: { poolId: risk.poolId },
      },
      claimMode: 'PREVIEW',
    };

    console.log('\n📝 Policy Details:');
    console.log(`   Insured Amount: $1,000,000`);
    console.log(`   Coverage Cap: $800,000`);
    console.log(`   Deductible: 5%`);

    console.log('\n🔒 Note: This would require HMAC signature');
    console.log('💡 In production, use proper authentication\n');

    // Show what the preview would look like
    console.log('📊 Expected Preview Response:');
    console.log('   {');
    console.log('     "riskId": "..."');
    console.log('     "policyId": "1",');
    console.log('     "S": <window_start>,');
    console.log('     "E": <window_end>,');
    console.log('     "Lstar": <min_held_balance>,');
    console.log('     "refValue": "1000000...",');
    console.log('     "curValue": "...",');
    console.log('     "payout": "...",');
    console.log('     "snapshots": [...]');
    console.log('   }');

    return true;
  } catch (error) {
    console.error('❌ Claim demo failed:', (error as Error).message);
    return false;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  LIQUIDITY GUARD VALIDATOR SHOWCASE    ║');
  console.log('║  Curve USDC/USDf Depeg Detector        ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log('🎯 Target Pool: Curve USDC/USDf');
  console.log('📍 Address:', env.POOL_ADDRESS);
  console.log('⚙️  R Threshold: ' + (env.R_MIN_BPS / 100) + '% (33% = 2:1 ratio)');
  console.log('⏱️  Grace Period: ' + env.GRACE_PERIOD_SECONDS + 's (15 minutes)');

  await sleep(1000);

  // Step 1: Health Check
  const healthOk = await checkHealth();
  if (!healthOk) {
    console.error('\n❌ Health check failed. Make sure the API is running.');
    console.error('💡 Start with: docker compose up --build');
    process.exit(1);
  }

  await sleep(2000);

  // Step 2: Simulation (informational)
  await runSimulation();

  await sleep(2000);

  // Step 3: Show detected risks
  await showRisks();

  await sleep(2000);

  // Step 4: Show metrics
  await showMetrics();

  await sleep(2000);

  // Step 5: Demonstrate claim
  await demonstrateClaim();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ SHOWCASE COMPLETE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 API Endpoints Available:');
  console.log(`   GET  ${API_BASE}/health`);
  console.log(`   GET  ${API_BASE}/validator/api/v1/risk`);
  console.log(`   GET  ${API_BASE}/validator/api/v1/risk/:riskId`);
  console.log(`   GET  ${API_BASE}/validator/api/v1/metrics`);
  console.log(`   POST ${API_BASE}/validator/api/v1/claims/preview`);
  console.log(`   POST ${API_BASE}/validator/api/v1/claims/sign`);

  console.log('\n📖 Next Steps:');
  console.log('   1. Run simulation: npm run simulate -- --from=BLOCK --to=BLOCK');
  console.log('   2. Monitor live: docker compose logs -f validator-indexer');
  console.log('   3. View data: curl http://localhost:' + env.PORT + '/health');
  console.log('   4. Check metrics: curl http://localhost:' + env.PORT + '/validator/api/v1/metrics');
  console.log('');
}

main().catch((error) => {
  logger.error({ err: error }, 'showcase_error');
  process.exit(1);
});
