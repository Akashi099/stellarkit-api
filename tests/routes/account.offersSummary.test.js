/**
 * tests/routes/account.offersSummary.test.js
 *
 * Cache coverage for GET /account/:id/offers-summary.
 *
 * Test scenarios:
 *   1. First request hits Horizon and returns X-Cache: MISS
 *   2. Second request returns X-Cache: HIT with identical data
 *   3. ?fresh=true forces a cache bypass
 *   4. Two different account IDs get separate cache entries
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
