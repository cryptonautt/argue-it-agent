import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";
import { extractMentionHandles, mentionsHandle, tokenizeMentions, withLeadingMention } from "./mentions";

describe("mentions", () => {
  it("extracts distinct lowercase handles in order", () => {
    expect(extractMentionHandles("@Ada and @bob_9, then @ada again")).toEqual(["ada", "bob_9"]);
  });

  it("ignores emails, too-short handles and handles glued to words", () => {
    expect(extractMentionHandles("mail ada@example.com or @ab or x@carl or @@dave")).toEqual([]);
  });

  it("matches at the start, after punctuation and before punctuation", () => {
    expect(extractMentionHandles("@first, (@second) @third!")).toEqual(["first", "second", "third"]);
  });

  it("caps the number of mentions", () => {
    const text = Array.from({ length: 15 }, (_, i) => `@user_${i}`).join(" ");
    expect(extractMentionHandles(text)).toHaveLength(10);
  });

  it("prefixes the answered handle only when it is not already mentioned", () => {
    expect(withLeadingMention("good point", "Ada")).toBe("@ada good point");
    expect(withLeadingMention("@ADA good point", "ada")).toBe("@ADA good point");
    expect(mentionsHandle("thanks @ada!", "ada")).toBe(true);
  });

  it("tokenizes text and mentions for rendering", () => {
    expect(tokenizeMentions("hi @ada, see ada@x.com")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "mention", text: "@ada", handle: "ada" },
      { kind: "text", text: ", see ada@x.com" },
    ]);
    expect(tokenizeMentions("")).toEqual([]);
  });
});

describe("keyset cursor", () => {
  it("round-trips", () => {
    const cursor = { createdAt: new Date("2026-10-31T10:00:00.123Z"), id: "0192f3c4-1b2a-7c3d-8e4f-5a6b7c8d9e0f" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects garbage without throwing", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-31T10:00:00Z|nope").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("yesterday|0192f3c4-1b2a-7c3d-8e4f-5a6b7c8d9e0f").toString("base64url"))).toBeNull();
  });
});
