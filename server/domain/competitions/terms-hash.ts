/** Owner: challenges. sha256 of the canonical rules snapshot (design §4.2 `terms_hash`). */
import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { RulesSnapshot } from "@domain/db/json-types";
import { canonicalJson } from "./terms";

export function hashTerms(snapshot: RulesSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/** Constant-time comparison of two hex hashes. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
