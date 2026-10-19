/**
 * tests/routes/account.offersSummary.test.js
 *
 * Coverage for GET /account/:id/offers-summary.
 *
 * Cache scenarios:
 *   1. First request hits Horizon and returns X-Cache: MISS
 *   2. Second request returns X-Cache: HIT with identical data
 *   3. ?fresh=true forces a cache bypass
 *   4. Two different account IDs get separate cache entries
 *
 * Aggregation scenarios:
 *   5. Sell and buy totals are grouped per asset as seven-decimal strings
 *   6. Buy totals use the exact price_r ratio rather than the rounded price
 *   7. Offers spanning multiple Horizon pages are all counted
 *   8. An account with no offers returns zero and empty arrays
 *   9. An unknown account returns 404 AccountNotFound
 */

"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  ...jest.requireActual("../../src/config/stellar"),
  server: {
    loadAccount: jest.fn(),
    offers: jest.fn(),
  },
}));

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");
const cacheService = require("../../src/services/cache");

const USDC_ISSUER = Keypair.random().publicKey();

function makeOffer(id, amount, price) {
  return {
    id: String(id),
    paging_token: String(id),
    seller: "seller",
    selling_asset_type: "native",
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: USDC_ISSUER,
    amount,
    price,
    last_modified_time: "2024-01-01T00:00:00Z",
  };
}

/**
 * Mocks server.offers() so each forAccount(id) call resolves with the
 * records registered for that account ID.
 */
function mockOffers(recordsByAccount) {
  const forAccount = jest.fn((id) => {
    const chain = {
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: recordsByAccount[id] || [] }),
    };
    return chain;
  });
  server.offers.mockReturnValue({ forAccount });
  return forAccount;
}

describe("GET /account/:id/offers-summary cache behavior", () => {
  const accountA = Keypair.random().publicKey();
  const accountB = Keypair.random().publicKey();

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockImplementation((id) => Promise.resolve({ id }));
  });

  it("first request hits Horizon and returns X-Cache: MISS", async () => {
    const forAccount = mockOffers({ [accountA]: [makeOffer(1, "10.0000000", "0.5")] });

    const res = await request(app).get(`/account/${accountA}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.offers).toHaveBeenCalledTimes(1);
    expect(forAccount).toHaveBeenCalledWith(accountA);
    expect(res.body.data.accountId).toBe(accountA);
    expect(res.body.data.totalOffers).toBe(1);
  });

  it("second request returns X-Cache: HIT with identical data", async () => {
    mockOffers({ [accountA]: [makeOffer(1, "10.0000000", "0.5")] });

    const url = `/account/${accountA}/offers-summary`;
    const res1 = await request(app).get(url);
    expect(res1.statusCode).toBe(200);
    expect(res1.get("X-Cache")).toBe("MISS");

    const res2 = await request(app).get(url);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("HIT");
    expect(res2.body.data).toEqual(res1.body.data);
    expect(server.offers).toHaveBeenCalledTimes(1);
    expect(server.loadAccount).toHaveBeenCalledTimes(1);
  });

  it("?fresh=true forces a cache bypass", async () => {
    mockOffers({ [accountA]: [makeOffer(1, "10.0000000", "0.5")] });

    const url = `/account/${accountA}/offers-summary`;
    const res1 = await request(app).get(url);
    expect(res1.get("X-Cache")).toBe("MISS");
    expect(res1.body.data.totalOffers).toBe(1);

    mockOffers({
      [accountA]: [
        makeOffer(1, "10.0000000", "0.5"),
        makeOffer(2, "5.0000000", "0.5"),
      ],
    });

    const res2 = await request(app).get(`${url}?fresh=true`);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(res2.body.data.totalOffers).toBe(2);
    expect(server.offers).toHaveBeenCalledTimes(2);
  });

  it("caches different account IDs separately without cross-contamination", async () => {
    mockOffers({
      [accountA]: [makeOffer(1, "10.0000000", "0.5")],
      [accountB]: [
        makeOffer(2, "20.0000000", "0.25"),
        makeOffer(3, "30.0000000", "0.25"),
      ],
    });

    const resA1 = await request(app).get(`/account/${accountA}/offers-summary`);
    expect(resA1.get("X-Cache")).toBe("MISS");

    const resB1 = await request(app).get(`/account/${accountB}/offers-summary`);
    expect(resB1.get("X-Cache")).toBe("MISS");
    expect(server.offers).toHaveBeenCalledTimes(2);

    expect(resA1.body.data.accountId).toBe(accountA);
    expect(resA1.body.data.totalOffers).toBe(1);
    expect(resB1.body.data.accountId).toBe(accountB);
    expect(resB1.body.data.totalOffers).toBe(2);
    expect(resB1.body.data).not.toEqual(resA1.body.data);

    const resA2 = await request(app).get(`/account/${accountA}/offers-summary`);
    const resB2 = await request(app).get(`/account/${accountB}/offers-summary`);
    expect(resA2.get("X-Cache")).toBe("HIT");
    expect(resB2.get("X-Cache")).toBe("HIT");
    expect(resA2.body.data).toEqual(resA1.body.data);
    expect(resB2.body.data).toEqual(resB1.body.data);
    expect(server.offers).toHaveBeenCalledTimes(2);
  });
});

describe("GET /account/:id/offers-summary aggregation", () => {
  const accountId = Keypair.random().publicKey();
  const XLM = { code: "XLM", issuer: null, type: "native" };
  const USDC = { code: "USDC", issuer: USDC_ISSUER, type: "credit_alphanum4" };
  const SEVEN_DECIMALS = /^\d+\.\d{7}$/;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function assetFields(prefix, asset) {
    if (asset.type === "native") return { [`${prefix}_asset_type`]: "native" };
    return {
      [`${prefix}_asset_type`]: asset.type,
      [`${prefix}_asset_code`]: asset.code,
      [`${prefix}_asset_issuer`]: asset.issuer,
    };
  }

  function offer({ id, selling, buying, amount, price, priceR, daysOld = 0 }) {
    return {
      id: String(id),
      paging_token: String(id),
      seller: accountId,
      ...assetFields("selling", selling),
      ...assetFields("buying", buying),
      amount,
      price,
      ...(priceR ? { price_r: priceR } : {}),
      last_modified_time: new Date(Date.now() - daysOld * DAY_MS).toISOString(),
    };
  }

  /** Mocks server.offers() to resolve successive pages in order. */
  function mockOfferPages(...pages) {
    const call = jest.fn();
    for (const records of pages) call.mockResolvedValueOnce({ records });
    const chain = {
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call,
    };
    server.offers.mockReturnValue({ forAccount: jest.fn(() => chain) });
    return chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockImplementation((id) => Promise.resolve({ id }));
  });

  it("groups sell and buy totals per asset as seven-decimal strings", async () => {
    mockOfferPages([
      offer({ id: 1, selling: XLM, buying: USDC, amount: "10.0000000", price: "0.5000000", daysOld: 3 }),
      offer({ id: 2, selling: XLM, buying: USDC, amount: "20.5000000", price: "0.2500000", daysOld: 10 }),
      offer({ id: 3, selling: USDC, buying: XLM, amount: "7.0000000", price: "2.0000000", daysOld: 1 }),
    ]);

    const res = await request(app).get(`/account/${accountId}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      accountId,
      totalOffers: 3,
      sellLocked: [
        { asset: XLM, totalAmount: "30.5000000" },
        { asset: USDC, totalAmount: "7.0000000" },
      ],
      buyCommitted: [
        { asset: XLM, totalAmount: "14.0000000" },
        { asset: USDC, totalAmount: "10.1250000" },
      ],
      oldestOfferAgeDays: 10,
    });
    for (const entry of [...res.body.data.sellLocked, ...res.body.data.buyCommitted]) {
      expect(entry.totalAmount).toMatch(SEVEN_DECIMALS);
    }
  });

  it("computes buy totals from the exact price_r ratio", async () => {
    // 3 × 1/3 is exactly 1; the rounded decimal price would give 0.9999999.
    mockOfferPages([
      offer({
        id: 1,
        selling: XLM,
        buying: USDC,
        amount: "3.0000000",
        price: "0.3333333",
        priceR: { n: 1, d: 3 },
      }),
    ]);

    const res = await request(app).get(`/account/${accountId}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.buyCommitted).toEqual([{ asset: USDC, totalAmount: "1.0000000" }]);
  });

  it("follows Horizon pagination so every open offer is counted", async () => {
    const firstPage = Array.from({ length: 200 }, (_, i) =>
      offer({ id: i + 1, selling: XLM, buying: USDC, amount: "1.0000000", price: "1.0000000" }),
    );
    const secondPage = Array.from({ length: 50 }, (_, i) =>
      offer({ id: i + 201, selling: XLM, buying: USDC, amount: "1.0000000", price: "1.0000000" }),
    );
    const chain = mockOfferPages(firstPage, secondPage);

    const res = await request(app).get(`/account/${accountId}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.totalOffers).toBe(250);
    expect(res.body.data.sellLocked).toEqual([{ asset: XLM, totalAmount: "250.0000000" }]);
    expect(chain.call).toHaveBeenCalledTimes(2);
    expect(chain.cursor).toHaveBeenCalledWith("200");
  });

  it("returns totalOffers: 0 and empty arrays when the account has no open offers", async () => {
    mockOfferPages([]);

    const res = await request(app).get(`/account/${accountId}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        accountId,
        totalOffers: 0,
        sellLocked: [],
        buyCommitted: [],
        oldestOfferAgeDays: null,
      },
    });
  });

  it("returns 404 AccountNotFound when the account does not exist", async () => {
    mockOfferPages([]);
    server.loadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/account/${accountId}/offers-summary`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });
});
