import { describe, expect, it } from "vitest";
import { handleSchema, normalizeHandle } from "./handles";
import { safeRedirectPath } from "./redirect";

describe("handleSchema", () => {
  it.each(["ada", "naija_baller", "abc123", "a_b_c_d_e_f_g_h_i_j_"])("accepts %s", (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });

  it("normalises case and a leading @", () => {
    expect(handleSchema.parse("@Ada_Lovelace")).toBe("ada_lovelace");
    expect(normalizeHandle("  @X  ")).toBe("x");
  });

  it.each(["ab", "a".repeat(21), "has space", "dash-ed", "émile", "admin", "judge", "deleted_0123abcd4567"])("rejects %s", (h) => {
    expect(handleSchema.safeParse(h).success).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/a/123", "/a/123"],
    ["/settings?tab=blocked", "/settings?tab=blocked"],
    [undefined, "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/a\\b", "/"],
    ["/" + "a".repeat(2100), "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});
