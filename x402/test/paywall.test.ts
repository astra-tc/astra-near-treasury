import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  Paywall,
  MockRpc,
  NonceStore,
  isPaymentChallenge,
  isPaymentReceipt,
  buildSnapshot,
} from "../src/index.ts";

const RESOURCE = "treasury-snapshot";
const AMOUNT = "1000000";
const RECEIVER = "treasury.sandbox";
const NETWORK = "sandbox" as const;

function makePaywall(rpc: MockRpc, nonces?: NonceStore, nonceSeq?: string[]) {
  let i = 0;
  return new Paywall({
    amount: AMOUNT,
    receiver: RECEIVER,
    network: NETWORK,
    resource: RESOURCE,
    rpc,
    nonces,
    now: () => new Date("2026-11-05T19:00:00.000Z"),
    newNonce: nonceSeq
      ? () => {
          const n = nonceSeq[i++];
          if (!n) throw new Error("nonce sequence exhausted");
          return n;
        }
      : undefined,
  });
}

describe("schema helpers", () => {
  it("accepts a valid challenge", () => {
    assert.equal(
      isPaymentChallenge({
        amount: AMOUNT,
        receiver: RECEIVER,
        nonce: "n1",
        network: "sandbox",
        resource: RESOURCE,
      }),
      true,
    );
  });

  it("rejects challenge with bad network", () => {
    assert.equal(
      isPaymentChallenge({
        amount: AMOUNT,
        receiver: RECEIVER,
        nonce: "n1",
        network: "mainnet",
        resource: RESOURCE,
      }),
      false,
    );
  });

  it("accepts a valid receipt", () => {
    assert.equal(
      isPaymentReceipt({
        paymentId: "pay-1",
        nonce: "n1",
        amount: AMOUNT,
        receiver: RECEIVER,
        network: "sandbox",
      }),
      true,
    );
  });
});

describe("buildSnapshot", () => {
  it("returns sandbox treasury headline fields", () => {
    const snap = buildSnapshot(RESOURCE, "sandbox", new Date("2026-11-05T19:00:00.000Z"));
    assert.equal(snap.resource, RESOURCE);
    assert.equal(snap.treasury.network, "sandbox");
    assert.equal(snap.asOf, "2026-11-05T19:00:00.000Z");
    assert.match(snap.note, /sandbox/);
  });
});

describe("NonceStore", () => {
  it("flags replay after consume", () => {
    const store = new NonceStore();
    store.issue("n1", { amount: AMOUNT, receiver: RECEIVER, resource: RESOURCE });
    const first = store.consume("n1");
    assert.equal(first.ok, true);
    const second = store.consume("n1");
    assert.deepEqual(second, { ok: false, reason: "replay" });
    assert.equal(store.isUsed("n1"), true);
  });

  it("returns unknown for never-issued nonce", () => {
    const store = new NonceStore();
    assert.deepEqual(store.consume("nope"), { ok: false, reason: "unknown" });
  });
});

describe("Paywall", () => {
  let rpc: MockRpc;

  beforeEach(() => {
    rpc = new MockRpc();
  });

  it("returns 402 challenge when no receipt", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-a"]);
    const res = await wall.handle(null);
    assert.equal(res.status, 402);
    if (res.status !== 402) return;
    assert.equal(res.body.amount, AMOUNT);
    assert.equal(res.body.receiver, RECEIVER);
    assert.equal(res.body.nonce, "nonce-a");
    assert.equal(res.body.network, "sandbox");
    assert.equal(res.body.resource, RESOURCE);
  });

  it("returns 402 unpaid when payment missing from RPC", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-b"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    const res = await wall.handle({
      paymentId: "missing",
      nonce: challenge.nonce,
      amount: challenge.amount,
      receiver: challenge.receiver,
      network: challenge.network,
    });
    assert.equal(res.status, 402);
    if (res.status === 402) assert.equal(res.reason, "unpaid");
  });

  it("returns 402 unpaid when payment exists but unsettled", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-c"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    rpc.seed({
      paymentId: "pay-unsettled",
      amount: AMOUNT,
      receiver: RECEIVER,
      settled: false,
    });
    const res = await wall.handle({
      paymentId: "pay-unsettled",
      nonce: challenge.nonce,
      amount: challenge.amount,
      receiver: challenge.receiver,
      network: challenge.network,
    });
    assert.equal(res.status, 402);
    if (res.status === 402) assert.equal(res.reason, "unpaid");
  });

  it("returns 402 wrong_amount when RPC amount mismatches", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-d"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    rpc.seed({
      paymentId: "pay-wrong",
      amount: "999",
      receiver: RECEIVER,
      settled: true,
    });
    // Receipt claims correct amount, but chain record is wrong.
    const res = await wall.handle({
      paymentId: "pay-wrong",
      nonce: challenge.nonce,
      amount: challenge.amount,
      receiver: challenge.receiver,
      network: challenge.network,
    });
    assert.equal(res.status, 402);
    if (res.status === 402) assert.equal(res.reason, "wrong_amount");
  });

  it("returns 402 when receipt amount mismatches challenge", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-e"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    rpc.seed({
      paymentId: "pay-ok",
      amount: AMOUNT,
      receiver: RECEIVER,
      settled: true,
    });
    const res = await wall.handle({
      paymentId: "pay-ok",
      nonce: challenge.nonce,
      amount: "1",
      receiver: challenge.receiver,
      network: challenge.network,
    });
    assert.equal(res.status, 402);
    if (res.status === 402) assert.equal(res.reason, "wrong_amount_or_receiver");
  });

  it("returns 200 with snapshot when paid correctly", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-f"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    rpc.seed({
      paymentId: "pay-good",
      amount: AMOUNT,
      receiver: RECEIVER,
      settled: true,
    });
    const res = await wall.handle({
      paymentId: "pay-good",
      nonce: challenge.nonce,
      amount: challenge.amount,
      receiver: challenge.receiver,
      network: challenge.network,
    });
    assert.equal(res.status, 200);
    if (res.status !== 200) return;
    assert.equal(res.body.resource, RESOURCE);
    assert.equal(res.body.treasury.network, "sandbox");
    assert.equal(res.body.asOf, "2026-11-05T19:00:00.000Z");
  });

  it("returns 409 on replayed nonce", async () => {
    const wall = makePaywall(rpc, undefined, ["nonce-g"]);
    const challenge = (await wall.handle(null)).body as {
      nonce: string;
      amount: string;
      receiver: string;
      network: "sandbox";
    };
    rpc.seed({
      paymentId: "pay-good-2",
      amount: AMOUNT,
      receiver: RECEIVER,
      settled: true,
    });
    const receipt = {
      paymentId: "pay-good-2",
      nonce: challenge.nonce,
      amount: challenge.amount,
      receiver: challenge.receiver,
      network: challenge.network,
    };
    const first = await wall.handle(receipt);
    assert.equal(first.status, 200);
    const second = await wall.handle(receipt);
    assert.equal(second.status, 409);
    if (second.status === 409) {
      assert.match(second.body.error, /replay/i);
      assert.equal(second.body.nonce, "nonce-g");
    }
  });

  it("returns 400 on malformed receipt", async () => {
    const wall = makePaywall(rpc);
    const res = await wall.handle({ not: "a receipt" } as never);
    assert.equal(res.status, 400);
  });
});
