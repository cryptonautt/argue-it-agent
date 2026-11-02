import Link from "@/shims/next-link";
import { CalendarClock, Compass, Flame, PenLine, Swords, UserPlus } from "lucide-react";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { FeedTab } from "@domain/arguments/feed-params";

/** Empty states are invitations: say what's missing and offer the next step (PRD §8.3). */
export function FeedEmpty({ tab, categoryName }: { tab: FeedTab; categoryName: string | null }) {
  const inCategory = categoryName ? ` in ${categoryName}` : "";
  switch (tab) {
    case "following":
      return (
        <EmptyState
          icon={<UserPlus />}
          title="Nothing from people you follow"
          description={`When people you follow post${inCategory}, their arguments land here. Find voices worth following on Explore.`}
          action={<ButtonLink href="/explore">Find people</ButtonLink>}
        />
      );
    case "active":
      return (
        <EmptyState
          icon={<Swords />}
          title={`No live debates${inCategory}`}
          description="Find a take you disagree with and hit “Challenge this” — the AI judges it blind."
          action={<ButtonLink href="/?tab=trending">Browse trending</ButtonLink>}
        />
      );
    case "ending":
      return (
        <EmptyState
          icon={<CalendarClock />}
          title="Nothing about to close"
          description="Debates with a round closing soon show up here."
          action={<ButtonLink href="/?tab=active" variant="secondary">See all live debates</ButtonLink>}
        />
      );
    case "trending":
    case "for-you":
      return (
        <EmptyState
          icon={<Flame />}
          title={`Quiet${inCategory} right now`}
          description="Nothing's heating up yet. Start something — post a take people will want to argue about."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/new" icon={<PenLine aria-hidden className="size-4" />}>
                Post an argument
              </ButtonLink>
              <ButtonLink href="/?tab=new" variant="secondary">
                See newest
              </ButtonLink>
            </div>
          }
        />
      );
    case "new":
      return (
        <EmptyState
          icon={<Compass />}
          title={`No arguments${inCategory} yet`}
          description="Be the first. State a clear claim and let people pick a side."
          action={
            <ButtonLink href="/new" icon={<PenLine aria-hidden className="size-4" />}>
              Post the first one
            </ButtonLink>
          }
        />
      );
  }
}

export function FeedEnd() {
  return (
    <p className="py-6 text-center text-sm text-ink-3">
      You&apos;re all caught up.{" "}
      <Link href="/explore" className="font-semibold text-ink underline-offset-2 hover:underline">
        Explore more arguments
      </Link>
    </p>
  );
}
