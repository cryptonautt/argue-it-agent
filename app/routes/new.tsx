// Owner: 5a-screens-a (ported from reference src/app/new/page.tsx). Create an argument (design §2 goal 1,
// PRD §8.2). Data: clientLoader → `list-categories`; submit → `create-argument` via app/lib/server-actions.
//
// The reference's `requirePageUser("/new")` becomes: no framework session → framework sign-in. The
// "account suspended" notice isn't shown up front (no action returns the viewer's status yet);
// `create-argument` still refuses a suspended user with the reference message.
import { redirectDocument, useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { SharpenWithAgent, useAppliedArgumentDraft } from "@/components/argue/agent/sharpen-with-agent";
import { ArgumentForm } from "@/components/argue/arguments/argument-form";
import { normaliseCategories } from "@/components/argue/loaders/screen-a";
import { PageContainer, PageHeader } from "@/components/argue/shell/page";
import { parseCategorySlug } from "@domain/arguments/feed-params";

import { getFrameworkEmail, loadAction, returnPathOf, signInHref } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export const meta: MetaFunction = () => [{ title: "Post an argument · ARGUE IT" }];

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  if (!(await getFrameworkEmail())) throw redirectDocument(signInHref(returnPathOf(request)));
  const search = new URL(request.url).searchParams;
  const categories = normaliseCategories(await loadAction<unknown>("list-categories", {}, request));
  const requested = parseCategorySlug(search.get("category") ?? undefined);
  const categorySlug = categories.some((c) => c.slug === requested) ? (requested ?? "") : "";
  const title = search.get("title")?.slice(0, 120) ?? "";
  return { categories, categorySlug, title };
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <RouteLoading />;
}

export function ErrorBoundary() {
  return <RouteErrorState />;
}

export default function NewArgumentPage() {
  const { categories, categorySlug, title } = useLoaderData<typeof clientLoader>();
  const agentDraft = useAppliedArgumentDraft();
  return (
    <PageContainer>
      <PageHeader
        title="Post an argument"
        description="State a clear proposition people can AGREE with or be AGAINST — then make your case."
      />
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
