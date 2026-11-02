// Owner: 5a-screens-a (ported from reference src/app/a/[id]/page.tsx). Argument detail (design §6): the
// post, positions, challenge entry point, debates started from it and the discussion.
// Data: clientLoader → `get-argument` ({ visibility, argument, positions, challenges, comments }), which
// applies the reference `visibilityFor` gate on the server; plus `get-session` (who-am-I) when available.
//
// Left out on purpose (no fake controls): owner Edit/Delete, Report, reactions and Follow. Their actions
// are not ported (app/lib/server-actions.ts UNPORTED_ACTIONS) or their data isn't returned yet; a button
// that always fails is worse than no button. Sections whose data is missing are omitted, never zeroed.
import { ShieldAlert } from "lucide-react";
import { useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { ArgumentLinks } from "@/components/argue/arguments/argument-links";
import { PropositionBlock } from "@/components/argue/arguments/proposition-block";
import { RemovedArgumentNotice } from "@/components/argue/arguments/removed-argument";
import { ShareButton } from "@/components/argue/arguments/share-button";
import { ArgumentChallenges } from "@/components/argue/competitions/argument-challenges";
import { ChallengeButton } from "@/components/argue/competitions/challenge-button";
import {
  isFullArgument,
  normaliseArgumentPage,
  normaliseViewer,
  type ArgueViewer,
  type ArgumentPageData,
} from "@/components/argue/loaders/screen-a";
import { PageContainer } from "@/components/argue/shell/page";
import { CommentThread } from "@/components/argue/social/comment-thread";
import { PositionBar } from "@/components/argue/social/position-bar";
import { commentClosedReason, positionModeFor } from "@/components/argue/social/view-modes";
import { Avatar } from "@/components/argue/ui/avatar";
import { Badge } from "@/components/argue/ui/badge";
import { ButtonLink } from "@/components/argue/ui/button";
import Link from "@/shims/next-link";
import { callAction } from "@agent-native/core/client/hooks";
import type { ArgumentDetail } from "@domain/arguments/queries";
import { formatDateTime, formatRelative } from "@domain/lib/time";

import { loadAction, requireUuid } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

async function loadViewer(): Promise<ArgueViewer | null | undefined> {
  try {
    return normaliseViewer(await callAction("get-session", {}, { method: "GET" }));
  } catch {
    return undefined; // No who-am-I action yet (or it failed): viewer-dependent controls stay hidden.
  }
}

export async function clientLoader({ params, request }: ClientLoaderFunctionArgs) {
  const id = requireUuid(params.id);
  const [raw, viewer] = await Promise.all([loadAction<unknown>("get-argument", { id }, request), loadViewer()]);
  const page = normaliseArgumentPage(raw);
  if (!page) throw new Response("Not Found", { status: 404 });
  const show = new URL(request.url).searchParams.get("show");
  return { page, viewer, show };
}
clientLoader.hydrate = true as const;

export const meta: MetaFunction<typeof clientLoader> = ({ loaderData: data }) => {
  if (!data) return [{ title: "Argument · ARGUE IT" }];
  if (!isFullArgument(data.page) || data.page.argument.status !== "visible") {
    return [{ title: "Argument unavailable · ARGUE IT" }, { name: "robots", content: "noindex" }];
  }
  const argument = data.page.argument;
  return [
    { title: `${argument.title} · ARGUE IT` },
    { name: "description", content: `${argument.proposition} — AGREE or AGAINST? Pick a side on ARGUE IT.` },
  ];
};

export function HydrateFallback() {
  return <RouteLoading />;
}

export function ErrorBoundary() {
  return <RouteErrorState />;
}

export default function ArgumentPage() {
  const { page, viewer, show } = useLoaderData<typeof clientLoader>();
  const argument = page.argument;
  const full = isFullArgument(page) ? page.argument : null;
  const blockedGate = full !== null && full.viewerBlockedAuthor && show !== "1";

  return (
    <PageContainer>
      <div className="flex flex-col gap-8 pb-10">
        {full === null ? (
          <>
            <h1 className="sr-only">Argument unavailable</h1>
            <RemovedArgumentNotice
              status={argument.status === "hidden" ? "hidden" : "removed"}
              removedBy={argument.removedBy}
            />
          </>
        ) : blockedGate ? (
          <BlockedNotice argumentId={full.id} />
        ) : (
          <ArgumentBody argument={full} page={page} viewer={viewer} revealed={page.visibility === "revealed"} />
        )}

        {page.challenges ? (
          <section aria-labelledby="debates-heading" className="flex flex-col gap-3">
            <h2 id="debates-heading" className="text-3xl text-ink">
              Debates
            </h2>
            <ArgumentChallenges items={page.challenges} />
          </section>
        ) : null}

        {page.comments && full !== null ? (
          <section aria-labelledby="discussion-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="discussion-heading" className="text-3xl text-ink">
                Discussion
              </h2>
              <p className="text-sm text-ink-3">Comments are free discussion — they are never judged.</p>
            </div>
            <CommentThread
              argumentId={full.id}
              page={page.comments}
              viewer={
                viewer === undefined
                  ? undefined
                  : viewer && viewer.handle
                    ? {
                        id: viewer.id,
                        handle: viewer.handle,
                        displayName: viewer.displayName ?? viewer.handle,
                        avatarUrl: viewer.avatarUrl,
                      }
                    : null
              }
              argumentOpen={full.status === "visible"}
              blocked={full.viewerBlockedAuthor || full.authorBlockedViewer}
              // Suspension isn't known on the client yet; create-comment refuses a suspended user itself.
              closedReason={commentClosedReason(
                full.status === "visible",
                full.viewerBlockedAuthor || full.authorBlockedViewer,
                false,
              )}
              viewerSide={page.positions?.viewerSide ?? null}
            />
          </section>
        ) : null}
      </div>
    </PageContainer>
  );
}

function ArgumentBody({
  argument,
  page,
  viewer,
  revealed,
}: {
  argument: ArgumentDetail;
  page: ArgumentPageData;
  viewer: ArgueViewer | null | undefined;
  revealed: boolean;
}) {
  const isPublic = argument.status === "visible";
  const isAuthor = viewer ? viewer.id === argument.authorId : false;
  const blocked = argument.viewerBlockedAuthor || argument.authorBlockedViewer;

  return (
    <article className="flex flex-col gap-5" aria-labelledby="argument-title">
      {revealed ? (
        <RemovedArgumentNotice
          status={argument.status === "hidden" ? "hidden" : "removed"}
          removedBy={argument.removedBy}
          revealed
        />
      ) : null}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Link href={`/?category=${argument.category.slug}`} className="rounded-full">
            <Badge tone="outline" className="hover:border-ink hover:text-ink">
              {argument.category.name}
            </Badge>
          </Link>
          <time dateTime={argument.createdAt.toISOString()} title={formatDateTime(argument.createdAt, "UTC") + " UTC"}>
            {formatRelative(argument.createdAt)}
          </time>
          {argument.editedAt ? (
            <span title={`Edited ${formatDateTime(argument.editedAt, "UTC")} UTC`}>· Edited</span>
          ) : null}
        </div>
        <h1 id="argument-title" className="text-4xl leading-[1.05] text-ink sm:text-5xl">
          {argument.title}
        </h1>
        <AuthorRow argument={argument} />
      </header>

      <PropositionBlock proposition={argument.proposition} />

      <div className="text-[1.05rem] leading-relaxed whitespace-pre-wrap text-ink">{argument.body}</div>

      <ArgumentLinks links={argument.links} />

      {isPublic && page.positions ? (
        <PositionBar
          argumentId={argument.id}
          summary={page.positions}
          // get-argument requires a signed-in user, so the viewer is signed in here.
          mode={positionModeFor({ id: viewer?.id ?? "" }, { authorId: argument.authorId, open: isPublic }, blocked)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {isPublic && !argument.authorBlockedViewer ? (
          <ChallengeButton argumentId={argument.id} opponentId={isAuthor ? undefined : argument.authorId} />
        ) : null}
        {isPublic ? (
          <ShareButton path={`/a/${argument.id}`} title={argument.title} text={argument.proposition} />
        ) : null}
      </div>
    </article>
  );
}

function AuthorRow({ argument }: { argument: ArgumentDetail }) {
  const { author } = argument;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={author.displayName} src={author.avatarUrl} size="md" />
      <div className="min-w-0">
        {author.handle ? (
          <Link href={`/u/${author.handle}`} className="block truncate font-semibold text-ink hover:underline">
            {author.displayName}
          </Link>
        ) : (
          <span className="block truncate font-semibold text-ink-2">{author.displayName}</span>
        )}
        {author.handle ? <span className="block truncate text-sm text-ink-3">@{author.handle}</span> : null}
      </div>
    </div>
  );
}

function BlockedNotice({ argumentId }: { argumentId: string }) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-[var(--radius)] border border-line bg-surface-2 p-4">
      <h1 className="flex items-center gap-2 font-display text-2xl text-ink">
        <ShieldAlert aria-hidden className="size-5" /> You blocked this author
      </h1>
      <p className="text-sm text-ink-2">Their posts are hidden from your feeds. You can still view this one if you want.</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/a/${argumentId}?show=1`} variant="secondary" size="sm">
          Show anyway
        </ButtonLink>
      </div>
    </div>
  );
}
