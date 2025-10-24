import {
  Claim,
  Policy,
  PolicyHolder,
  RiskPool,
  GlobalStats,
  DailyStats,
  PayoutModule,
} from "generated";

/**
 * Handler for ClaimExecuted event
 * Emitted when a claim is successfully paid out
 */
PayoutModule.ClaimExecuted.handler(async ({ event, context }) => {
  const { policyId, beneficiary, payout } = event.params;

  const policyIdStr = policyId.toString();
  const claimId = `${event.transaction.hash}-${event.logIndex}`;

  // Create Claim record
  await context.Claim.set({
    id: claimId,
    policyId,
    beneficiary,
    payout,
    status: "EXECUTED",
    executedAt: BigInt(event.block.timestamp),
    failureReason: null,
    txHash: event.transaction.hash,
  });

  // Update Policy status
  const policy = await context.Policy.get(policyIdStr);

  if (policy) {
    await context.Policy.set({
      ...policy,
      status: "CLAIMED",
      updatedAt: BigInt(event.block.timestamp),
    });

    // Decrement active policies if it was active
    if (policy.status === "ACTIVE") {
      // Update PolicyHolder
      const ownerStr = policy.owner.toLowerCase();
      const policyHolder = await context.PolicyHolder.get(ownerStr);

      if (policyHolder) {
        await context.PolicyHolder.set({
          ...policyHolder,
          activePolicies: Math.max(0, policyHolder.activePolicies - 1),
          totalPayoutsReceived: policyHolder.totalPayoutsReceived + payout,
        });
      }

      // Update RiskPool
      const riskPool = await context.RiskPool.get(policy.riskId);

      if (riskPool) {
        await context.RiskPool.set({
          ...riskPool,
          activePolicies: Math.max(0, riskPool.activePolicies - 1),
          totalPayouts: riskPool.totalPayouts + payout,
        });
      }
    }
  }

  // Update GlobalStats
  const globalStats = await context.GlobalStats.get("global");

  if (globalStats) {
    const activeDecrement = policy?.status === "ACTIVE" ? 1 : 0;

    await context.GlobalStats.set({
      ...globalStats,
      totalClaims: globalStats.totalClaims + 1,
      executedClaims: globalStats.executedClaims + 1,
      totalPayouts: globalStats.totalPayouts + payout,
      activePolicies: Math.max(0, globalStats.activePolicies - activeDecrement),
      lastUpdatedAt: BigInt(event.block.timestamp),
    });
  }

  // Update DailyStats
  const dateStr = new Date(Number(event.block.timestamp) * 1000)
    .toISOString()
    .split("T")[0];
  let dailyStats = await context.DailyStats.get(dateStr);

  if (!dailyStats) {
    await context.DailyStats.set({
      id: dateStr,
      date: dateStr,
      policiesMinted: 0,
      policiesActivated: 0,
      policiesExpired: 0,
      claimsExecuted: 1,
      premiumsCollected: 0n,
      payoutsDistributed: payout,
      reserveDeposits: 0n,
      reserveWithdrawals: 0n,
      timestamp: BigInt(event.block.timestamp),
    });
  } else {
    await context.DailyStats.set({
      ...dailyStats,
      claimsExecuted: dailyStats.claimsExecuted + 1,
      payoutsDistributed: dailyStats.payoutsDistributed + payout,
    });
  }
});

/**
 * Handler for ClaimFailed event
 * Emitted when a claim execution fails
 */
PayoutModule.ClaimFailed.handler(async ({ event, context }) => {
  const { policyId, reason } = event.params;

  const claimId = `${event.transaction.hash}-${event.logIndex}`;

  // Create failed Claim record
  await context.Claim.set({
    id: claimId,
    policyId,
    beneficiary: event.transaction.from, // Use tx sender as beneficiary
    payout: 0n,
    status: "FAILED",
    executedAt: null,
    failureReason: reason,
    txHash: event.transaction.hash,
  });

  // Update GlobalStats
  const globalStats = await context.GlobalStats.get("global");

  if (globalStats) {
    await context.GlobalStats.set({
      ...globalStats,
      totalClaims: globalStats.totalClaims + 1,
      lastUpdatedAt: BigInt(event.block.timestamp),
    });
  }
});
