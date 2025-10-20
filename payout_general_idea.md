### Trigger / attachment point (start of payout)

- **Depeg / price deviation event**: trigger when price deviation > **5%** (or configurable, e.g. 3–10%) from reference, sustained for more than **15 minutes**.
- **Liquidity / TVL drop**: trigger when instantaneous drop > **10%** within a short window (for example, drop >10% over an hour) or > 20% over 24 h.
- **Oracle divergence event**: trigger when the primary oracle differs by > **5%** from median of backup oracles for >10 minutes.

### Deductible / floor

- The payout should only cover the **excess loss beyond the threshold**. E.g., if depeg >5% triggers, losses from 5% to 15% are covered (i.e. 10% net) depending on cover level.
- We could also introduce a **minimum absolute dollar deductible** (e.g. first 0.5% of exposure or $X, whichever is higher) to avoid payouts on very small losses.

### Cap / maximum payout / limit

- We may cap payout at e.g. **20% of exposure** (or other cap) to limit the worst-case liability.
- Alternatively, we pay up to the **insured limit** that the user or protocol originally selected.

### Payout timing / settlement

- Using **parametric settlement** (i.e. auto-trigger payments immediately based on oracles) rather than waiting for claims adjudication. This lowers complexity and speeds refunds.
- Optionally including a **grace delay** (e.g. 1–6 hours) to filter out transient blips or oracle glitches.

### Example of payout logic (for medium-risk cover)

1. A user has exposure in Pool A of $1,000,000 under a “Medium risk” cover.
2. Their cover includes depeg protection with attachment at 5%, cap at 20%, and a 0.5% deductible.
3. During an event, the token price deviates and the pool suffers a 12% drop (measured by reference oracle).
4. The “net loss beyond threshold” = 12% – 5% attachment = 7%.
5. Deductible portion: 0.5% of exposure = 0.5% (so only 6.5% is eligible).
6. Payout = 6.5% × exposure = **$65,000** (as long as it is ≤ cap, which in this case it is since cap is 20%).
7. Settlement occurs automatically 1 hour after the deviation event is confirmed, paying $65,000 to the user.
   That logic ensures trivial or minor fluctuations (under 5%) don’t trigger payout, but major deviation events beyond that are compensated proportionally.

## When _not_ to payout and edge cases

- If deviation or TVL drop reverts quickly (e.g. price dips 3% then returns), avoid triggering unless sustained. Using a **minimum duration** filter to avoid “noise” claims.
- If the “loss” is due to the user’s own choice or arbitrage (e.g. they opted into risky leverage), excluding those.
- If the event is due to **force majeure** (e.g. front-running attack, massive chain outage, network-level meltdown), defining clear exclusions or partial coverage (we may exclude “protocol hacks / exploits” vs depeg events).
- If multiple triggers in a short time window, considering **aggregation periods** (so we don’t pay twice for the same root event).

## Calibrating the payout threshold & loss ratio

1. **Historical event analysis** — backtest on real data: find past depeg / liquidity collapse events in target pools, measure magnitude and duration.
2. **Loss frequency curve** — estimate distribution of losses: e.g. how many events >3%, >5%, >10% per year.
3. **Loss vs capital stress simulation** — simulate our capital reserve under different attachment / deductible / cap schemes and pick thresholds that keep probability of ruin low (e.g. <0.1% per year).
4. **Customer acceptability** — survey or pilot with protocols / users to see what threshold feels “fair” (they want triggers not too high, but we can’t promise payouts for tiny blips).

A rule-of-thumb: set attachment/deductible levels so **expected payouts** are maybe **10–20%** of our collected premiums — i.e. we want our claims load manageable.
