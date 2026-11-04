import { buildHmacSignature } from "@polymarket/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readBuilderCredentials, signBuilderRequest, tradingStatus } from "./trading";

const ENV_KEYS = [
  "POLYMARKET_BUILDER_CODE",
  "POLYMARKET_BUILDER_API_KEY",
  "POLYMARKET_BUILDER_SECRET",
  "POLYMARKET_BUILDER_PASSPHRASE",
] as const;

// Test-only fake credentials (the secret is base64, as Polymarket issues them).
const FAKE = {
  POLYMARKET_BUILDER_CODE: "0x0000000000000000000000000000000000000000000000000000000000000abc",
  POLYMARKET_BUILDER_API_KEY: "test-key",
  POLYMARKET_BUILDER_SECRET: Buffer.from("test-secret").toString("base64"),
  POLYMARKET_BUILDER_PASSPHRASE: "test-pass",
};

function stubCredentials(values: Partial<typeof FAKE>): void {
  for (const key of ENV_KEYS) vi.stubEnv(key, values[key] ?? "");
}

beforeEach(() => stubCredentials({}));
afterEach(() => vi.unstubAllEnvs());

describe("tradingStatus", () => {
  it("is off until every Builder credential is set", () => {
    stubCredentials({
      POLYMARKET_BUILDER_CODE: FAKE.POLYMARKET_BUILDER_CODE,
      POLYMARKET_BUILDER_API_KEY: FAKE.POLYMARKET_BUILDER_API_KEY,
    });
    expect(tradingStatus()).toEqual({ enabled: false, builderCode: null });
    expect(readBuilderCredentials()).toBeNull();
  });

  it("exposes only the public builder code when on", () => {
    stubCredentials(FAKE);
    const status = tradingStatus();
    expect(status).toEqual({ enabled: true, builderCode: FAKE.POLYMARKET_BUILDER_CODE });
    expect(JSON.stringify(status)).not.toContain(FAKE.POLYMARKET_BUILDER_SECRET);
  });
});

describe("signBuilderRequest", () => {
  it("refuses while trading is off", async () => {
    await expect(signBuilderRequest({ method: "POST", path: "/submit", body: "{}" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns the four Builder headers signed over timestamp, method, path and body", async () => {
    stubCredentials(FAKE);
    const at = new Date("2026-11-03T12:00:00Z");
    const headers = await signBuilderRequest({ method: "post", path: "/submit", body: '{"a":1}' }, at);
    const timestamp = Math.floor(at.getTime() / 1000);
    expect(headers).toEqual({
      POLY_BUILDER_API_KEY: "test-key",
      POLY_BUILDER_PASSPHRASE: "test-pass",
      POLY_BUILDER_TIMESTAMP: String(timestamp),
      POLY_BUILDER_SIGNATURE: await buildHmacSignature(
        FAKE.POLYMARKET_BUILDER_SECRET,
        timestamp,
        "POST",
        "/submit",
        '{"a":1}',
      ),
    });
  });

  it("signs a GET with no body", async () => {
    stubCredentials(FAKE);
    const headers = await signBuilderRequest({ method: "GET", path: "/v1/account/transactions/123?x=1" });
    expect(headers.POLY_BUILDER_SIGNATURE).toBeTruthy();
    await expect(signBuilderRequest({ method: "GET", path: "/deployed?address=0xabc" })).resolves.toBeTruthy();
  });

  it.each([
    { method: "PUT", path: "/submit" },
    { method: "POST", path: "https://evil.example/submit" },
    { method: "POST", path: "/a/../b" },
    { method: "POST", path: "submit" },
    { method: "POST", path: "/submit", body: "x".repeat(100_001) },
    // Well-formed, but not a relayer call the trade panel needs.
    { method: "POST", path: "/v1/session-signers/authorizations", body: "{}" },
    { method: "GET", path: "/submit" },
    { method: "POST", path: "/order", body: "{}" },
    null,
  ])("rejects a malformed request %#", async (input) => {
    stubCredentials(FAKE);
    await expect(signBuilderRequest(input)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
