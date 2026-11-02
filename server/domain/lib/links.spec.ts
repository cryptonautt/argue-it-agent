import { describe, expect, it } from "vitest";
import { MAX_LINKS, displayLink, linksSchema, parseLinkList, validateLink, validateLinks } from "./links";

describe("validateLink", () => {
  it.each(["https://bbc.com/sport", "http://example.org", "  https://www.goal.com/en/news  "])("accepts %s", (url) => {
    expect(validateLink(url).ok).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com",
    "mailto:a@b.com",
    "not a url",
    "https://localhost",
    "https://user:pass@example.com",
    "",
  ])("rejects %s", (url) => {
    expect(validateLink(url).ok).toBe(false);
  });

  it("rejects very long links", () => {
    expect(validateLink(`https://example.com/${"a".repeat(2100)}`).ok).toBe(false);
  });
});

describe("validateLinks", () => {
  it("drops blanks and de-duplicates", () => {
    expect(validateLinks(["https://a.com", "", "https://a.com", " "])).toEqual({ ok: true, links: ["https://a.com/"] });
  });

  it(`allows at most ${MAX_LINKS} links`, () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://site${i}.com`);
    expect(validateLinks(six).ok).toBe(false);
    expect(validateLinks(six.slice(0, 5)).ok).toBe(true);
  });

  it("reports the index of the bad link", () => {
    expect(validateLinks(["https://ok.com", "javascript:void(0)"])).toMatchObject({ ok: false, index: 1 });
  });
});

describe("linksSchema", () => {
  it("normalises valid input and defaults to []", () => {
    expect(linksSchema.parse(undefined)).toEqual([]);
    expect(linksSchema.parse(["https://x.com"])).toEqual(["https://x.com/"]);
  });

  it("fails with a message on unsafe input", () => {
    const result = linksSchema.safeParse(["data:x"]);
    expect(result.success).toBe(false);
  });
});

it("parseLinkList splits on whitespace and commas", () => {
  expect(parseLinkList("https://a.com\nhttps://b.com, https://c.com")).toEqual([
    "https://a.com",
    "https://b.com",
    "https://c.com",
  ]);
});

it("displayLink shortens", () => {
  expect(displayLink("https://www.example.com/")).toBe("example.com");
  expect(displayLink("https://example.com/a/very/long/path/that/keeps/going/and/going", 20)).toHaveLength(20);
});
