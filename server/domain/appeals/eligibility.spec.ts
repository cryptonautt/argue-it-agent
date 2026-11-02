import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@domain/lib/time";
import { appealWindowClosesAt, getAppealEligibility, type EligibilityAppeal, type EligibilityInput } from "./eligibility";
import { APPEAL_WINDOW_HOURS } from "./rules";

const ADA = "user-ada";
const BAYO = "user-bayo";
const verdictAt = new Date("2026-10-05T10:00:00Z");
const verdict = { id: "verdict-1", createdAt: verdictAt };
const at = (hoursAfterVerdict: number) => new Date(verdictAt.getTime() + hoursAfterVerdict * HOUR_MS);

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    viewerId: ADA,
    participantIds: [ADA, BAYO],
    competitionStatus: "completed",
    currentVerdict: verdict,
    appeals: [],
    at: at(1),
    ...overrides,
  };
}

function appeal(overrides: Partial<EligibilityAppeal> = {}): EligibilityAppeal {
  return { id: "appeal-1", appellantId: BAYO, verdictId: verdict.id, status: "open", decidedAt: null, ...overrides };
}

describe("getAppealEligibility", () => {
  it("lets a participant appeal a completed verdict inside the window", () => {
    const result = getAppealEligibility(input());
    expect(result).toEqual({ eligible: true, closesAt: at(APPEAL_WINDOW_HOURS) });
  });

  it("requires a signed-in participant", () => {
    expect(getAppealEligibility(input({ viewerId: null }))).toMatchObject({ eligible: false, reason: "signed_out" });
    expect(getAppealEligibility(input({ viewerId: "someone-else" }))).toMatchObject({
      eligible: false,
      reason: "not_participant",
    });
  });

  it("closes exactly 48 hours after the verdict", () => {
    expect(getAppealEligibility(input({ at: at(47.99) })).eligible).toBe(true);
    expect(getAppealEligibility(input({ at: at(48) }))).toMatchObject({ eligible: false, reason: "window_closed" });
    expect(getAppealEligibility(input({ at: at(100) }))).toMatchObject({ eligible: false, reason: "window_closed" });
  });

  it("allows only one appeal per participant, whatever happened to it", () => {
    for (const status of ["open", "upheld", "reevaluated", "overturned"] as const) {
      const result = getAppealEligibility(
        input({ appeals: [appeal({ appellantId: ADA, status })], competitionStatus: "completed" }),
      );
      expect(result).toMatchObject({ eligible: false, reason: "already_appealed" });
    }
  });

  it("blocks a second appeal while the opponent's appeal is being reviewed", () => {
    const result = getAppealEligibility(input({ competitionStatus: "under_appeal", appeals: [appeal()] }));
    expect(result).toMatchObject({ eligible: false, reason: "appeal_in_progress" });
  });

  it("needs a completed competition with a current verdict", () => {
    for (const status of ["evaluating", "needs_review", "active", "cancelled"] as const) {
      expect(getAppealEligibility(input({ competitionStatus: status }))).toMatchObject({
        eligible: false,
        reason: "no_verdict",
      });
    }
    expect(getAppealEligibility(input({ currentVerdict: null }))).toMatchObject({ eligible: false, reason: "no_verdict" });
  });

  it("restarts the window when the opponent's appeal on the same verdict was upheld", () => {
    const upheld = appeal({ status: "upheld", decidedAt: at(40) });
    // 60h after the verdict, but only 20h after the uphold → still open for Ada.
    const result = getAppealEligibility(input({ appeals: [upheld], at: at(60) }));
    expect(result).toEqual({ eligible: true, closesAt: at(40 + APPEAL_WINDOW_HOURS) });
  });

  it("does not extend the window for decisions on an older verdict", () => {
    const old = appeal({ verdictId: "verdict-0", status: "upheld", decidedAt: at(40) });
    expect(appealWindowClosesAt(verdict, [old])).toEqual(at(APPEAL_WINDOW_HOURS));
  });

  it("a re-evaluated verdict gets its own fresh window", () => {
    const newVerdict = { id: "verdict-2", createdAt: at(30) };
    const reevaluated = appeal({ status: "reevaluated", decidedAt: at(10) });
    const result = getAppealEligibility(input({ currentVerdict: newVerdict, appeals: [reevaluated], at: at(70) }));
    expect(result).toEqual({ eligible: true, closesAt: at(30 + APPEAL_WINDOW_HOURS) });
  });
});
