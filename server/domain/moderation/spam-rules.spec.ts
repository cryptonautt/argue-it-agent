import { describe, expect, it } from "vitest";
import {
  BLOCK_THRESHOLD,
  REVIEW_THRESHOLD,
  combineWeights,
  evaluateSpam,
  extractUrls,
  normalizeForDuplicate,
  similarity,
  summarizeAssessment,
  type RecentItem,
  type SpamInput,
} from "./spam-rules";

const NOW = new Date("2026-10-31T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function input(overrides: Partial<SpamInput> = {}): SpamInput {
  return { text: "", links: [], recentOwn: [], crossUserDuplicateAuthors: 0, now: NOW, ...overrides };
}

const post = (text: string, minutes: number, links: string[] = []): RecentItem => ({ text, links, createdAt: minutesAgo(minutes) });

const TAKE = "Arsenal will win the league this season because their midfield finally has real depth and control.";

describe("normal posts are allowed", () => {
  it("allows an ordinary heated take", () => {
    const result = evaluateSpam(input({ text: "Na lie! Messi no reach Ronaldo for big UCL nights. Check the numbers." }));
    expect(result).toMatchObject({ decision: "allow", score: 0, message: null });
  });

  it("allows short repeated reactions like 'Facts 💯'", () => {
    const recent = [post("Facts 💯", 1), post("Facts 💯", 2), post("facts 💯", 3)];
    expect(evaluateSpam(input({ text: "Facts 💯", recentOwn: recent })).decision).toBe("allow");
  });

  it("allows an ordinary crypto opinion with one link", () => {
    const result = evaluateSpam(
      input({ text: "BTC will hit a new high after the halving cycle, history says so.", links: ["https://coinmarketcap.com/"] }),
    );
    expect(result.decision).toBe("allow");
  });

  it("allows a few posts spread over time", () => {
    const recent = [post("one", 3), post("two", 8), post("three", 30)];
    expect(evaluateSpam(input({ text: TAKE, recentOwn: recent })).decision).toBe("allow");
  });
});

describe("duplicate content", () => {
  it("blocks posting the same text again within 10 minutes (double post)", () => {
    const result = evaluateSpam(input({ text: TAKE, recentOwn: [post(TAKE, 2)] }));
    expect(result.decision).toBe("block");
    expect(result.message).toMatch(/already posted this/);
  });

  it("flags for review when the same text was posted once earlier today", () => {
    const result = evaluateSpam(input({ text: TAKE.toUpperCase(), recentOwn: [post(TAKE, 120)] }));
    expect(result.decision).toBe("review");
    expect(result.signals.map((s) => s.code)).toContain("duplicate_self");
  });

  it("blocks the third copy in 24h", () => {
    const result = evaluateSpam(input({ text: TAKE, recentOwn: [post(TAKE, 300), post(TAKE, 600)] }));
    expect(result.decision).toBe("block");
  });

  it("ignores copies older than 24 hours", () => {
    const result = evaluateSpam(input({ text: TAKE, recentOwn: [post(TAKE, 25 * 60)] }));
    expect(result.decision).toBe("allow");
  });

  it("detects near-duplicates (small edits) as a weaker signal", () => {
    const edited = TAKE.replace("this season", "this year");
    const result = evaluateSpam(input({ text: edited, recentOwn: [post(TAKE, 60), post(TAKE.replace("real", "proper"), 90)] }));
    expect(result.signals.find((s) => s.code === "near_duplicate_self")).toBeDefined();
  });

  it("matches against alternate texts (an argument body under a new title)", () => {
    const recent: RecentItem[] = [{ text: `Old title\nProp\n${TAKE}`, altTexts: [TAKE], links: [], createdAt: minutesAgo(90) }];
    expect(evaluateSpam(input({ text: TAKE, recentOwn: recent })).signals[0]?.code).toBe("duplicate_self");
  });

  it("flags coordinated copy-paste across accounts", () => {
    expect(evaluateSpam(input({ text: TAKE, crossUserDuplicateAuthors: 1 })).decision).toBe("allow");
    expect(evaluateSpam(input({ text: TAKE, crossUserDuplicateAuthors: 2 })).decision).toBe("review");
    expect(evaluateSpam(input({ text: TAKE, crossUserDuplicateAuthors: 5 })).signals[0]).toMatchObject({
      code: "duplicate_cross_user",
      weight: 0.8,
    });
  });
});

describe("links", () => {
  it("flags link-heavy posts with little text", () => {
    const text = "see https://a.example.com/1 https://b.example.com/2 https://c.example.com/3";
    const result = evaluateSpam(input({ text }));
    expect(result.signals.map((s) => s.code)).toContain("link_heavy");
  });

  it("does not flag three links inside a long, substantive argument", () => {
    const body = `${"The stats clearly show a pattern over five seasons of top-flight football. ".repeat(4)}`;
    const result = evaluateSpam(
      input({ text: body, links: ["https://fbref.com/a", "https://whoscored.com/b", "https://transfermarkt.com/c"] }),
    );
    expect(result.signals.map((s) => s.code)).not.toContain("link_heavy");
  });

  it("flags link shorteners and the same link pushed across posts", () => {
    const link = "https://bit.ly/free-airdrop";
    const recent = [post(`claim ${link}`, 5), post(`go ${link}`, 30)];
    const result = evaluateSpam(input({ text: `hurry ${link}`, recentOwn: recent }));
    const codes = result.signals.map((s) => s.code);
    expect(codes).toContain("link_shortener");
    expect(codes).toContain("repeated_link");
    expect(result.decision).not.toBe("allow");
  });

  it("extracts http(s) and www. urls from text", () => {
    expect(extractUrls("go to www.example.com or https://x.io/a?b=1.")).toEqual(["www.example.com", "https://x.io/a?b=1."]);
  });
});

describe("burst posting", () => {
  it("blocks the 6th post inside a minute", () => {
    const recent = [0.1, 0.2, 0.3, 0.5, 0.8].map((m, i) => post(`post ${i}`, m));
    const result = evaluateSpam(input({ text: "another one", recentOwn: recent }));
    expect(result.decision).toBe("block");
    expect(result.message).toMatch(/posting very fast/);
  });

  it("flags (but allows) a busy 10 minutes", () => {
    const recent = Array.from({ length: 10 }, (_, i) => post(`reply ${i}`, 1 + i * 0.8));
    const result = evaluateSpam(input({ text: "and another", recentOwn: recent }));
    expect(result.decision).toBe("review");
  });
});

describe("text patterns", () => {
  it("contact solicitation alone stays below review", () => {
    expect(evaluateSpam(input({ text: "Whatsapp me 08031234567 for the full gist" })).decision).toBe("allow");
  });

  it("contact + money scheme together go to review", () => {
    const result = evaluateSpam(input({ text: "Guaranteed profit daily! Whatsapp me on +234 803 123 4567 to double your money" }));
    expect(result.decision).toBe("review");
    expect(result.signals.map((s) => s.code).sort()).toEqual(["contact_solicitation", "money_scheme"]);
  });
});

describe("scoring helpers", () => {
  it("combines weights as a noisy-OR", () => {
    expect(combineWeights([])).toBe(0);
    expect(combineWeights([0.5, 0.5])).toBe(0.75);
    expect(combineWeights([0.9])).toBeGreaterThanOrEqual(BLOCK_THRESHOLD);
    expect(combineWeights([0.3])).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("normalises and compares text", () => {
    expect(normalizeForDuplicate("  Hello\n\tWORLD  ")).toBe("hello world");
    expect(similarity(TAKE, TAKE)).toBe(1);
    expect(similarity(TAKE, "Completely unrelated sentence about Nollywood films and actors.")).toBeLessThan(0.1);
    expect(similarity(TAKE, "Chelsea will win the league this season because their attack has real depth.")).toBeLessThan(0.85);
  });

  it("summarises an assessment for moderators", () => {
    const result = evaluateSpam(input({ text: TAKE, crossUserDuplicateAuthors: 3 }));
    expect(summarizeAssessment(result)).toMatch(/^Automatic spam check \(score 0\.50\)/);
  });
});
