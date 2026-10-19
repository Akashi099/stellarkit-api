"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const OTHER_ID = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();
const DAY_MS = 24 * 60 * 60 * 1000;

function payment({ daysAgo, amount, direction = "in", asset = "native" }) {
  const isNative = asset === "native";
  return {
    type: "payment",
    transaction_successful: true,
    created_at: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
    paging_token: `token-${daysAgo}-${asset}`,
    asset_type: isNative ? "native" : "credit_alphanum4",
    asset_code: isNative ? undefined : asset,
    asset_issuer: isNative ? undefined : ISSUER_ID,
    amount,
    from: direction === "in" ? OTHER_ID : ACCOUNT_ID,
    to: direction === "in" ? ACCOUNT_ID : OTHER_ID,
  };
}

function mockAccount(balance = "100.0000000") {
  jest.spyOn(server, "loadAccount").mockResolvedValue({
    id: ACCOUNT_ID,
    balances: [{ asset_type: "native", balance }],
  });
}

function mockPayments(records) {
  jest.spyOn(server, "payments").mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
}

function mockHistory() {
  mockAccount();
  mockPayments([
    payment({ daysAgo: 90, amount: "10.0000000" }),
    payment({ daysAgo: 60, amount: "5.0000000", direction: "out" }),
    payment({ daysAgo: 30, amount: "20.0000000" }),
    payment({ daysAgo: 7, amount: "3.0000000", direction: "out" }),
    payment({ daysAgo: 1, amount: "2.0000000" }),
    payment({ daysAgo: 30, amount: "50.0000000", asset: "USDC" }),
  ]);
}

function expectSnapshotsSpacedBy(snapshots, days) {
  expect(snapshots.length).toBeGreaterThan(1);

  const intervalMs = days * DAY_MS;
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = new Date(snapshots[index - 1].timestamp).getTime();
    const current = new Date(snapshots[index].timestamp).getTime();
    expect(Math.abs(current - previous)).toBe(intervalMs);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/historical-balances", () => {
  it("returns snapshots spaced 7 days apart", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectSnapshotsSpacedBy(res.body.data.snapshots, 7);
  });

  it("returns snapshots spaced 30 days apart", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=30d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expectSnapshotsSpacedBy(res.body.data.snapshots, 30);
  });

  it("returns each snapshot timestamp as an ISO 8601 string", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.snapshots.length).toBeGreaterThan(0);
    for (const snapshot of res.body.data.snapshots) {
      expect(snapshot.timestamp).toEqual(new Date(snapshot.timestamp).toISOString());
    }
  });

  it("returns native XLM balance history when asset=XLM", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=7d&asset=XLM`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.snapshots.length).toBeGreaterThan(0);
    expect(res.body.data.asset).toMatchObject({ code: "XLM", type: "native" });
    for (const snapshot of res.body.data.snapshots) {
      expect(snapshot.balance).toEqual(expect.any(String));
    }
  });

  it("returns 400 for an invalid resolution", async () => {
    mockHistory();

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/historical-balances?resolution=12h`,
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(server.payments).not.toHaveBeenCalled();
  });
});