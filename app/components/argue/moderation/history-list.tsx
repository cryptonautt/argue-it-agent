// Owner: moderation. Moderation action history (who did what, why, when).
import type { ModerationHistoryItem } from "@domain/moderation/queries";
import { REASON_INFO, TARGET_LABEL } from "@domain/moderation/policy";
import type { ReportTarget } from "@domain/db/schema";
import { ActionBadge, TimeAgo } from "./admin-ui";

function targetLabel(type: string): string {
  return type === "user" ? "account" : (TARGET_LABEL[type as ReportTarget] ?? type);
}

export function HistoryList({ items, emptyText = "No moderation history." }: { items: ModerationHistoryItem[]; emptyText?: string }) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{emptyText}</p>;
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="border-l-2 border-line-strong pl-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ActionBadge action={item.action} />
            <span className="text-ink-2">
              {targetLabel(item.targetType)} · {REASON_INFO[item.reasonCode].label}
              {item.durationHours ? ` · ${item.durationHours}h` : item.action === "suspend" ? " · no end date" : ""}
            </span>
          </div>
          {item.note ? <p className="mt-1 text-sm whitespace-pre-line text-ink">{item.note}</p> : null}
          <p className="mt-1 text-xs text-ink-3">
            @{item.moderatorHandle ?? "staff"} · <TimeAgo date={item.createdAt} />
          </p>
        </li>
      ))}
    </ol>
  );
}
