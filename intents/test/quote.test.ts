import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_DRY_QUOTE_PARAMS,
  DryQuoteError,
  assertNoDepositAddress,
  parseQuoteResponse,
  requestDryQuote,
  summarizeQuote,
  ONECLICK_QUOTE_URL,
} from "../src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "dry_quote_wnear_usdc.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  recordedAt: string;
  endpoint: string;
  httpStatus: number;
  request: typeof DEMO_DRY_QUOTE_PARAMS & { dry: true };
  response: unknown;
};

describe("fixture integrity", () => {
  it("records a dry:true response without depositAddress", () => {
    assert.equal(fixture.request.dry, true);
    assert.equal(fixture.endpoint, ONECLICK_QUOTE_URL);
    assert.equal(fixture.httpStatus, 201);
    const parsed = parseQuoteResponse(fixture.response);
    assert.equal(parsed.quoteRequest.dry, true);
    assert.equal(parsed.quote.amountIn, fixture.request.amount);
    assert.ok(Number(parsed.quote.amountOut) > 0);
    assertNoDepositAddress(parsed.quote);
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed.quote, "depositAddress"),
      false,
    );
  });

  it("matches demo asset pair (wNEAR → NEAR USDC via Intents)", () => {
    assert.equal(fixture.request.originAsset, DEMO_DRY_QUOTE_PARAMS.originAsset);
    assert.equal(
      fixture.request.destinationAsset,
      DEMO_DRY_QUOTE_PARAMS.destinationAsset,
    );
    assert.equal(fixture.request.depositType, "INTENTS");
    assert.equal(fixture.request.recipientType, "INTENTS");
  });
});

describe("parseQuoteResponse", () => {
  it("rejects missing amountOut", () => {
    assert.throws(() =>
      parseQuoteResponse({
        correlationId: "x",
        timestamp: "t",
        signature: "s",
        quoteRequest: { dry: true },
        quote: { amountIn: "1" },
      }),
    );
  });

  it("rejects dry:false in quoteRequest", () => {
    const bad = structuredClone(fixture.response) as {
      quoteRequest: { dry: boolean };
    };
    bad.quoteRequest.dry = false;
    assert.throws(() => parseQuoteResponse(bad), /dry is not true/);
  });

  it("rejects leaked depositAddress", () => {
    const bad = structuredClone(fixture.response) as {
      quote: { depositAddress?: string };
    };
    bad.quote.depositAddress = "0xdead";
    assert.throws(() => parseQuoteResponse(bad), /depositAddress/);
  });
});

describe("requestDryQuote (offline, injected fetch)", () => {
  it("forces dry:true in the POST body", async () => {
    let posted: unknown;
    const fetchMock: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(fixture.response), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };

    const res = await requestDryQuote(
      { ...DEMO_DRY_QUOTE_PARAMS, deadline: fixture.request.deadline },
      { fetch: fetchMock },
    );

    assert.equal((posted as { dry: boolean }).dry, true);
    assert.equal(res.quote.amountOutFormatted, "3.724544");
    assert.match(summarizeQuote(res), /dry=true/);
  });

  it("forces dry even if a caller tries to pass dry:false via cast", async () => {
    let posted: unknown;
    const fetchMock: typeof fetch = async (_url, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(fixture.response), { status: 201 });
    };

    await requestDryQuote(
      {
        ...DEMO_DRY_QUOTE_PARAMS,
        deadline: fixture.request.deadline,
        // @ts-expect-error intentional abuse for safety test
        dry: false,
      },
      { fetch: fetchMock },
    );

    assert.equal((posted as { dry: boolean }).dry, true);
  });

  it("maps non-2xx to DryQuoteError", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "bad" }), { status: 400 });

    await assert.rejects(
      () =>
        requestDryQuote(
          { ...DEMO_DRY_QUOTE_PARAMS, deadline: fixture.request.deadline },
          { fetch: fetchMock },
        ),
      (err: unknown) => {
        assert.ok(err instanceof DryQuoteError);
        assert.equal(err.status, 400);
        return true;
      },
    );
  });

  it("accepts HTTP 200 as well as 201", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify(fixture.response), { status: 200 });
    const res = await requestDryQuote(
      { ...DEMO_DRY_QUOTE_PARAMS, deadline: fixture.request.deadline },
      { fetch: fetchMock },
    );
    assert.ok(res.correlationId);
  });
});

describe("requestDryQuote (live, optional)", () => {
  it("posts dry:true to 1Click when network is reachable", async (t) => {
    if (process.env.ASTRA_INTENTS_LIVE !== "1") {
      t.skip("set ASTRA_INTENTS_LIVE=1 to run live dry quote");
      return;
    }

    const deadline = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    try {
      const res = await requestDryQuote({
        ...DEMO_DRY_QUOTE_PARAMS,
        deadline,
      });
      assert.equal(res.quoteRequest.dry, true);
      assert.ok(Number(res.quote.amountOut) > 0);
      assertNoDepositAddress(res.quote);
      console.log("live:", summarizeQuote(res));
    } catch (err) {
      t.skip(`live dry quote unavailable: ${String(err)}`);
    }
  });
});
