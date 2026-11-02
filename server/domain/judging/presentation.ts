/**
 * Per-pass presentation of a case file (design §4.3.2). Pure.
 *
 * Each pass shows the two sides in a given order under POSITION labels: whoever is presented first is
 * "Side X", second is "Side Y". Pass 1 (AB) shows FOR first; Pass 2 (BA) shows AGAINST first. So any bias
 * the judge has toward the first position, or toward a label, favours each side exactly once across the
 * two passes and cancels out. The canonical labels (A = FOR, B = AGAINST) never appear in the prompt;
 * outputs are mapped back with `toCanonical()` before anything else reads them.
 */
import type { SideLabel } from "@domain/db/json-types";
import type { CaseFile, CaseSide, PassOrder } from "./types";

export type PresentationLabel = "X" | "Y";
export const PRESENTATION_LABELS: readonly PresentationLabel[] = ["X", "Y"];

export interface PresentedSide {
  label: PresentationLabel;
  canonical: SideLabel;
  stance: "FOR" | "AGAINST";
  opening: { text: string; links: string[] } | null;
  rebuttal: { text: string; links: string[] } | null;
}

export interface Presentation {
  order: PassOrder;
  proposition: string;
  category: CaseFile["category"];
  /** In presentation order: [Side X, Side Y]. */
  sides: [PresentedSide, PresentedSide];
  /** Presentation label → canonical label for this pass. */
  toCanonical: Record<PresentationLabel, SideLabel>;
}

const REDACTION_TOKEN = /\[Side ([AB])\]/gu;

/** Rewrite canonical redaction tokens ("[Side A]") into this pass's presentation labels ("[Side Y]"). */
export function relabelRedactionTokens(text: string, toPresentation: Record<SideLabel, PresentationLabel>): string {
  return text.replace(REDACTION_TOKEN, (_m, side: string) => `[Side ${toPresentation[side as SideLabel]}]`);
}

/** Map presentation labels in free text written by the judge back to canonical labels. */
export function canonicaliseJudgeText(text: string, toCanonical: Record<PresentationLabel, SideLabel>): string {
  return text.replace(/\bSide ([XY])\b/gu, (_m, label: string) => `Side ${toCanonical[label as PresentationLabel]}`);
}

/** Map presentation redaction tokens inside a verbatim quote back to canonical tokens (exact inverse). */
export function canonicaliseQuote(text: string, toCanonical: Record<PresentationLabel, SideLabel>): string {
  return text.replace(/\[Side ([XY])\]/gu, (_m, label: string) => `[Side ${toCanonical[label as PresentationLabel]}]`);
}

export function presentCase(caseFile: CaseFile, order: PassOrder): Presentation {
  const firstCanonical: SideLabel = order === "AB" ? "A" : "B";
  const secondCanonical: SideLabel = firstCanonical === "A" ? "B" : "A";
  const toPresentation: Record<SideLabel, PresentationLabel> = order === "AB" ? { A: "X", B: "Y" } : { A: "Y", B: "X" };
  const present = (side: CaseSide, label: PresentationLabel): PresentedSide => ({
    label,
    canonical: side.label,
    stance: side.stance,
    opening: side.opening
      ? { text: relabelRedactionTokens(side.opening.text, toPresentation), links: [...side.opening.links] }
      : null,
    rebuttal: side.rebuttal
      ? { text: relabelRedactionTokens(side.rebuttal.text, toPresentation), links: [...side.rebuttal.links] }
      : null,
  });
  return {
    order,
    proposition: relabelRedactionTokens(caseFile.proposition, toPresentation),
    category: caseFile.category,
    sides: [present(caseFile.sides[firstCanonical], "X"), present(caseFile.sides[secondCanonical], "Y")],
    toCanonical: { X: firstCanonical, Y: secondCanonical },
  };
}

/** The texts a presented side wrote (for quote validation), opening and rebuttal separately. */
export function sideTexts(side: PresentedSide): string[] {
  return [side.opening?.text, side.rebuttal?.text].filter((t): t is string => typeof t === "string" && t.length > 0);
}
