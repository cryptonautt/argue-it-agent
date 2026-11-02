// Owner: 5b-screens-b (ported from reference src/app/u/[handle]/page.tsx). Public profile: debate record
// (rating, W/L/D, categories, judge-score averages), debate history, arguments posted, and a separate
// community section (design §4.5, §6). Data: clientLoader → `get-profile` ({ handle }).
//
// Not shown in this port: Follow / Block / Report buttons. Their actions (followUser, blockUser, fileReport)
// are not ported yet (app/lib/server-actions.ts UNPORTED_ACTIONS), and a button that always fails is worse
// than no button. Panels whose data `get-profile` doesn't return are left out rather than faked.
import { ShieldOff, UserX } from "lucide-react";
import {
  data,
  redirect,
  useLoaderData,
  useLocation,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { CommunityPanel } from "@/components/argue/profile/community-panel";
import { DebateHistoryList } from "@/components/argue/profile/debate-history-list";
import { PostedArgumentsList } from "@/components/argue/profile/posted-arguments-list";
import { ProfileHeader } from "@/components/argue/profile/profile-header";
import { RatingPanel } from "@/components/argue/profile/rating-panel";
import { PageContainer } from "@/components/argue/shell/page";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import { LinkTabs } from "@/components/argue/ui/link-tabs";
import { normalizeHandle } from "@domain/lib/handles";
import { strongestCriterion } from "@domain/reputation/criteria";

import { loadAction } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";
import { normaliseProfile, profileTab } from "./_lib/screen-data";

export async function clientLoader({ params, request }: ClientLoaderFunctionArgs) {
  const requested = decodeURIComponent(params.handle ?? "");
  const search = new URL(request.url).searchParams;
  // get-profile takes only { handle } and returns the first page of both lists, so there is no cursor
  // paging in this port ("load more" links are hidden).
  const raw = await loadAction<unknown>("get-profile", { handle: requested }, request);
  const page = normaliseProfile(raw);
  if (!page) throw data({ message: "Not found" }, { status: 404 });
  // One canonical URL per profile (/u/Ada → /u/ada).
  if (requested !== page.profile.handle && normalizeHandle(requested) === page.profile.handle) {
    throw redirect(`/u/${page.profile.handle}${search.size ? `?${search.toString()}` : ""}`);
  }
  return { page };
}
clientLoader.hydrate = true as const;

/** Both lists come back in one call, so switching tabs doesn't refetch. Agent writes still revalidate. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    const a = new URLSearchParams(currentUrl.search);
    const b = new URLSearchParams(nextUrl.search);
    a.delete("tab");
    b.delete("tab");
    if (a.toString() === b.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export const meta: MetaFunction<typeof clientLoader> = ({ loaderData: data }) => {
  const profile = data?.page.profile;
  if (!profile || profile.status === "deleted") return [{ title: "Profile · ARGUE IT" }];
  return [
    { title: `${profile.displayName} (@${profile.handle}) · ARGUE IT` },
    { name: "description", content: profile.bio ?? `${profile.displayName}'s debate record on ARGUE IT.` },
  ];
};

export const HydrateFallback = RouteLoading;
export const ErrorBoundary = RouteErrorState;

export default function ProfilePage() {
  const { page } = useLoaderData<typeof clientLoader>();
  const tab = profileTab(new URLSearchParams(useLocation().search));
  const { profile, viewer } = page;

  if (profile.status === "deleted") {
    return (
      <PageContainer>
        <EmptyState
          icon={<UserX aria-hidden />}
          title="This account was deleted"
          description="Their past debates still appear on other people's records as “Deleted user”."
          action={<ButtonLink href="/">Back to the feed</ButtonLink>}
        />
      </PageContainer>
    );
  }

  if (viewer.blockedEitherWay) {
    return (
      <PageContainer>
        <ProfileHeader profile={profile} isOwnProfile={false} />
        <EmptyState
          icon={<ShieldOff aria-hidden />}
          title={viewer.viewerBlocks ? `You blocked @${profile.handle}` : "This profile isn't available"}
          description={
            viewer.viewerBlocks
              ? "You won't see their arguments, comments or debates while they're blocked."
              : "You can't view this person's activity."
          }
        />
      </PageContainer>
    );
  }

  const base = `/u/${profile.handle}`;

  return (
    <PageContainer>
      <ProfileHeader profile={profile} isOwnProfile={viewer.isOwnProfile} />

      <div className="space-y-6">
        {page.record ? (
          <RatingPanel
            summary={page.record.summary}
            criteria={page.record.criteria}
            strongest={strongestCriterion(page.record.criteria, { minDebates: 2 })}
          />
        ) : null}

        {page.follows ? (
          <CommunityPanel
            followers={page.follows.followers}
            following={page.follows.following}
            comments={page.commentCount ?? 0}
            arguments={page.argumentCount ?? 0}
          />
        ) : null}

        <section aria-label="Activity" className="space-y-4">
          <LinkTabs
            ariaLabel="Profile activity"
            activeKey={tab}
            items={[
              { key: "debates", label: "Debates", href: base },
              {
                key: "arguments",
                label: "Arguments",
                href: `${base}?tab=arguments`,
                ...(page.argumentCount !== null ? { count: page.argumentCount } : {}),
              },
            ]}
          />
          {tab === "debates" && page.history ? (
            <DebateHistoryList
              items={page.history.items}
              displayName={profile.displayName}
              isOwnProfile={viewer.isOwnProfile}
              nextHref={null}
            />
          ) : null}
          {tab === "arguments" && page.posted ? (
            <PostedArgumentsList
              items={page.posted.items}
              displayName={profile.displayName}
              isOwnProfile={viewer.isOwnProfile}
              nextHref={null}
            />
          ) : null}
        </section>
      </div>
    </PageContainer>
  );
}
