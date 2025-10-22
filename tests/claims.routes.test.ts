import request from 'supertest';
import crypto from 'crypto';
import { buildApp } from '../src/app';
import { clickhouseInsert, clickhouseQuery } from '../src/db/clickhouse';

jest.mock('../src/db/clickhouse');

const mockedQuery = clickhouseQuery as jest.MockedFunction<typeof clickhouseQuery>;
const mockedInsert = clickhouseInsert as jest.MockedFunction<typeof clickhouseInsert>;

const SECRET = 'test-secret';
process.env.VALIDATOR_API_SECRET = SECRET;

function signBody(body: unknown, timestamp: string) {
  const payload = `${timestamp}.${JSON.stringify(body ?? {})}`;
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

describe('Claims routes', () => {
afterEach(() => {
  mockedQuery.mockReset();
  mockedInsert.mockReset();
});

beforeEach(() => {
  mockedInsert.mockResolvedValue(undefined as any);
});

  const basePolicy = {
    policyId: '1',
    product: 'DEPEG_LP' as const,
    riskId: 'risk-1',
    owner: '0xOwner',
    insuredAmount: '1000000000',
    coverageCap: '800000000',
    deductibleBps: 25,
    kBps: 5000,
    startAt: 1700000000,
    activeAt: 1700000000,
    endAt: 1700100000,
    claimedUpTo: 0,
  };

  test('POST /claims/preview returns payout summary', async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          risk_id: 'risk-1',
          pool_id: 'curve:demo',
          chain_id: 1,
          risk_type: 'DEPEG_LP',
          risk_state: 'RESOLVED',
          window_start: '2024-01-01 00:00:00',
          window_end: '2024-01-01 01:00:00',
          severity_bps: 120,
          twap_bps: 9900,
          r_bps: 4700,
          attested_at: '2024-01-01 01:05:00',
          updated_at: '2024-01-01 01:05:00',
          version: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          min_r_bps: 4700,
          max_loss_bps: 180,
          avg_twap_bps: 9850,
          min_reserve: 4_000_000,
          samples: 120,
        },
      ])
      .mockResolvedValueOnce([]);

    const app = await buildApp();
    const body = { policy: basePolicy, claimMode: 'FINAL' as const };
    const timestamp = Date.now().toString();
    const signature = signBody(body, timestamp);

    const response = await request(app.server)
      .post('/validator/api/v1/claims/preview')
      .set('x-lg-signature', signature)
      .set('x-lg-timestamp', timestamp)
      .send(body);

    await app.close();

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('payout');
    expect(response.body.riskId).toBe('risk-1');
  });

  test('POST /claims/sign returns typed data and signature', async () => {
    // preview path queries
    mockedQuery
      .mockResolvedValueOnce([
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
      .mockResolvedValueOnce([
        {
          min_r_bps: 4700,
          max_loss_bps: 200,
          avg_twap_bps: 9840,
          min_reserve: 4_000_000,
          samples: 120,
        },
      ])
      .mockResolvedValueOnce([])
      // sign path risk fetch
      .mockResolvedValueOnce([
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
      .mockResolvedValueOnce([
        {
          min_r_bps: 4700,
          max_loss_bps: 200,
          avg_twap_bps: 9840,
          min_reserve: 4_000_000,
          samples: 120,
        },
      ])
      .mockResolvedValueOnce([])
      // nonce select
      .mockResolvedValueOnce([]);

    mockedInsert.mockResolvedValue(undefined);

    const app = await buildApp();
    const body = { policy: basePolicy, claimMode: 'FINAL' as const };
    const timestamp = Date.now().toString();
    const signature = signBody(body, timestamp);

    const response = await request(app.server)
      .post('/validator/api/v1/claims/sign')
      .set('x-lg-signature', signature)
      .set('x-lg-timestamp', timestamp)
      .send(body);

    await app.close();

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('typedData');
    expect(response.body).toHaveProperty('signature');
  });
});
