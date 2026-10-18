"use strict";

const request = require("supertest");
const { Keypair } = require("@stellar/stellar-sdk");

const app = require("../../src/index");
const { server } = require("../../src/config/stellar");

const ACCOUNT_ID = Keypair.random().publicKey();
const SENDER_ONE = Keypair.random().publicKey();
const SENDER_TWO = Keypair.random().publicKey();
const ISSUER_ID = Keypair.random().publicKey();

function payment({
  type = "payment",
  from = SENDER_ONE,
  to = ACCOUNT_ID,
  amount,
  asset = "native",
  createdAt,
  successful = true,
  pagingToken,
}) {
  const isNative = asset === "native";
  return {
    type,
    from,
    to,
    amount,
    funder: type === "create_account" ? from : undefined,
    account: type === "create_account" ? to : undefined,
    starting_balance: type === "create_account" ? amount : undefined,
    asset_type: isNative ? "native" : "credit_alphanum4",
    asset_code: isNative ? undefined : asset,
    asset_issuer: isNative ? undefined : ISSUER_ID,
    transaction_successful: successful,
    created_at: createdAt,
    paging_token: pagingToken,
  };
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /account/:id/asset-received-summary", () => {
  it("summarizes successful inbound amounts per asset and sorts by total received", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
    mockPayments([
      payment({
        amount: "4.0000000",
        createdAt: "2024-01-01T00:00:00Z",
        pagingToken: "1",
      }),
      payment({
        amount: "8.2500000",
        asset: "USDC",
        createdAt: "2024-01-02T00:00:00Z",
        pagingToken: "2",
      }),
      payment({
        from: SENDER_TWO,
        amount: "3.0000000",
        type: "create_account",
        createdAt: "2024-01-03T00:00:00Z",
        pagingToken: "3",
      }),
      payment({
        amount: "5.0000000",
        asset: "USDC",
        createdAt: "2024-01-04T00:00:00Z",
        pagingToken: "4",
      }),
      payment({
        from: ACCOUNT_ID,
        to: SENDER_TWO,
        amount: "100.0000000",
        createdAt: "2024-01-05T00:00:00Z",
        pagingToken: "5",
      }),
      payment({
        amount: "100.0000000",
        asset: "USDC",
        successful: false,
        createdAt: "2024-01-06T00:00:00Z",
        pagingToken: "6",
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-received-summary`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(ACCOUNT_ID);
    expect(res.body.data.summary).toHaveLength(2);
    expect(res.body.data.summary[0]).toMatchObject({
      asset: { code: "USDC", issuer: ISSUER_ID },
      totalReceived: "13.2500000",
      senderCount: 1,
      firstReceivedAt: "2024-01-02T00:00:00.000Z",
      lastReceivedAt: "2024-01-04T00:00:00.000Z",
    });
    expect(res.body.data.summary[1]).toMatchObject({
      asset: { code: "XLM", type: "native" },
      totalReceived: "7.0000000",
      senderCount: 2,
      firstReceivedAt: "2024-01-01T00:00:00.000Z",
      lastReceivedAt: "2024-01-03T00:00:00.000Z",
    });
    for (const entry of res.body.data.summary) {
      expect(entry.totalReceived).toMatch(/^\d+\.\d{7}$/);
    }
  });

  it("omits assets with no positive inbound amount", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({ id: ACCOUNT_ID });
    mockPayments([
      payment({
        from: ACCOUNT_ID,
        to: SENDER_ONE,
        amount: "10.0000000",
        createdAt: "2024-01-01T00:00:00Z",
        pagingToken: "1",
      }),
      payment({
        amount: "0.0000000",
        createdAt: "2024-01-02T00:00:00Z",
        pagingToken: "2",
      }),
    ]);

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-received-summary`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual([]);
  });

  it("returns 404 when the account does not exist", async () => {
    const notFoundError = new Error("Not Found");
    notFoundError.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFoundError);
    jest.spyOn(server, "payments");

    const res = await request(app).get(
      `/account/${ACCOUNT_ID}/asset-received-summary`,
    );

    expect(res.status).toBe(404);
    expect(server.payments).not.toHaveBeenCalled();
  });
});