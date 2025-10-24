import {
  ReserveDeposit,
  ReserveWithdrawal,
  RedemptionQueue,
  GlobalStats,
  DailyStats,
  ReservePool,
} from "generated";

/**
 * Handler for Deposited event
 * Emitted when a user deposits USDC to receive lgUSD shares
 */
ReservePool.Deposited.handler(async ({ event, context }) => {
  const { user, amount, shares } = event.params;

  const depositId = `${event.transaction.hash}-${event.logIndex}`;

  // Create ReserveDeposit record
  await context.ReserveDeposit.set({
    id: depositId,
    user,
    amount,
    shares,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  // Update GlobalStats
  const globalStats = await context.GlobalStats.get("global");

  if (globalStats) {
    await context.GlobalStats.set({
      ...globalStats,
      totalReserveDeposits: globalStats.totalReserveDeposits + amount,
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
      claimsExecuted: 0,
      premiumsCollected: 0n,
      payoutsDistributed: 0n,
      reserveDeposits: amount,
      reserveWithdrawals: 0n,
      timestamp: BigInt(event.block.timestamp),
    });
  } else {
    await context.DailyStats.set({
      ...dailyStats,
      reserveDeposits: dailyStats.reserveDeposits + amount,
    });
  }
});

/**
 * Handler for Withdrawn event
 * Emitted when a user withdraws USDC by burning lgUSD shares
 */
ReservePool.Withdrawn.handler(async ({ event, context }) => {
  const { user, amount, shares } = event.params;

  const withdrawalId = `${event.transaction.hash}-${event.logIndex}`;

  // Create ReserveWithdrawal record
  await context.ReserveWithdrawal.set({
    id: withdrawalId,
    user,
    amount,
    shares,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });

  // Update GlobalStats
  const globalStats = await context.GlobalStats.get("global");

  if (globalStats) {
    await context.GlobalStats.set({
      ...globalStats,
      totalReserveWithdrawals: globalStats.totalReserveWithdrawals + amount,
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
      claimsExecuted: 0,
      premiumsCollected: 0n,
      payoutsDistributed: 0n,
      reserveDeposits: 0n,
      reserveWithdrawals: amount,
      timestamp: BigInt(event.block.timestamp),
    });
  } else {
    await context.DailyStats.set({
      ...dailyStats,
      reserveWithdrawals: dailyStats.reserveWithdrawals + amount,
    });
  }
});

/**
 * Handler for RedemptionQueued event
 * Emitted when a user queues lgUSD shares for redemption
 */
ReservePool.RedemptionQueued.handler(async ({ event, context }) => {
  const { user, shares, timestamp } = event.params;

  const queueId = `${user.toLowerCase()}-${timestamp.toString()}`;

  // Create or update RedemptionQueue record
  await context.RedemptionQueue.set({
    id: queueId,
    user,
    shares,
    queuedAt: timestamp,
    status: "QUEUED",
    processedAt: null,
    txHash: event.transaction.hash,
  });
});
