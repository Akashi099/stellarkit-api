const request = require('supertest');
const express = require('express');

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Server: jest.fn(),
  };
});

const StellarSdk = require('stellar-sdk');

const mockTradesCall = jest.fn();

const mockServerInstance = {
  trades: jest.fn(() => ({
    forAssetPair: jest.fn(() => ({
      order: jest.fn(() => ({
        limit: jest.fn(() => ({
          call: mockTradesCall,
        })),
      })),
    })),
  })),
};

StellarSdk.Server.mockImplementation(() => mockServerInstance);

const dexRouter = require('../../routes/dex');

function buildApp() {
  const app = express();
  app.use('/dex', dexRouter);
  return app;
}

function makeTrade({ baseIsMaker, createdAt }) {
  return {
    base_is_seller: baseIsMaker,
    created_at: createdAt,
    base_amount: '10.0000000',
    counter_amount: '20.0000000',
    price: { n: 2, d: 1 },
  };
}

describe('GET /dex/maker-taker-ratio/:baseAsset/:counterAsset', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('returns makerPercent 70 and takerPercent 30 for 7 maker and 3 taker trades', async () => {
    const now = new Date();
    const trades = [];
    for (let i = 0; i < 7; i += 1) {
      trades.push(makeTrade({ baseIsMaker: true, createdAt: now.toISOString() }));
    }
    for (let i = 0; i < 3; i += 1) {
      trades.push(makeTrade({ baseIsMaker: false, createdAt: now.toISOString() }));
    }
    mockTradesCall.mockResolvedValue({ records: trades });

    const res = await request(app).get('/dex/maker-taker-ratio/XLM/USDC');

    expect(res.status).toBe(200);
    expect(res.body.makerPercent).toBe(70);
    expect(res.body.takerPercent).toBe(30);
  });

  test('makerPercent and takerPercent always sum to 100', async () => {
    const now = new Date();
    const trades = [];
    for (let i = 0; i < 4; i += 1) {
      trades.push(makeTrade({ baseIsMaker: true, createdAt: now.toISOString() }));
    }
    for (let i = 0; i < 6; i += 1) {
      trades.push(makeTrade({ baseIsMaker: false, createdAt: now.toISOString() }));
    }
    mockTradesCall.mockResolvedValue({ records: trades });

    const res = await request(app).get('/dex/maker-taker-ratio/XLM/USDC');

    expect(res.status).toBe(200);
    expect(res.body.makerPercent + res.body.takerPercent).toBe(100);
  });

  test('?days=14 filters trades to the last 14 days', async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const old = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    const trades = [
      makeTrade({ baseIsMaker: true, createdAt: recent.toISOString() }),
      makeTrade({ baseIsMaker: true, createdAt: recent.toISOString() }),
      makeTrade({ baseIsMaker: false, createdAt: recent.toISOString() }),
      makeTrade({ baseIsMaker: false, createdAt: old.toISOString() }),
      makeTrade({ baseIsMaker: false, createdAt: old.toISOString() }),
    ];
    mockTradesCall.mockResolvedValue({ records: trades });

    const res = await request(app).get('/dex/maker-taker-ratio/XLM/USDC?days=14');

    expect(res.status).toBe(200);
    expect(res.body.makerPercent).toBe(67);
    expect(res.body.takerPercent).toBe(33);
  });

  test('returns OrderBookEmpty error for a pair with no trade history', async () => {
    mockTradesCall.mockResolvedValue({ records: [] });

    const res = await request(app).get('/dex/maker-taker-ratio/XLM/USDC');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('OrderBookEmpty');
  });

  test('?days=31 returns HTTP 400', async () => {
    const res = await request(app).get('/dex/maker-taker-ratio/XLM/USDC?days=31');

    expect(res.status).toBe(400);
  });
});