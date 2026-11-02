import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn<(key: string) => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
  getVerdictPageData: vi.fn<(id: string, viewer: unknown) => Promise<unknown>>(),
  getReviewQueue: vi.fn<() => Promise<unknown[]>>(),
  getAppealQueue: vi.fn<() => Promise<{ open: unknown[] }>>(),
}));
vi.mock("@agent-native/core/application-state", () => ({ readAppState: mocks.readAppState }));
vi.mock("@domain/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@domain/appeals/queries", () => ({
  getVerdictPageData: mocks.getVerdictPageData,
  getReviewQueue: mocks.getReviewQueue,
  getAppealQueue: mocks.getAppealQueue,
}));

import viewScreen from "./view-screen";

const run = () => Promise.resolve(viewScreen.run({}, { caller: "tool" })) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ id: "u1", role: "user" });
});

describe("view-screen", () => {
  it("summarises the verdict on screen (proposition, outcome, winner side, scores, appeal deadline)", async () => {
    mocks.readAppState.mockResolvedValue({ view: "verdict", competitionId: "c1", path: "/c/c1/verdict" });
    mocks.getVerdictPageData.mockResolvedValue({
      proposition: "Messi is better than Ronaldo.",
      category: { name: "Sports" },
      status: "completed",
      sides: { A: { displayName: "Ada", handle: "ada", stance: "FOR" }, B: { displayName: "Bayo", handle: "bayo", stance: "AGAINST" } },
      current: {
        outcome: "A",
        outcomeView: { winnerSide: "A", headline: "Ada wins" },
        decidedBy: "ai",
        confidenceLabel: "high",
        scores: { totals: { A: 74.5, B: 61.5 }, criteria: [{ key: "rebuttal", label: "Rebuttal", weight: 20, A: 7, B: 5 }] },
      },
      eligibility: { eligible: false, closesAt: "2026-10-07T10:00:00.000Z" },
      viewer: { side: null },
      appeals: [],
    });
    const screen = await run();
    expect(mocks.getVerdictPageData).toHaveBeenCalledWith("c1", { id: "u1", role: "user" });
    expect(screen.visible).toMatchObject({
      proposition: "Messi is better than Ronaldo.",
      outcome: "A",
      winnerSide: "A",
      appealDeadline: "2026-10-07T10:00:00.000Z",
      criteria: [{ key: "rebuttal", A: 7, B: 5 }],
    });
  });

  it("never throws: a failing lookup falls back to navigation only", async () => {
    const navigation = { view: "verdict", competitionId: "c1", path: "/c/c1/verdict" };
    mocks.readAppState.mockResolvedValue(navigation);
    mocks.getVerdictPageData.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await run()).toEqual({ navigation, visible: null });
  });

  it("shows review-queue counts only to staff", async () => {
    mocks.readAppState.mockResolvedValue({ view: "review-queue", tab: "appeals", path: "/admin/review" });
    expect((await run()).visible).toEqual({ staffOnly: true });
    expect(mocks.getReviewQueue).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValue({ id: "m1", role: "moderator" });
    mocks.getReviewQueue.mockResolvedValue([{ header: { competitionId: "c9", proposition: "P" } }]);
    mocks.getAppealQueue.mockResolvedValue({ open: [] });
    expect((await run()).visible).toMatchObject({
      tab: "appeals",
      counts: { review: 1, appeals: 0 },
      firstReview: [{ competitionId: "c9" }],
    });
  });

  it("returns plain navigation for non-ARGUE screens", async () => {
    mocks.readAppState.mockResolvedValue({ view: "chat", path: "/chat" });
    expect(await run()).toEqual({ navigation: { view: "chat", path: "/chat" } });
  });
});
