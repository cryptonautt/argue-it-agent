/**
 * View models returned by the social module (positions, comments, reactions, follows, blocks).
 * Plain JSON (dates are ISO strings) so they cross the server → client boundary unchanged.
 * Types only: safe to `import type` from client components.
 */
import type { PositionSide, ReactionTarget, ReactionType } from "@domain/db/schema";

export interface PositionSummary {
  argumentId: string;
  agree: number;
  against: number;
  /** The viewer's current free position, or null (signed out / no position). */
  viewerSide: PositionSide | null;
}

export interface ReactionSummary {
  targetType: ReactionTarget;
  targetId: string;
  type: ReactionType;
  count: number;
  viewerReacted: boolean;
}

export interface UserChip {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * How a comment is shown to the current viewer.
 * - `visible`: normal comment.
 * - `hidden`: hidden by moderators. Only its author still sees the text (with a note); others get a placeholder.
 * - `removed`: removed by moderators or deleted by its author — placeholder for everyone.
 * - `unavailable`: written by someone in a block relationship with the viewer — placeholder, no author.
 */
export type CommentState = "visible" | "hidden" | "removed" | "unavailable";

export interface CommentView {
  id: string;
  argumentId: string;
  /** Top-level parent (replies are one level deep), null for top-level comments. */
  parentCommentId: string | null;
  state: CommentState;
  /** Null for placeholders: the text never reaches viewers who may not read it. */
  body: string | null;
  /** Null for placeholders. */
  author: UserChip | null;
  /** The commenter's free position when they posted (AGREE / AGAINST), if they chose to show it. */
  positionTag: PositionSide | null;
  createdAt: string;
  editedAt: string | null;
  isOwn: boolean;
  reactions: { count: number; viewerReacted: boolean };
}

export interface CommentThreadView {
  comment: CommentView;
  replies: CommentView[];
}

export interface CommentPage {
  threads: CommentThreadView[];
  /** Opaque cursor for the next (older) page of top-level comments, or null when done. */
  nextCursor: string | null;
}

export interface FollowState {
  userId: string;
  following: boolean;
  followerCount: number;
}

export interface BlockState {
  userId: string;
  blocked: boolean;
}

export interface BlockedUserView extends UserChip {
  blockedAt: string;
}
