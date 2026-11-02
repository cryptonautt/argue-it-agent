import type { PositionSummary } from "@domain/social/types";
import { PositionPicker, type PositionPickerMode } from "./position-picker";
import { signInHrefFor } from "./view-modes";

export interface PositionBarProps {
  argumentId: string;
  /** Loader-fed (reference `getPositionSummary(argumentId, viewerId)`). */
  summary: PositionSummary;
  /** Loader-fed; compute with `positionModeFor` from ./view-modes. */
  mode: PositionPickerMode;
}

/**
 * AGREE / AGAINST counts for an argument plus the viewer's pick-a-side buttons (design §4.1).
 * Positions are free and changeable — clearly labelled as NOT a competition entry.
 * Ported from an async server component: data now arrives as props from the route loader.
 */
export function PositionBar({ argumentId, summary, mode }: PositionBarProps) {
  return <PositionPicker initial={summary} mode={mode} signInHref={signInHrefFor(argumentId)} />;
}
