// Owner: 5a-screens-a (ported from reference src/app/new/page.tsx). Create an argument (design §2 goal 1,
// PRD §8.2). Data: clientLoader → `list-categories`; submit → `create-argument` via app/lib/server-actions.
//
// The reference's `requirePageUser("/new")` becomes `get-session`: signed out (`null`) → framework sign-in;
// NEEDS_HANDLE (framework session, no ARGUE IT profile) → `/welcome`. The reference "account suspended"
// notice comes from the same call; `create-argument` still refuses a suspended user server-side.
import { redirectDocument, useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { SharpenWithAgent, useAppliedArgumentDraft } from "@/components/argue/agent/sharpen-with-agent";
import { ArgumentForm } from "@/components/argue/arguments/argument-form";
import { isViewerSuspended, normaliseCategories } from "@/components/argue/loaders/screen-a";
import { fetchViewer } from "@/components/argue/loaders/viewer";
import { PageContainer, PageHeader } from "@/components/argue/shell/page";
import { parseCategorySlug } from "@domain/arguments/feed-params";

import { loadAction, readLoadError, responseForLoadError, returnPathOf, signInHref } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export const meta: MetaFunction = () => [{ title: "Post an argument · ARGUE IT" }];

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  let viewer: Awaited<ReturnType<typeof fetchViewer>>;
  try {
    viewer = await fetchViewer();
  } catch (error) {
    throw (await responseForLoadError(readLoadError(error), request)) ?? error;
  }
  if (viewer === null) throw redirectDocument(signInHref(returnPathOf(request)));
  const search = new URL(request.url).searchParams;
  const categories = normaliseCategories(await loadAction<unknown>("list-categories", {}, request));
  const requested = parseCategorySlug(search.get("category") ?? undefined);
  const categorySlug = categories.some((c) => c.slug === requested) ? (requested ?? "") : "";
  const title = search.get("title")?.slice(0, 120) ?? "";
  return { categories, categorySlug, title, suspended: isViewerSuspended(viewer) };
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <RouteLoading />;
}

export function ErrorBoundary() {
  return <RouteErrorState />;
}

export default function NewArgumentPage() {
  const { categories, categorySlug, title, suspended } = useLoaderData<typeof clientLoader>();
  const agentDraft = useAppliedArgumentDraft();
  return (
    <PageContainer>
      <PageHeader
        title="Post an argument"
        description="State a clear proposition people can AGREE with or be AGAINST — then make your case."
      />
      {suspended ? (
        <p role="alert" className="mb-4 rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2 text-sm text-ink">
          Your account is suspended, so you can read but not post right now.
        </p>
      ) : null}
      {/* Debate Host (agent 8): the agent pre-fills the form from a hot take; the user publishes. */}
      <SharpenWithAgent drafted={agentDraft.drafted} />
      <ArgumentForm
        key={agentDraft.formKey}
        mode="create"
        categories={categories}
        initial={agentDraft.initial ?? { categorySlug, title }}
      />
    </PageContainer>
  );
}
