// Owner: verdict. The two named debaters facing off (the judge never saw these names).
import Link from "@/shims/next-link";
import { Trophy } from "lucide-react";
import { Avatar } from "@/components/argue/ui/avatar";
import { SideTag } from "@/components/argue/ui/side-tag";
import { cn } from "@domain/lib/cn";
import type { SideLabel } from "@domain/db/json-types";
import type { ParticipantView, SidePair } from "@domain/appeals/verdict-view";

function Debater({
  person,
  align,
  state,
}: {
  person: ParticipantView;
  align: "left" | "right";
  state: "winner" | "loser" | "even";
}) {
  const name = (
    <span className="block truncate font-display text-xl font-bold leading-tight text-ink sm:text-2xl">
      {person.displayName}
    </span>
  );
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2",
        align === "right" ? "items-end text-right" : "items-start text-left",
        state === "loser" && "opacity-70",
      )}
    >
      <div className="relative">
        <Avatar
          name={person.displayName}
          src={person.avatarUrl}
          size="lg"
          className={cn(
            "ring-4",
            state === "winner" ? "ring-judge" : person.stance === "FOR" ? "ring-for/30" : "ring-against/30",
          )}
        />
        {state === "winner" ? (
          <span
            className={cn(
              "absolute -bottom-1 inline-flex size-7 items-center justify-center rounded-full bg-judge text-on-judge shadow",
              align === "right" ? "-left-1" : "-right-1",
            )}
          >
            <Trophy aria-hidden className="size-4" />
            <span className="sr-only">Winner</span>
          </span>
        ) : null}
      </div>
      <div className="w-full min-w-0">
        {person.handle ? (
          <Link href={`/u/${person.handle}`} className="hover:underline">
            {name}
          </Link>
        ) : (
          name
        )}
        {person.handle ? <span className="block truncate text-sm text-ink-3">@{person.handle}</span> : null}
      </div>
      <SideTag side={person.stance} size="sm" />
    </div>
  );
}

/** FOR on the left, AGAINST on the right — the same everywhere in the product. */
export function Matchup({ sides, winnerSide, className }: { sides: SidePair; winnerSide: SideLabel | null; className?: string }) {
  const stateOf = (side: SideLabel) => (winnerSide === null ? "even" : winnerSide === side ? "winner" : "loser");
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Debater person={sides.A} align="left" state={stateOf("A")} />
      <span aria-hidden className="slant mt-4 shrink-0 rounded-[3px] bg-ink px-2 py-1 font-display text-lg font-bold text-ink-inverse">
        <span className="unslant">VS</span>
      </span>
      <Debater person={sides.B} align="right" state={stateOf("B")} />
    </div>
  );
}
