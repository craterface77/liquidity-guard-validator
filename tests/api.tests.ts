import request from 'supertest';
import { createClient } from '@clickhouse/client';

describe('Validator API smoke tests', () => {
  it('GET /validator/api/v1/risk returns 200 and items[]', async () => {
    const res = await request('http://localhost:3000').get('/validator/api/v1/risk');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  }, 20000);

  it('GET /validator/api/v1/risk/:riskId returns detail or 404', async () => {
    const list = await request('http://localhost:3000').get('/validator/api/v1/risk');
    const items = list.body.items;
    if (items && items.length > 0) {
      const id = items[0].risk_id;
      const res = await request('http://localhost:3000').get(`/validator/api/v1/risk/${encodeURIComponent(id)}`);
      expect([200,404]).toContain(res.status);
    } else {
      // no items, that's ok
      expect(items.length).toBe(0);
    }
  }, 20000);
})
