import { describe, expect, it } from "vitest";

import { reviveDates } from "./server-actions-dates";

describe("reviveDates", () => {
  it("revives ISO timestamps on moment keys, deeply", () => {
    const out = reviveDates({
      createdAt: "2026-11-02T10:00:00.000Z",
      items: [{ lockedAt: "2026-11-02T10:00:00Z", suspendedUntil: "2026-11-03T00:00:00+01:00" }],
      appeal: { deadline: "2026-11-04T10:00:00.000Z" },
    });
    expect(out.createdAt).toBeInstanceOf(Date);
    expect((out.createdAt as unknown as Date).toISOString()).toBe("2026-11-02T10:00:00.000Z");
    expect(out.items[0]?.lockedAt).toBeInstanceOf(Date);
    expect(out.items[0]?.suspendedUntil).toBeInstanceOf(Date);
    expect(out.appeal.deadline).toBeInstanceOf(Date);
  });

  it("leaves other strings alone", () => {
    const input = {
      title: "2026-11-02T10:00:00.000Z",
      createdAt: "yesterday",
      editedAt: null,
      body: "On 2026-11-02 the vote happened",
    };
    expect(reviveDates(input)).toEqual(input);
  });

  it("passes primitives and null through", () => {
    expect(reviveDates(null)).toBeNull();
    expect(reviveDates(3)).toBe(3);
    expect(reviveDates("2026-11-02T10:00:00.000Z")).toBe("2026-11-02T10:00:00.000Z");
  });
});
