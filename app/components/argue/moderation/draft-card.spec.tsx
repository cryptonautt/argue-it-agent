// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { approvalCall, draftRequest, TRIAGE_REQUEST } from "./draft-card";

const base = { id: "d1", outcome: null } as const;

describe("draft card wiring", () => {
  it("Draft with agent sends an explicit id and the debate title", () => {
    expect(draftRequest("appeal", "ap-1", "Messi > Ronaldo")).toEqual({
      message: "Draft a decision for this appeal",
      context: "appeal id: ap-1\nDebate: Messi > Ronaldo",
      submit: true,
      openSidebar: true,
    });
    expect(TRIAGE_REQUEST).toMatchObject({ message: "Triage the review queue", submit: true, openSidebar: true });
  });

  it("Approve calls the same decision actions with the draftId", () => {
    expect(approvalCall({ ...base, kind: "appeal", targetId: "ap-1", recommendation: "uphold" }, "note", "k")).toEqual({
      action: "decide-appeal",
      input: { appealId: "ap-1", decision: "uphold", note: "note", draftId: "d1", idempotencyKey: "k" },
    });
    expect(
      approvalCall({ ...base, kind: "appeal", targetId: "ap-1", recommendation: "overturn", outcome: "B" }, "n", "k").input,
    ).toMatchObject({ decision: "overturn", outcome: "B" });
    expect(approvalCall({ ...base, kind: "review", targetId: "c-1", recommendation: "draw" }, "n", "k")).toEqual({
      action: "resolve-review",
      input: { competitionId: "c-1", outcome: "draw", note: "n", draftId: "d1", idempotencyKey: "k" },
    });
    expect(approvalCall({ ...base, kind: "review", targetId: "c-1", recommendation: "retry" }, "n", "k")).toEqual({
      action: "retry-evaluation",
      input: { competitionId: "c-1", draftId: "d1", idempotencyKey: "k" },
    });
  });
});
