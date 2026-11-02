// Owner: verdict. Strengths/weaknesses per side and the claims the judge flagged.
import { CircleCheck, CircleMinus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/argue/ui/badge";
import { Card } from "@/components/argue/ui/card";
import { SideTag } from "@/components/argue/ui/side-tag";
import type { SideLabel, VerdictExplanation } from "@domain/db/json-types";
import { CLAIM_COPY, type SidePair } from "@domain/appeals/verdict-view";

function PointList({ items, kind }: { items: readonly string[]; kind: "strength" | "weakness" }) {
  if (items.length === 0) return <p className="text-sm text-ink-3">None noted.</p>;
  const Icon = kind === "strength" ? CircleCheck : CircleMinus;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={`${i}-${item.slice(0, 24)}`} className="flex gap-2 text-sm text-ink">
          <Icon aria-hidden className={kind === "strength" ? "mt-0.5 size-4 shrink-0 text-success" : "mt-0.5 size-4 shrink-0 text-ink-3"} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function StrengthsWeaknesses({ explanation, sides }: { explanation: VerdictExplanation; sides: SidePair }) {
  const columns: SideLabel[] = ["A", "B"];
  const hasAny = columns.some(
    (s) => explanation.strengths[s].length > 0 || explanation.weaknesses[s].length > 0,
  );
  if (!hasAny) return null;
  return (
    <section aria-labelledby="insights-title" className="flex flex-col gap-3">
      <h2 id="insights-title" className="text-3xl text-ink">
        What worked, what didn&rsquo;t
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {columns.map((side) => {
          const person = sides[side];
          return (
            <Card key={side} className={side === "A" ? "border-t-4 border-t-for" : "border-t-4 border-t-against-bright"}>
              <div className="mb-3 flex items-center gap-2">
                <SideTag side={person.stance} size="sm" />
                <span className="truncate font-semibold text-ink">{person.displayName}</span>
              </div>
              <h3 className="mb-1.5 text-lg text-ink">Strengths</h3>
              <PointList items={explanation.strengths[side]} kind="strength" />
              <h3 className="mt-3 mb-1.5 text-lg text-ink">Weaknesses</h3>
              <PointList items={explanation.weaknesses[side]} kind="weakness" />
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function FlaggedClaims({ explanation, sides }: { explanation: VerdictExplanation; sides: SidePair }) {
  const claims = explanation.flaggedClaims;
  return (
    <section aria-labelledby="claims-title" className="flex flex-col gap-3">
      <div>
        <h2 id="claims-title" className="text-3xl text-ink">
          Flagged claims
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          The judge sorts claims into common knowledge, opinion, unsupported or likely false. It doesn&rsquo;t browse
          the web, so &ldquo;likely false&rdquo; means it contradicts widely known facts.
        </p>
      </div>
      {claims.length === 0 ? (
        <p className="text-sm text-ink-3">No claims were flagged.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim, i) => {
            const person = sides[claim.side];
            const copy = CLAIM_COPY[claim.classification];
            return (
              <li key={`${i}-${claim.claim.slice(0, 24)}`} className="rounded-[var(--radius)] border border-line bg-surface p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <SideTag side={person.stance} size="sm" variant="soft">
                    {person.displayName}
                  </SideTag>
                  <Badge tone={copy.tone}>{copy.label}</Badge>
                </div>
                <p className="text-sm text-ink">{claim.claim}</p>
              </li>
            );
          })}
        </ul>
      )}
      {explanation.injectionDetected ? (
        <Card tone="inset" className="flex gap-3">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <p className="text-sm text-ink-2">
            Some text in a submission looked like instructions to the judge (for example &ldquo;ignore your
            rules&rdquo;). The judge treats that as part of the argument: it earns nothing and can&rsquo;t change the
            scoring. It was also flagged to moderators.
          </p>
        </Card>
      ) : null}
    </section>
  );
}
