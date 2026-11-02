// Owner: 5a-screens-a (ported from reference src/app/page.tsx). Landing (signed out) + feed (signed in),
// design §4.6 / §6. Data: clientLoader → `list-feed` + `list-categories` (server loaders are anonymous
// on this framework, see app/routes/_lib/route-data.ts).
//
// Differences from the reference, on purpose:
// - Signed-out landing shows no live arguments: there is no public (signed-out) feed action, and the
//   reference read the DB directly. The landing copy covers the empty case already.
// - The greeting is "Your feed": no action returns the viewer's display name yet.
import { PenLine } from "lucide-react";
import { redirect, useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { CategoryFilter } from "@/components/argue/feed/category-filter";
import { FeedEmpty, FeedEnd } from "@/components/argue/feed/feed-empty";
import { FeedList } from "@/components/argue/feed/feed-list";
import { Landing } from "@/components/argue/feed/landing";
import { normaliseCategories, normaliseFeedPage } from "@/components/argue/loaders/screen-a";
import { PageContainer } from "@/components/argue/shell/page";
import { ButtonLink } from "@/components/argue/ui/button";
import { LinkTabs } from "@/components/argue/ui/link-tabs";
import { FEED_TABS, feedHref, parseCategorySlug, parseFeedTab } from "@domain/arguments/feed-params";
import { callAction } from "@agent-native/core/client/hooks";

import {
  getFrameworkEmail,
  NEEDS_HANDLE_CODE,
  readLoadError,
  responseForLoadError,
  returnPathOf,
  welcomeHref,
} from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export const meta: MetaFunction = () => [
  { title: "ARGUE IT — Don't just argue. Prove your point." },
  {
    name: "description",
    content:
      "Post your hot take, pick a side, and challenge anyone to a one-on-one debate judged by AI — blind to who you are, with its reasoning shown.",
  },
];

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const tab = parseFeedTab(search.get("tab") ?? undefined);
  const requested = parseCategorySlug(search.get("category") ?? undefined);

  let categoriesRaw: unknown;
  try {
    categoriesRaw = await callAction("list-categories", {}, { method: "GET" });
  } catch {
    categoriesRaw = null; // The filter row is optional; the feed below still loads.
  }
  const categories = normaliseCategories(categoriesRaw);
  const category = categories.find((c) => c.slug === requested) ?? null;
  const categorySlug = category?.slug ?? null;

  try {
    const raw = await callAction("list-feed", { tab, ...(categorySlug ? { category: categorySlug } : {}) }, { method: "GET" });
    return {
      kind: "feed" as const,
      tab,
      categories,
      categorySlug,
      categoryName: category?.name ?? null,
      page: normaliseFeedPage(raw),
    };
  } catch (error) {
    const loadError = readLoadError(error);
    if (loadError.code === NEEDS_HANDLE_CODE) throw redirect(welcomeHref(returnPathOf(request)));
    if (loadError.code === "UNAUTHENTICATED") {
      // Signed in to the framework but no ARGUE IT profile → /welcome; truly signed out → landing.
      if (await getFrameworkEmail()) throw redirect(welcomeHref(returnPathOf(request)));
      return { kind: "landing" as const };
    }
    throw (await responseForLoadError(loadError, request)) ?? error;
  }
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <RouteLoading />;
}

export function ErrorBoundary() {
  return <RouteErrorState />;
}

export default function HomePage() {
  const data = useLoaderData<typeof clientLoader>();
  if (data.kind === "landing") return <Landing live={[]} />;

  const { tab, categories, categorySlug, categoryName, page } = data;
  return (
    <PageContainer>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-4xl text-ink sm:text-5xl">Your feed</h1>
        <ButtonLink href="/new" size="sm" icon={<PenLine aria-hidden className="size-4" />}>
          Post
        </ButtonLink>
      </div>
      <LinkTabs
        ariaLabel="Feed"
        activeKey={tab}
        items={FEED_TABS.map((t) => ({ key: t.key, label: t.label, href: feedHref(t.key, categorySlug) }))}
      />
      {categories.length > 0 ? (
        <CategoryFilter
          categories={categories}
          active={categorySlug}
          hrefFor={(slug) => feedHref(tab, slug)}
          className="mt-3 mb-4"
        />
      ) : (
        <div className="mb-4" />
      )}
      <FeedList
        key={`${tab}:${categorySlug ?? "all"}`}
        tab={tab}
        categorySlug={categorySlug}
        initialItems={page.items}
        initialCursor={page.nextCursor}
        empty={<FeedEmpty tab={tab} categoryName={categoryName} />}
        end={<FeedEnd />}
      />
    </PageContainer>
  );
}
