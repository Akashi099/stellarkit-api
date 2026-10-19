/**
 * tests/routes/account.offersSummary.test.js
 *
 * Tests for GET /account/:id/offers-summary.
 *
 * Test scenarios:
 *   - Three sell offers for the same asset return one sellLocked entry with combined totalAmount
 *   - oldestOfferAgeDays correctly identifies the oldest offer
 *   - An account with no offers returns totalOffers: 0 and empty arrays
 *   - A non-existent account returns a 404
 *   - Caching behavior (first request misses, second hits)
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
const BTC_ISSUER = Keypair.random().publicKey();

function makeOffer(id, amount, price, options = {}) {
  const now = Date.now();
  const daysAgo = options.daysAgo || 0;
  const lastModifiedTime = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  return {
    id: String(id),
    paging_token: String(id),
    seller: "seller",
    selling_asset_type: options.sellingAssetType || "native",
    selling_asset_code: options.sellingAssetCode || null,
    selling_asset_issuer: options.sellingAssetIssuer || null,
    buying_asset_type: options.buyingAssetType || "credit_alphanum4",
    buying_asset_code: options.buyingAssetCode || "USDC",
    buying_asset_issuer: options.buyingAssetIssuer || USDC_ISSUER,
    amount,
    price,
    last_modified_time: lastModifiedTime,
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

describe("GET /account/:id/offers-summary", () => {
  const accountA = Keypair.random().publicKey();
  const accountB = Keypair.random().publicKey();
  const NONEXISTENT_ACCOUNT = Keypair.random().publicKey();
  const HORIZON_404 = { response: { status: 404 } };

  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.flush();
    server.loadAccount.mockImplementation((id) => Promise.resolve({ id }));
  });

  // --- Test: three sell offers for same asset combine into one sellLocked entry ---
  it("three sell offers for the same asset return one sellLocked entry with combined totalAmount", async () => {
    // Three offers selling XLM for USDC
    const offers = [
      makeOffer(1, "10.0000000", "0.5", { buyingAssetCode: "USDC", buyingAssetIssuer: USDC_ISSUER }),
      makeOffer(2, "20.0000000", "0.5", { buyingAssetCode: "USDC", buyingAssetIssuer: USDC_ISSUER }),
      makeOffer(3, "15.0000000", "0.5", { buyingAssetCode: "USDC", buyingAssetIssuer: USDC_ISSUER }),
    ];
    mockOffers({ [accountA]: offers });

    const res = await request(app).get(`/account/${accountA}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offerCount).toBe(3);

    // Should have exactly one asset entry (USDC)
    const usdcEntry = res.body.data.assets.find(
      (a) => a.asset.code === "USDC" && a.asset.issuer === USDC_ISSUER
    );
    expect(usdcEntry).toBeDefined();
    // Combined: 10 + 20 + 15 = 45
    expect(usdcEntry.sellLocked).toBe("45.0000000");
  });

  // --- Test: oldestOfferAgeDays correctly identifies the oldest offer ---
  it("oldestOfferAgeDays correctly identifies the oldest offer", async () => {
    const now = Date.now();
    // Offer 1: 5 days ago
    const offer1 = makeOffer(1, "10.0000000", "0.5", { daysAgo: 5 });
    // Offer 2: 30 days ago (oldest)
    const offer2 = makeOffer(2, "20.0000000", "0.5", { daysAgo: 30 });
    // Offer 3: 10 days ago
    const offer3 = makeOffer(3, "15.0000000", "0.5", { daysAgo: 10 });

    mockOffers({ [accountA]: [offer1, offer2, offer3] });

    const res = await request(app).get(`/account/${accountA}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.oldestOfferAgeDays).toBeGreaterThanOrEqual(29);
    expect(res.body.data.oldestOfferAgeDays).toBeLessThanOrEqual(31);
  });

  // --- Test: account with no offers returns empty arrays ---
  it("account with no offers returns totalOffers: 0 and empty arrays", async () => {
    mockOffers({ [accountA]: [] });

    const res = await request(app).get(`/account/${accountA}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offerCount).toBe(0);
    expect(res.body.data.assets).toEqual([]);
    expect(res.body.data.oldestOfferAgeDays).toBeNull();
  });

  // --- Test: non-existent account returns 404 ---
  it("non-existent account returns a 404", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);

    const res = await request(app).get(`/account/${NONEXISTENT_ACCOUNT}/offers-summary`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  // --- Cache behavior tests ---
  it("first request hits Horizon and returns X-Cache: MISS", async () => {
    const forAccount = mockOffers({ [accountA]: [makeOffer(1, "10.0000000", "0.5")] });

    const res = await request(app).get(`/account/${accountA}/offers-summary`);

    expect(res.statusCode).toBe(200);
    expect(res.get("X-Cache")).toBe("MISS");
    expect(server.offers).toHaveBeenCalledTimes(1);
    expect(forAccount).toHaveBeenCalledWith(accountA);
    expect(res.body.data.accountId).toBe(accountA);
    expect(res.body.data.offerCount).toBe(1);
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
    expect(res1.body.data.offerCount).toBe(1);

    mockOffers({
      [accountA]: [
        makeOffer(1, "10.0000000", "0.5"),
        makeOffer(2, "5.0000000", "0.5"),
      ],
    });

    const res2 = await request(app).get(`${url}?fresh=true`);
    expect(res2.statusCode).toBe(200);
    expect(res2.get("X-Cache")).toBe("MISS");
    expect(res2.body.data.offerCount).toBe(2);
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
    expect(resA1.body.data.offerCount).toBe(1);
    expect(resB1.body.data.accountId).toBe(accountB);
    expect(resB1.body.data.offerCount).toBe(2);
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
