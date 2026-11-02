import { describe, expect, it } from "vitest";

import {
  challengeTargetFrom,
  isViewerSuspended,
  normaliseArgumentPage,
  normaliseViewer,
} from "./screen-a";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

/** Shape of `get-argument` output after JSON (dates are ISO strings, see docs/port-notes.md "## 4-actions"). */
function getArgumentJson(overrides: Record<string, unknown> = {}) {
  return {
    visibility: "full",
    argument: {
      id: "33333333-3333-4333-8333-333333333333",
      status: "visible",
      title: "Jollof is better with firewood",
      proposition: "Firewood jollof beats stove jollof",
      body: "Smoke is an ingredient.",
      links: [],
      createdAt: "2026-11-01T10:00:00.000Z",
      editedAt: null,
      removedBy: null,
      locked: false,
      authorId: AUTHOR,
      author: { id: AUTHOR, handle: "emeka", displayName: "Emeka O", avatarUrl: null },
      category: { id: "c1", slug: "food", name: "Food" },
      viewerBlockedAuthor: false,
      authorBlockedViewer: false,
    },
    viewer: { id: VIEWER, role: "user", handle: "ada", status: "active" },
    positions: { agree: 1, against: 0, viewerSide: null },
    challenges: [],
    comments: { threads: [], nextCursor: null, total: 4 },
    reaction: { count: 2, viewerReacted: true, extra: "ignored" },
    follow: null,
    hasOpenDebates: false,
    ...overrides,
  };
}

describe("normaliseArgumentPage (get-argument output)", () => {
  it("reads the extras get-argument returns: comment total, reaction and viewer id", () => {
    const page = normaliseArgumentPage(getArgumentJson());
    expect(page).not.toBeNull();
    expect(page!.commentTotal).toBe(4);
    expect(page!.comments).toEqual({ threads: [], nextCursor: null });
    expect(page!.reaction).toEqual({ count: 2, viewerReacted: true });
    expect(page!.viewerId).toBe(VIEWER);
  });

  it("revives ArgumentDetail dates from ISO strings", () => {
    const page = normaliseArgumentPage(getArgumentJson())!;
    expect(page.argument.createdAt).toBeInstanceOf(Date);
    expect((page.argument.createdAt as Date).toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  it("leaves missing extras as null, never zero", () => {
    const page = normaliseArgumentPage(
      getArgumentJson({ comments: undefined, reaction: undefined, viewer: undefined, positions: undefined }),
    )!;
    expect(page.commentTotal).toBeNull();
    expect(page.comments).toBeNull();
    expect(page.reaction).toBeNull();
    expect(page.viewerId).toBeNull();
    expect(page.positions).toBeNull();
  });
});

describe("challengeTargetFrom", () => {
  const query = { commentId: null, opponentId: null };

  it("defaults the opponent to the author for another viewer", () => {
    const target = challengeTargetFrom(normaliseArgumentPage(getArgumentJson())!, query, VIEWER);
    expect(typeof target).not.toBe("string");
    if (typeof target === "string") return;
    expect(target.opponent?.userId).toBe(AUTHOR);
    expect(target.opponentFixed).toBe(false);
  });

  it("gives the author no default opponent (they type a handle)", () => {
    const target = challengeTargetFrom(normaliseArgumentPage(getArgumentJson())!, query, AUTHOR);
    if (typeof target === "string") throw new Error(target);
    expect(target.opponent).toBeNull();
  });
});

describe("normaliseViewer (get-session output) and isViewerSuspended", () => {
  const session = {
    id: VIEWER,
    role: "user",
    status: "active",
    suspendedUntil: null,
    handle: "ada",
    displayName: "Ada Obi",
    avatarUrl: null,
  };

  it("null (signed out) stays null; a malformed result is unknown", () => {
    expect(normaliseViewer(null)).toBeNull();
    expect(normaliseViewer({ nope: true })).toBeUndefined();
  });

  it("shapes the session and parses suspendedUntil", () => {
    const viewer = normaliseViewer({ ...session, status: "suspended", suspendedUntil: "2026-11-05T00:00:00.000Z" })!;
    expect(viewer.handle).toBe("ada");
    expect(viewer.suspendedUntil).toBeInstanceOf(Date);
  });

  it("is suspended only while the suspension runs (or when it has no end)", () => {
    const at = new Date("2026-11-02T12:00:00.000Z");
    const active = normaliseViewer({ ...session, status: "suspended", suspendedUntil: "2026-11-05T00:00:00.000Z" });
    const expired = normaliseViewer({ ...session, status: "suspended", suspendedUntil: "2026-11-01T00:00:00.000Z" });
    const indefinite = normaliseViewer({ ...session, status: "suspended", suspendedUntil: null });
    expect(isViewerSuspended(active, at)).toBe(true);
    expect(isViewerSuspended(expired, at)).toBe(false);
    expect(isViewerSuspended(indefinite, at)).toBe(true);
    expect(isViewerSuspended(normaliseViewer(session), at)).toBe(false);
    expect(isViewerSuspended(undefined, at)).toBe(false);
  });
});
