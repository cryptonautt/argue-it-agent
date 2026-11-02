// Owner: moderation. Shows reported content to moderators as TEXT only (never HTML). User links are printed,
// not linked, so a moderator never clicks a reported scam/malware link by accident.
import Link from "@/shims/next-link";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/argue/ui/card";
import type { TargetSummary } from "@domain/moderation/targets";
import { TARGET_LABEL } from "@domain/moderation/policy";
import { ContentStatusBadge, RoleBadge, TimeAgo, UserStatusBadge } from "./admin-ui";

export function TargetPreview({ target, clamp = false }: { target: TargetSummary | null; clamp?: boolean }) {
  if (!target) {
    return (
      <Card tone="inset">
        <p className="text-sm text-ink-2">This content no longer exists (deleted by its author or its account).</p>
      </Card>
    );
  }
  return (
    <Card tone="inset" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-semibold tracking-wide text-ink-2 uppercase">{TARGET_LABEL[target.type]}</span>
        <ContentStatusBadge status={target.status} />
        <span>
          by{" "}
          <Link href={`/admin/users/${target.author.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
            @{target.author.handle ?? "unknown"}
          </Link>
        </span>
        <RoleBadge role={target.author.role} />
        <UserStatusBadge status={target.author.status} suspendedUntil={target.author.suspendedUntil} />
        <span aria-hidden>·</span>
        <TimeAgo date={target.createdAt} />
      </div>
      <p className="font-semibold text-ink">{target.title}</p>
      {target.sealed ? (
        <p className="text-sm text-ink-2">
          Sealed: this {target.submissionRound ?? "submission"} stays private to its author until the round closes, so it isn&apos;t
          shown here either. Check back after the deadline.
        </p>
      ) : target.body ? (
        <p className={clamp ? "line-clamp-3 text-sm whitespace-pre-line text-ink-2" : "text-sm break-words whitespace-pre-line text-ink"}>
          {target.body}
        </p>
      ) : (
        <p className="text-sm text-ink-3 italic">No text.</p>
      )}
      {!clamp && !target.sealed && target.links.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {target.links.map((href) => (
            <li key={href} className="break-all text-ink-2">
              <span className="font-mono text-xs">{href}</span>
              <span className="sr-only"> (shown as text; open with care)</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!clamp ? (
        <Link href={target.href} target="_blank" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline-offset-2 hover:underline">
          Open where it was posted <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </Link>
      ) : null}
    </Card>
  );
}
