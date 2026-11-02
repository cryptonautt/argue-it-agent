/**
 * Serializable shapes passed from the server to argument/feed components. Client-safe (types only);
 * dates are ISO strings because these cross the Server → Client Component boundary.
 */
import type { PositionSide } from "@domain/db/schema";

export interface ArgumentAuthorSummary {
  id: string;
  /** Null when the profile no longer exists (deleted account). */
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
}

export interface ArgumentCardData {
  id: string;
  title: string;
  proposition: string;
  createdAt: string;
  editedAt: string | null;
  category: { slug: string; name: string };
  author: ArgumentAuthorSummary;
  counts: {
    agree: number;
    against: number;
    comments: number;
    /** Challenges currently in their opening/rebuttal rounds. */
    liveDebates: number;
  };
  /** Nearest round deadline among this argument's live debates (ISO), if any. */
  nextDeadline: string | null;
  /** The signed-in viewer's own position, if they took one. */
  viewerSide: PositionSide | null;
}

export interface FeedPage {
  items: ArgumentCardData[];
  /** Pass back to load the next page; null when there is nothing more. */
  nextCursor: string | null;
}

export interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  description: string;
}
