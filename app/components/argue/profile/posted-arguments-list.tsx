import Link from "@/shims/next-link";
import { MessageSquareQuote } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { PostedArgument } from "@domain/profiles/queries";
import { formatShortDate } from "./format";

export interface PostedArgumentsListProps {
  items: readonly PostedArgument[];
  displayName: string;
  isOwnProfile: boolean;
  nextHref: string | null;
}

export function PostedArgumentsList({ items, displayName, isOwnProfile, nextHref }: PostedArgumentsListProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquareQuote aria-hidden />}
        title="No arguments posted"
        description={isOwnProfile ? "Got a hot take? Post it and let people pick a side." : `${displayName} hasn't posted an argument yet.`}
        action={isOwnProfile ? <ButtonLink href="/new">Post an argument</ButtonLink> : undefined}
      />
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-[var(--radius)] border border-line bg-surface">
        {items.map((a) => (
          <li key={a.id}>
            <Link href={`/a/${a.id}`} className="block px-4 py-3 hover:bg-surface-2">
              <div className="mb-1 flex items-center gap-2">
                <Badge>{a.category.name}</Badge>
                <span className="text-xs text-ink-3">{formatShortDate(a.createdAt)}</span>
              </div>
              <p className="font-semibold text-ink">{a.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{a.proposition}</p>
            </Link>
          </li>
        ))}
      </ul>
      {nextHref ? (
        <ButtonLink href={nextHref} variant="secondary" fullWidth scroll={false}>
          Older arguments
        </ButtonLink>
      ) : null}
    </div>
  );
}
