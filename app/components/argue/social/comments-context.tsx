"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PositionSide } from "@domain/db/schema";
import type { UserChip } from "@domain/social/types";
import { POSITION_EVENT, type PositionEventDetail } from "./position-state";

/** Page-level state shared by every composer and thread on one argument's comment section. */
export interface CommentsContextValue {
  argumentId: string;
  viewer: UserChip | null;
  /** Signed in, argument open, and no block with its author. */
  canComment: boolean;
  /** Why commenting is unavailable (shown instead of the composer). */
  closedReason: string | null;
  signInHref: string;
  /** The viewer's live free position (kept in sync with the PositionBar on the same page). */
  viewerSide: PositionSide | null;
}

const CommentsContext = createContext<CommentsContextValue | null>(null);

export interface CommentsProviderProps extends Omit<CommentsContextValue, "viewerSide"> {
  initialViewerSide: PositionSide | null;
  children: ReactNode;
}

export function CommentsProvider({ initialViewerSide, children, ...value }: CommentsProviderProps) {
  const [viewerSide, setViewerSide] = useState(initialViewerSide);
  const { argumentId } = value;

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<PositionEventDetail>).detail;
      if (detail?.argumentId === argumentId) setViewerSide(detail.side);
    };
    window.addEventListener(POSITION_EVENT, onChange);
    return () => window.removeEventListener(POSITION_EVENT, onChange);
  }, [argumentId]);

  const { viewer, canComment, closedReason, signInHref } = value;
  const context = useMemo<CommentsContextValue>(
    () => ({ argumentId, viewer, canComment, closedReason, signInHref, viewerSide }),
    [argumentId, viewer, canComment, closedReason, signInHref, viewerSide],
  );
  return <CommentsContext value={context}>{children}</CommentsContext>;
}

export function useComments(): CommentsContextValue {
  const context = useContext(CommentsContext);
  if (!context) throw new Error("useComments must be used inside <CommentsProvider>");
  return context;
}

/** Reply state for one top-level thread. */
export interface ThreadContextValue {
  topLevelId: string;
  /** Open the reply composer answering `commentId` (prefilled with @handle when answering a reply). */
  startReply: (target: { commentId: string; handle: string | null }) => void;
}

export const ThreadContext = createContext<ThreadContextValue | null>(null);

export function useThread(): ThreadContextValue | null {
  return useContext(ThreadContext);
}
