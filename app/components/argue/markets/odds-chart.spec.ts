import { describe, expect, it } from "vitest";

import { trimCreationRun } from "./odds-chart";

const pts = (...ps: number[]) => ps.map((p, i) => ({ t: i, p }));

describe("trimCreationRun", () => {
  it("drops a single leading 50% creation point", () => {
    expect(trimCreationRun(pts(0.5, 0.085, 0.09))).toEqual([
      { t: 1, p: 0.085 },
      { t: 2, p: 0.09 },
    ]);
  });

  it("drops a longer leading 50% run", () => {
    expect(trimCreationRun(pts(0.5, 0.5, 0.5, 0.3, 0.31)).map((pt) => pt.p)).toEqual([0.3, 0.31]);
  });

  it("keeps series that start elsewhere, never leave 50%, or would be left with one point", () => {
    expect(trimCreationRun(pts(0.4, 0.5))).toEqual(pts(0.4, 0.5));
    expect(trimCreationRun(pts(0.5, 0.5, 0.5))).toEqual(pts(0.5, 0.5, 0.5));
    expect(trimCreationRun(pts(0.5, 0.5, 0.2))).toEqual(pts(0.5, 0.5, 0.2));
  });
});
