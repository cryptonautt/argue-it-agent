/**
 * Quote validation (design §4.3.2): the judge cannot invent support for a score. Owner: fairness.
 */
import { describe, expect, it } from "vitest";
import { validateQuotes } from "@domain/judging";

const SOURCE =
  "At the end of the day, \"goals win games\". Penalty shootout no be pure luck at all.\n\nNa preparation and skill dey win am — and [Side B] knows it.";

describe("validateQuotes", () => {
  it("accepts an exact substring", () => {
    expect(validateQuotes(["Penalty shootout no be pure luck at all."], SOURCE)).toEqual({
      valid: ["Penalty shootout no be pure luck at all."],
      invalid: [],
    });
  });

  it("ignores differences in whitespace, line breaks and letter case", () => {
    const quote = "pure LUCK at all. na   preparation";
    expect(validateQuotes([quote], SOURCE).valid).toEqual([quote]);
  });

  it("accepts typographic quotes and dashes the judge may substitute", () => {
    expect(validateQuotes(["“goals win games”", "skill dey win am - and"], SOURCE).invalid).toEqual([]);
  });

  it("accepts excerpts wrapped in ellipses", () => {
    expect(validateQuotes(["...goals win games...", "… Na preparation …"], SOURCE).invalid).toEqual([]);
  });

  it("accepts quotes that include a redaction token", () => {
    expect(validateQuotes(["[Side B] knows it"], SOURCE).valid).toHaveLength(1);
  });

  it("rejects paraphrases, invented text and changed words", () => {
    const result = validateQuotes(["goals lose games", "Penalty shootouts are not luck", "skill and preparation win it"], SOURCE);
    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(3);
  });

  it("rejects quotes too short to prove anything", () => {
    expect(validateQuotes(["na", "  ", ""], SOURCE).valid).toEqual([]);
  });

  it("rejects a quote stitched across non-adjacent parts of the text", () => {
    expect(validateQuotes(["goals win games. Na preparation"], SOURCE).valid).toEqual([]);
  });

  it("rejects the OTHER side's words (attribution matters)", () => {
    const otherSide = "Pens are literally just luck lol.";
    expect(validateQuotes([otherSide], SOURCE).valid).toEqual([]);
  });

  it("keeps input order and splits valid from invalid", () => {
    const result = validateQuotes(["skill dey win am", "made up", "goals win games"], SOURCE);
    expect(result).toEqual({ valid: ["skill dey win am", "goals win games"], invalid: ["made up"] });
  });

  it("is case-insensitive for Pidgin and accented text alike", () => {
    expect(validateQuotes(["ọlá adébáyọ̀ said"], "Ọlá Adébáyọ̀ said so").valid).toHaveLength(1);
  });
});
