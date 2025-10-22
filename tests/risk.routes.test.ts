import request from 'supertest';
import { buildApp } from '../src/app';
import { clickhouseQuery } from '../src/db/clickhouse';

jest.mock('../src/db/clickhouse');

const mockedQuery = clickhouseQuery as jest.MockedFunction<typeof clickhouseQuery>;

describe('Risk routes', () => {
  afterEach(() => {
    mockedQuery.mockReset();
  });

  test('GET /validator/api/v1/risk returns list', async () => {
    mockedQuery.mockImplementationOnce(async () => [
      {
        risk_id: 'risk-1',
        pool_id: 'curve:demo',
        chain_id: 1,
        risk_type: 'DEPEG_LP',
        risk_state: 'OPEN',
        window_start: '2024-01-01 00:00:00',
        window_end: null,
        severity_bps: 120,
        twap_bps: 9900,
        r_bps: 4800,
        attested_at: '2024-01-01 00:10:00',
        updated_at: '2024-01-01 00:10:00',
        version: 1,
      },
    ]);

    mockedQuery.mockImplementationOnce(async () => [
      {
        twap1h: 9900,
        twap4h: 9890,
        liquidity_usd: 5_000_000,
        samples: 30,
      },
    ]);

    const app = await buildApp();
    const response = await request(app.server).get('/validator/api/v1/risk');
    await app.close();

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      riskId: 'risk-1',
      product: 'DEPEG_LP',
      poolId: 'curve:demo',
      state: 'OPEN',
    });
  });

  test('GET /validator/api/v1/risk/:riskId returns detail', async () => {
    mockedQuery
      .mockImplementationOnce(async () => [
        {
          risk_id: 'risk-1',
          pool_id: 'curve:demo',
          chain_id: 1,
          risk_type: 'DEPEG_LP',
          risk_state: 'RESOLVED',
          window_start: '2024-01-01 00:00:00',
          window_end: '2024-01-01 01:00:00',
          severity_bps: 150,
          twap_bps: 9900,
          r_bps: 4700,
          attested_at: '2024-01-01 01:05:00',
          updated_at: '2024-01-01 01:05:00',
          version: 2,
        },
      ])
      .mockImplementationOnce(async () => [
        {
          min_r_bps: 4700,
          max_loss_bps: 180,
          avg_twap_bps: 9850,
          samples: 120,
        },
      ])
      .mockImplementationOnce(async () => [
        {
          ts: '2024-01-01 00:05:00',
          block_number: 123,
          r_bps: 4800,
          loss_quote_bps: 120,
          twap_bps: 9900,
        },
      ])
      .mockImplementationOnce(async () => [
        {
          snapshot_id: 'snap-1',
          cid: 'bafy',
          label: 'pool_snapshot',
          note: null,
          uploaded_at: '2024-01-01 00:10:00',
        },
      ])
      .mockImplementationOnce(async () => [
        {
          attestation_id: 'att-1',
          signer: '0xAttestor',
          signature: '0x1234',
          payload: '{}',
          submitted_at: '2024-01-01 00:20:00',
          onchain_tx: null,
        },
      ]);

    const app = await buildApp();
    const response = await request(app.server).get('/validator/api/v1/risk/risk-1');
    await app.close();

    expect(response.status).toBe(200);
    expect(response.body.riskId).toBe('risk-1');
    expect(response.body.telemetry).toHaveLength(1);
  });
});
