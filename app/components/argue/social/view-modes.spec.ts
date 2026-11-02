import { describe, expect, it } from "vitest";

import { commentClosedReason, positionModeFor, reactionModeFor, signInHrefFor } from "./view-modes";

const viewer = { id: "u1" };
const open = { authorId: "u2", open: true };

describe("view modes (ported from the reference server components)", () => {
  it("position mode: signed-out, closed, blocked, open", () => {
    expect(positionModeFor(null, open, false)).toBe("signed-out");
    expect(positionModeFor(viewer, { ...open, open: false }, false)).toBe("closed");
    expect(positionModeFor(viewer, open, true)).toBe("blocked");
    expect(positionModeFor(viewer, open, false)).toBe("open");
  });

  it("reaction mode: own post wins over closed; closed or blocked disables", () => {
    expect(reactionModeFor(null, open, false)).toBe("signed-out");
    expect(reactionModeFor({ id: "u2" }, { ...open, open: false }, false)).toBe("own");
    expect(reactionModeFor(viewer, { ...open, open: false }, false)).toBe("disabled");
    expect(reactionModeFor(viewer, open, true)).toBe("disabled");
    expect(reactionModeFor(viewer, open, false)).toBe("open");
  });

  it("comment closed reason follows the reference precedence", () => {
    expect(commentClosedReason(false, true, true)).toBe("This argument is closed to new comments.");
    expect(commentClosedReason(true, true, true)).toBe("You can't comment on this argument.");
    expect(commentClosedReason(true, false, true)).toBe("Your account is suspended. You can read, but not post.");
    expect(commentClosedReason(true, false, false)).toBeNull();
  });

  it("sign-in href returns to the argument", () => {
    expect(signInHrefFor("abc")).toBe("/sign-in?next=%2Fa%2Fabc");
  });
});
