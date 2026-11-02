// Owner: moderation. Small presentational pieces shared by the admin screens (server-component safe).
import Link from "@/shims/next-link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, OctagonAlert } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/argue/ui/badge";
import { cn } from "@domain/lib/cn";
import { formatDateTime, formatRelative } from "@domain/lib/time";
import type { CompetitionStatus, ContentStatus, ReportReason, UserRole, UserStatus } from "@domain/db/schema";
import { isSuspended } from "@domain/auth/roles";
import type { HealthLevel } from "@domain/moderation/metrics";
import { ACTION_LABEL, REASON_INFO } from "@domain/moderation/policy";
import type { ModerationActionType } from "@domain/db/schema";

// --- Badges -----------------------------------------------------------------------------------------

const contentTone: Record<ContentStatus, BadgeTone> = { visible: "success", hidden: "warning", removed: "danger" };

export function ContentStatusBadge({ status }: { status: ContentStatus | null }) {
  if (status === null) return null;
  return <Badge tone={contentTone[status]}>{status === "visible" ? "Visible" : status === "hidden" ? "Hidden" : "Removed"}</Badge>;
}

export function ReasonBadge({ reason }: { reason: ReportReason }) {
  const severity = REASON_INFO[reason].severity;
  return <Badge tone={severity <= 1 ? "danger" : severity <= 2 ? "warning" : "neutral"}>{REASON_INFO[reason].label}</Badge>;
}

export function ReportStatusBadge({ status }: { status: "open" | "actioned" | "dismissed" }) {
  const tone: BadgeTone = status === "open" ? "warning" : status === "actioned" ? "success" : "outline";
  return <Badge tone={tone}>{status === "open" ? "Open" : status === "actioned" ? "Actioned" : "Dismissed"}</Badge>;
}

export function UserStatusBadge({ status, suspendedUntil }: { status: UserStatus; suspendedUntil: Date | null }) {
  if (status === "deleted") return <Badge tone="outline">Deleted</Badge>;
  if (status === "suspended") {
    if (!isSuspended({ status, suspendedUntil })) return <Badge tone="outline">Suspension ended</Badge>;
    return (
      <Badge tone="danger" title={suspendedUntil ? `Until ${formatDateTime(suspendedUntil, "UTC")} UTC` : "No end date"}>
        Suspended{suspendedUntil ? ` · until ${formatDateTime(suspendedUntil, "UTC")} UTC` : " · no end date"}
      </Badge>
    );
  }
  return <Badge tone="success">Active</Badge>;
}

export function RoleBadge({ role }: { role: UserRole }) {
  if (role === "user") return null;
  return <Badge tone="outline">{role === "admin" ? "Admin" : "Moderator"}</Badge>;
}

const competitionTone: Partial<Record<CompetitionStatus, BadgeTone>> = {
  active: "success",
  evaluating: "judge",
  needs_review: "danger",
  under_appeal: "warning",
  pending_acceptance: "neutral",
  completed: "outline",
  cancelled: "outline",
};

export function CompetitionStatusBadge({ status }: { status: CompetitionStatus }) {
  return <Badge tone={competitionTone[status] ?? "neutral"}>{status.replaceAll("_", " ")}</Badge>;
}

export function ActionBadge({ action }: { action: ModerationActionType }) {
  const tone: BadgeTone = action === "suspend" || action === "remove" ? "danger" : action === "hide" || action === "warn" ? "warning" : "neutral";
  return <Badge tone={tone}>{ACTION_LABEL[action]}</Badge>;
}

// --- Stat tiles ---------------------------------------------------------------------------------------

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** One short line of context under the number. */
  hint?: ReactNode;
  href?: string;
  /** Status emphasis — always paired with an icon + the label text, never colour alone. */
  status?: "ok" | "attention" | "critical";
}

const statusIcon = { ok: CheckCircle2, attention: AlertTriangle, critical: OctagonAlert } as const;
const statusText = { ok: "text-success", attention: "text-warning", critical: "text-danger" } as const;

/** A KPI number. Headline figures are tiles, not charts. */
export function StatTile({ label, value, hint, href, status }: StatTileProps) {
  const Icon = status ? statusIcon[status] : null;
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
        {Icon ? <Icon aria-hidden className={cn("size-4", statusText[status!])} /> : null}
        {label}
        {status && status !== "ok" ? <span className="sr-only">({status === "critical" ? "needs action" : "needs attention"})</span> : null}
      </p>
      <p className="tabular mt-1 font-display text-4xl leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-ink-3 [overflow-wrap:anywhere]">{hint}</p> : null}
    </>
  );
  const classes = cn(
    "block min-w-0 rounded-[var(--radius)] border bg-surface p-4",
    status === "critical" ? "border-danger" : status === "attention" ? "border-warning" : "border-line",
    href && "transition-colors hover:bg-surface-2 focus-visible:bg-surface-2",
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

/** A labelled 0–100% meter (thin bar + the number as text). */
export function RateMeter({ label, value, detail, hint }: { label: string; value: number | null; detail?: string; hint?: string }) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 1000) / 10;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="tabular font-display text-2xl leading-none text-ink">{pct === null ? "—" : `${pct}%`}</p>
      </div>
      <div
        role="img"
        aria-label={pct === null ? `${label}: no data yet` : `${label}: ${pct}%${detail ? ` (${detail})` : ""}`}
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        title={detail}
      >
        {pct !== null ? <div className="h-full rounded-full bg-ink-2" style={{ width: `${pct}%` }} /> : null}
      </div>
      {detail || hint ? (
        <p className="text-xs text-ink-3">
          {detail}
          {detail && hint ? " · " : ""}
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function HealthBanner({ level, reasons }: { level: HealthLevel; reasons: string[] }) {
  const map = {
    healthy: { Icon: CheckCircle2, title: "Healthy", classes: "border-success bg-success-soft text-success" },
    attention: { Icon: AlertTriangle, title: "Needs attention", classes: "border-warning bg-warning-soft text-warning" },
    failing: { Icon: OctagonAlert, title: "Failing", classes: "border-danger bg-danger-soft text-danger" },
  } as const;
  const { Icon, title, classes } = map[level];
  return (
    <div role="status" className={cn("flex gap-3 rounded-[var(--radius)] border px-4 py-3", classes)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div>
        <p className="font-semibold">Evaluation queue: {title}</p>
        <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- Layout bits ------------------------------------------------------------------------------------------

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-2xl text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function TimeAgo({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={`${formatDateTime(date, "UTC")} UTC`}>
      {formatRelative(date)}
    </time>
  );
}

/** Shown instead of a 404 when a moderator opens an admin-only section from the shared nav. */
export function AdminOnly({ section }: { section: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-display text-2xl text-ink">{section} is for admins</p>
      <p className="mt-2 text-sm text-ink-2">
        Content moderation and AI evaluation admin are kept separate. Ask an admin if you need something from here.
      </p>
    </div>
  );
}

/** Prev/next links that keep the current filters. */
export function Pager({ page, hasMore, buildHref }: { page: number; hasMore: boolean; buildHref: (page: number) => string }) {
  if (page <= 1 && !hasMore) return null;
  const linkClass = "inline-flex h-11 items-center gap-1 rounded-[var(--radius)] border border-line-strong px-4 text-sm font-semibold text-ink hover:bg-surface-2";
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={linkClass}>
          <ChevronLeft aria-hidden className="size-4" /> Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-ink-3">Page {page}</span>
      {hasMore ? (
        <Link href={buildHref(page + 1)} className={linkClass}>
          Next <ChevronRight aria-hidden className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** A GET filter form (works without JavaScript; each change is a shareable URL). */
export function FilterForm({ children, resetHref }: { children: ReactNode; resetHref: string }) {
  return (
    <form method="get" className="mb-5 grid grid-cols-1 items-end gap-3 rounded-[var(--radius)] border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
      {children}
      <div className="flex gap-2">
        <button type="submit" className="inline-flex h-11 flex-1 items-center justify-center rounded-[var(--radius)] bg-ink px-4 text-sm font-semibold text-ink-inverse">
          Apply
        </button>
        <Link href={resetHref} className="inline-flex h-11 items-center justify-center rounded-[var(--radius)] px-3 text-sm font-semibold text-ink-2 hover:bg-surface-2">
          Reset
        </Link>
      </div>
    </form>
  );
}

/** Build "?a=1&b=2" from a record, dropping empty values. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function pageParam(value: string | string[] | undefined): number {
  const n = Number.parseInt(param(value) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : 1;
}

/** Narrow a search param to one of `allowed`. */
export function oneOf<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  const v = param(value);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
