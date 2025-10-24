import {
  Policy,
  PolicyHolder,
  RiskPool,
  GlobalStats,
  DailyStats,
  PolicyDistributor,
} from "generated";

/**
 * Handler for PolicyMinted event
 * Emitted when a new policy is purchased
 */
PolicyDistributor.PolicyMinted.handler(async ({ event, context }) => {
  const {
    policyId,
    owner,
    riskId,
    insuredAmount,
    coverageCap,
    startAt,
    endAt,
  } = event.params;

  const policyIdStr = policyId.toString();
  const ownerStr = owner.toLowerCase();
  const riskIdStr = riskId;

  // Create or update Policy
  const policy = await context.Policy.get(policyIdStr);

  await context.Policy.set({
    id: policyIdStr,
    policyId,
    owner,
    riskId,
    insuredAmount,
    coverageCap,
    deductibleBps: 200, // Default 2% - TODO: get from event if available
    startAt,
    activeAt: null,
    endAt,
    status: "MINTED",
    product: "DEPEG_LP", // TODO: detect from riskId or event
    premium: 0n, // TODO: calculate or get from event
    createdAt: BigInt(event.block.timestamp),
    updatedAt: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  // Update or create PolicyHolder
  let policyHolder = await context.PolicyHolder.get(ownerStr);

  if (!policyHolder) {
    await context.PolicyHolder.set({
      id: ownerStr,
      address: owner,
      totalPolicies: 1,
      activePolicies: 0,
      totalInsured: insuredAmount,
      totalPremiumPaid: 0n,
      totalPayoutsReceived: 0n,
      firstPolicyAt: BigInt(event.block.timestamp),
      lastPolicyAt: BigInt(event.block.timestamp),
    });
  } else {
    await context.PolicyHolder.set({
      ...policyHolder,
      totalPolicies: policyHolder.totalPolicies + 1,
      totalInsured: policyHolder.totalInsured + insuredAmount,
      lastPolicyAt: BigInt(event.block.timestamp),
    });
  }

  // Update or create RiskPool
  const riskPoolId = riskId;
  let riskPool = await context.RiskPool.get(riskPoolId);

  if (!riskPool) {
    await context.RiskPool.set({
      id: riskPoolId,
      riskId,
      name: `Pool ${riskId.slice(0, 10)}...`, // TODO: get real name
      product: "DEPEG_LP",
      chainId: event.chainId,
      totalPolicies: 1,
      activePolicies: 0,
      totalInsured: insuredAmount,
      totalPremiums: 0n,
      totalPayouts: 0n,
    });
  } else {
    await context.RiskPool.set({
      ...riskPool,
      totalPolicies: riskPool.totalPolicies + 1,
      totalInsured: riskPool.totalInsured + insuredAmount,
    });
  }

  // Update GlobalStats
  let globalStats = await context.GlobalStats.get("global");

  if (!globalStats) {
    await context.GlobalStats.set({
      id: "global",
      totalPolicies: 1,
      activePolicies: 0,
      totalClaims: 0,
      executedClaims: 0,
      totalPremiums: 0n,
      totalPayouts: 0n,
      totalInsured: insuredAmount,
      totalReserveDeposits: 0n,
      totalReserveWithdrawals: 0n,
      uniquePolicyHolders: 1,
      uniqueRiskPools: 1,
      lastUpdatedAt: BigInt(event.block.timestamp),
    });
  } else {
    const isNewHolder = !policyHolder;
    const isNewPool = !riskPool;

    await context.GlobalStats.set({
      ...globalStats,
      totalPolicies: globalStats.totalPolicies + 1,
      totalInsured: globalStats.totalInsured + insuredAmount,
      uniquePolicyHolders:
        globalStats.uniquePolicyHolders + (isNewHolder ? 1 : 0),
      uniqueRiskPools: globalStats.uniqueRiskPools + (isNewPool ? 1 : 0),
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
      policiesMinted: 1,
      policiesActivated: 0,
      policiesExpired: 0,
      claimsExecuted: 0,
      premiumsCollected: 0n,
      payoutsDistributed: 0n,
      reserveDeposits: 0n,
      reserveWithdrawals: 0n,
      timestamp: BigInt(event.block.timestamp),
    });
  } else {
    await context.DailyStats.set({
      ...dailyStats,
      policiesMinted: dailyStats.policiesMinted + 1,
    });
  }
});

/**
 * Handler for PolicyActivated event
 * Emitted when a policy becomes active (after grace period)
 */
PolicyDistributor.PolicyActivated.handler(async ({ event, context }) => {
  const { policyId } = event.params;
  const policyIdStr = policyId.toString();

  const policy = await context.Policy.get(policyIdStr);

  if (policy) {
    await context.Policy.set({
      ...policy,
      status: "ACTIVE",
      activeAt: BigInt(event.block.timestamp),
      updatedAt: BigInt(event.block.timestamp),
    });

    // Update PolicyHolder active count
    const ownerStr = policy.owner.toLowerCase();
    const policyHolder = await context.PolicyHolder.get(ownerStr);

    if (policyHolder) {
      await context.PolicyHolder.set({
        ...policyHolder,
        activePolicies: policyHolder.activePolicies + 1,
      });
    }

    // Update RiskPool active count
    const riskPool = await context.RiskPool.get(policy.riskId);

    if (riskPool) {
      await context.RiskPool.set({
        ...riskPool,
        activePolicies: riskPool.activePolicies + 1,
      });
    }

    // Update GlobalStats
    const globalStats = await context.GlobalStats.get("global");

    if (globalStats) {
      await context.GlobalStats.set({
        ...globalStats,
        activePolicies: globalStats.activePolicies + 1,
        lastUpdatedAt: BigInt(event.block.timestamp),
      });
    }

    // Update DailyStats
    const dateStr = new Date(Number(event.block.timestamp) * 1000)
      .toISOString()
      .split("T")[0];
    const dailyStats = await context.DailyStats.get(dateStr);

    if (dailyStats) {
      await context.DailyStats.set({
        ...dailyStats,
        policiesActivated: dailyStats.policiesActivated + 1,
      });
    }
  }
});

/**
 * Handler for PolicyExpired event
 * Emitted when a policy reaches its end date
 */
PolicyDistributor.PolicyExpired.handler(async ({ event, context }) => {
  const { policyId } = event.params;
  const policyIdStr = policyId.toString();

  const policy = await context.Policy.get(policyIdStr);

  if (policy) {
    await context.Policy.set({
      ...policy,
      status: "EXPIRED",
      updatedAt: BigInt(event.block.timestamp),
    });

    // Update PolicyHolder active count if policy was active
    if (policy.status === "ACTIVE") {
      const ownerStr = policy.owner.toLowerCase();
      const policyHolder = await context.PolicyHolder.get(ownerStr);

      if (policyHolder) {
        await context.PolicyHolder.set({
          ...policyHolder,
          activePolicies: Math.max(0, policyHolder.activePolicies - 1),
        });
      }

      // Update RiskPool active count
      const riskPool = await context.RiskPool.get(policy.riskId);

      if (riskPool) {
        await context.RiskPool.set({
          ...riskPool,
          activePolicies: Math.max(0, riskPool.activePolicies - 1),
        });
      }

      // Update GlobalStats
      const globalStats = await context.GlobalStats.get("global");

      if (globalStats) {
        await context.GlobalStats.set({
          ...globalStats,
          activePolicies: Math.max(0, globalStats.activePolicies - 1),
          lastUpdatedAt: BigInt(event.block.timestamp),
        });
      }
    }

    // Update DailyStats
    const dateStr = new Date(Number(event.block.timestamp) * 1000)
      .toISOString()
      .split("T")[0];
    const dailyStats = await context.DailyStats.get(dateStr);

    if (dailyStats) {
      await context.DailyStats.set({
        ...dailyStats,
        policiesExpired: dailyStats.policiesExpired + 1,
      });
    }
  }
});
