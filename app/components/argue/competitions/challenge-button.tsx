// Owner: challenges. "Challenge this" — the entry point to a one-on-one judged debate (design §4.2).
// Deliberately a plain link (no hooks, no server imports) so it renders inside Server AND Client
// components (e.g. a client-side comment list). Eligibility (signed in, not yourself, no blocks) is
// checked by the setup page and enforced by the send action.
import { Swords } from "lucide-react";
import { ButtonLink, type ButtonSize, type ButtonVariant } from "@/components/argue/ui/button";

export interface ChallengeButtonProps {
  argumentId: string;
  /** Set when challenging from a comment (opponent = the commenter). */
  commentId?: string;
  /** Pre-selected opponent user id (e.g. the argument author). */
  opponentId?: string;
}

/** Visual weight per entry point: strong on an argument, quieter on each comment. */
const STYLE: Record<"argument" | "comment", { variant: ButtonVariant; size: ButtonSize }> = {
  argument: { variant: "primary", size: "sm" },
  comment: { variant: "ghost", size: "sm" },
};

export function ChallengeButton({ argumentId, commentId, opponentId }: ChallengeButtonProps) {
  const params = new URLSearchParams({ argument: argumentId });
  if (commentId) params.set("comment", commentId);
  if (opponentId) params.set("opponent", opponentId);
  const style = STYLE[commentId ? "comment" : "argument"];
  return (
    <ButtonLink
      href={`/challenge/new?${params.toString()}`}
      variant={style.variant}
      size={style.size}
      icon={<Swords aria-hidden className="size-4" />}
      prefetch={false}
    >
      Challenge this
      <span className="sr-only"> to a one-on-one debate judged by AI</span>
    </ButtonLink>
  );
}
