import { describe, expect, it } from "vitest";
import {
  MODERATION_REASON_CODES,
  REASON_INFO,
  USER_REPORT_REASONS,
  allowedContentActions,
  canChangeRole,
  canModerate,
  canSuspendFor,
  describeActionForAuthor,
  nextStatus,
  panelActions,
  suspensionHours,
} from "./policy";

const user = { id: "u1", role: "user" as const };
const otherUser = { id: "u2", role: "user" as const };
const moderator = { id: "m1", role: "moderator" as const };
const otherModerator = { id: "m2", role: "moderator" as const };
const admin = { id: "a1", role: "admin" as const };
const otherAdmin = { id: "a2", role: "admin" as const };

describe("report reasons", () => {
  it("offers people the design §4.7 reasons, but not the judge-only prompt_injection", () => {
    expect([...USER_REPORT_REASONS].sort()).toEqual(
      ["doxxing", "harassment", "hate", "impersonation", "malicious_link", "other", "spam", "threats"].sort(),
    );
    expect(USER_REPORT_REASONS).not.toContain("prompt_injection");
    expect(MODERATION_REASON_CODES).toContain("prompt_injection");
  });

  it("ranks threats and doxxing as most urgent", () => {
    expect(REASON_INFO.threats.severity).toBeLessThan(REASON_INFO.spam.severity);
    expect(REASON_INFO.doxxing.severity).toBe(0);
    expect(REASON_INFO.other.severity).toBeGreaterThan(REASON_INFO.harassment.severity);
  });
});

describe("content actions", () => {
  it("follows the visible → hidden → removed → restored state machine", () => {
    expect(allowedContentActions({ type: "comment", status: "visible" })).toEqual(["hide", "remove"]);
    expect(allowedContentActions({ type: "argument", status: "hidden" })).toEqual(["remove", "restore"]);
    expect(allowedContentActions({ type: "submission", status: "removed" })).toEqual(["restore"]);
    expect(nextStatus("hide")).toBe("hidden");
    expect(nextStatus("remove")).toBe("removed");
    expect(nextStatus("restore")).toBe("visible");
  });

  it("profiles can only have their bio/photo cleared", () => {
    expect(allowedContentActions({ type: "profile", status: null, hasProfileContent: true })).toEqual(["remove"]);
    expect(allowedContentActions({ type: "profile", status: null, hasProfileContent: false })).toEqual([]);
  });
});

describe("who may moderate whom", () => {
  it("never lets anyone moderate themselves", () => {
    expect(canModerate(moderator, moderator).allowed).toBe(false);
    expect(canModerate(admin, admin).allowed).toBe(false);
  });

  it("users cannot moderate", () => {
    expect(canModerate(user, otherUser)).toEqual({ allowed: false, reason: "Only moderators can do that." });
  });

  it("moderators act on ordinary users only", () => {
    expect(canModerate(moderator, user).allowed).toBe(true);
    expect(canModerate(moderator, otherModerator).allowed).toBe(false);
    expect(canModerate(moderator, admin).allowed).toBe(false);
  });

  it("admins act on anyone but themselves", () => {
    expect(canModerate(admin, user).allowed).toBe(true);
    expect(canModerate(admin, moderator).allowed).toBe(true);
    expect(canModerate(admin, otherAdmin).allowed).toBe(true);
  });

  it("only admins suspend indefinitely", () => {
    expect(canSuspendFor(moderator, "7d").allowed).toBe(true);
    expect(canSuspendFor(moderator, "indefinite").allowed).toBe(false);
    expect(canSuspendFor(admin, "indefinite").allowed).toBe(true);
    expect(suspensionHours("7d")).toBe(168);
    expect(suspensionHours("indefinite")).toBeNull();
  });
});

describe("role changes", () => {
  it("is admin-only and never self-service", () => {
    expect(canChangeRole(moderator, user, "moderator", 2).allowed).toBe(false);
    expect(canChangeRole(admin, admin, "user", 2).allowed).toBe(false);
    expect(canChangeRole(admin, user, "moderator", 1).allowed).toBe(true);
  });

  it("protects the last admin and rejects no-op changes", () => {
    expect(canChangeRole(admin, otherAdmin, "user", 1)).toMatchObject({ allowed: false });
    expect(canChangeRole(admin, otherAdmin, "user", 2).allowed).toBe(true);
    expect(canChangeRole(admin, moderator, "moderator", 3)).toMatchObject({ allowed: false });
  });
});

describe("author-facing copy", () => {
  it("is plain and never names the moderator", () => {
    expect(describeActionForAuthor("hide", "comment", "spam")).toBe("A moderator hid your comment for spam.");
    expect(describeActionForAuthor("remove", "profile", "impersonation")).toContain("cleared your bio and photo");
    expect(describeActionForAuthor("suspend", "user", "harassment")).toContain("You can still read");
  });
});

describe("panelActions", () => {
  const author = { id: "u1", role: "user" as const, status: "active" as const, suspended: false };

  it("offers content + account actions and dismiss for an open report", () => {
    const { actions } = panelActions({
      actor: moderator,
      author,
      target: { type: "comment", status: "visible" },
      report: { open: true, reporterId: "someone" },
    });
    expect(actions).toEqual(["hide", "remove", "warn", "suspend", "dismiss"]);
  });

  it("offers unsuspend for a suspended author and nothing on staff for moderators", () => {
    expect(panelActions({ actor: moderator, author: { ...author, status: "suspended", suspended: true } }).actions).toEqual([
      "warn",
      "unsuspend",
    ]);
    expect(panelActions({ actor: moderator, author: { ...author, id: "a9", role: "admin" } })).toEqual({
      actions: [],
      restriction: "Only an admin can moderate a staff member.",
    });
  });

  it("won't let you handle a report you filed", () => {
    const result = panelActions({ actor: moderator, author, target: { type: "comment", status: "visible" }, report: { open: true, reporterId: moderator.id } });
    expect(result.actions).toEqual([]);
    expect(result.restriction).toMatch(/another moderator/);
  });
});
