import { Users } from "lucide-react";
import { Card } from "@/components/argue/ui/card";
import { formatCount } from "./format";

export interface CommunityPanelProps {
  followers: number;
  following: number;
  comments: number;
  arguments: number;
}

/**
 * Social activity, shown apart from the debate record on purpose (design §4.5): popularity is never
 * evidence, and none of these numbers reach the rating or the judge.
 */
export function CommunityPanel({ followers, following, comments, arguments: argumentCount }: CommunityPanelProps) {
  const stats = [
    { label: "Followers", value: followers },
    { label: "Following", value: following },
    { label: "Arguments", value: argumentCount },
    { label: "Comments", value: comments },
  ];
  return (
    <section aria-labelledby="community-heading">
      <Card tone="inset">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="community-heading" className="flex items-center gap-2 text-xl text-ink">
            <Users aria-hidden className="size-5 text-ink-3" />
            Community
          </h2>
          <p className="text-xs text-ink-3">Social activity — never part of the debate rating</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-ink-3">{s.label}</dt>
              <dd className="tabular font-display text-2xl text-ink-2">{formatCount(s.value)}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
