import Link from "@/shims/next-link";
import { Avatar } from "@/components/argue/ui/avatar";
import type { PersonResult } from "@domain/arguments/search";

const nf = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

/** A creator in Explore results. Follower count is community info only — it never affects debate rating. */
export function PersonRow({ person }: { person: PersonResult }) {
  return (
    <Link
      href={`/u/${person.handle}`}
      className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-3 hover:border-line-strong"
    >
      <Avatar name={person.displayName} src={person.avatarUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{person.displayName}</span>
        <span className="block truncate text-sm text-ink-3">
          @{person.handle} · {nf.format(person.followers)} {person.followers === 1 ? "follower" : "followers"}
        </span>
        {person.bio ? <span className="mt-0.5 line-clamp-1 block text-sm text-ink-2">{person.bio}</span> : null}
      </span>
    </Link>
  );
}
