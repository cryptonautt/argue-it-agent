// Owner: 5a-screens-a (ported from reference src/app/challenge/new/page.tsx). Challenge setup with the full
// terms preview (design §4.2, §6). Data: clientLoader → `get-argument`; the rubric comes from the code
// rubrics (the reference `getCurrentRubric` returns the same definition); send → `send-challenge`.
//
// Differences from the reference, on purpose:
// - The target is resolved on the client from the get-argument payload (author, or the comment's author
//   when it's on the first comments page). `send-challenge` still runs the reference
//   `resolveChallengeTarget` on the server, so self-challenges, blocks, suspended users and duplicate open
//   challenges are refused there with the reference messages.
// - The "you already have an open challenge with @x" notice isn't shown up front (no action exposes
//   `findOpenChallenge`); sending a duplicate is refused with CONFLICT.
// - `challengerId` is get-argument's `viewer.id` (display-only in the terms preview; the server freezes the
//   real snapshot). The suspended notice uses `get-session` (it carries `suspendedUntil`); if that call
//   fails the form stays enabled and `send-challenge` refuses a suspended user with SUSPENDED.
import { Swords } from "lucide-react";
import { useLoaderData, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { ChallengeSetupForm } from "@/components/argue/competitions/challenge-setup-form";
import {
  challengeTargetFrom,
  isViewerSuspended,
  normaliseArgumentPage,
  rubricForCategory,
} from "@/components/argue/loaders/screen-a";
import { loadViewer } from "@/components/argue/loaders/viewer";
import { PageContainer, PageHeader } from "@/components/argue/shell/page";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";

import { loadAction } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export const meta: MetaFunction = () => [{ title: "Set up a challenge · ARGUE IT" }];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (value: string | null): string | null => (value && UUID.test(value) ? value : null);

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const search = new URL(request.url).searchParams;
  const argumentId = uuidParam(search.get("argument"));
  const commentId = uuidParam(search.get("comment"));
  const opponentId = uuidParam(search.get("opponent"));
  if (!argumentId) return { kind: "pick-argument" as const };

  // loadAction handles the reference `requirePageUser` (sign-in / welcome redirects) and 404s.
  const [raw, viewer] = await Promise.all([
    loadAction<unknown>("get-argument", { id: argumentId }, request),
    loadViewer(),
  ]);
  const data = normaliseArgumentPage(raw);
  if (!data) return { kind: "blocked" as const, argumentId, reason: "That argument doesn't exist." };
  const viewerId = data.viewerId ?? viewer?.id ?? null;
  const target = challengeTargetFrom(data, { commentId, opponentId }, viewerId);
  if (typeof target === "string") return { kind: "blocked" as const, argumentId, reason: target };
  const rubric = rubricForCategory(target.category.slug);
  if (!rubric) return { kind: "no-rubric" as const };
  const disabledReason = isViewerSuspended(viewer)
    ? "Your account is suspended, so you can’t send challenges right now."
    : null;
  return { kind: "ready" as const, target, rubric, challengerId: viewerId ?? "", disabledReason };
}
clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <RouteLoading />;
}

export function ErrorBoundary() {
  return <RouteErrorState />;
}

function Header() {
  return (
    <PageHeader
      title="Direct challenge"
      description="A one-on-one debate judged by AI against a published rubric. Both of you see the full terms before anything starts."
    />
  );
}

export default function NewChallengePage() {
  const data = useLoaderData<typeof clientLoader>();

  if (data.kind === "pick-argument") {
    return (
      <PageContainer>
        <Header />
        <EmptyState
          icon={<Swords />}
          title="Pick an argument first"
          description="Challenges start from an argument or a comment. Find a take you disagree with and tap “Challenge this”."
          action={<ButtonLink href="/">Back to the feed</ButtonLink>}
        />
      </PageContainer>
    );
  }

  if (data.kind === "blocked") {
    return (
      <PageContainer>
        <Header />
        <EmptyState
          icon={<Swords />}
          title="This challenge can’t be set up"
          description={data.reason}
          action={
            <ButtonLink href={`/a/${data.argumentId}`} variant="secondary">
              Back to the argument
            </ButtonLink>
          }
        />
      </PageContainer>
    );
  }

  if (data.kind === "no-rubric") {
    return (
      <PageContainer>
        <Header />
        <EmptyState
          icon={<Swords />}
          title="Judging rules unavailable"
          description="We couldn’t load the rubric for this category, so we can’t show you the full terms. Please try again later."
        />
      </PageContainer>
    );
  }

  const { target, rubric, challengerId, disabledReason } = data;
  return (
    <PageContainer>
      <Header />
      <ChallengeSetupForm
        challengerId={challengerId}
        argument={target.argument}
        category={target.category}
        comment={target.comment}
        opponent={target.opponent}
        opponentFixed={target.opponentFixed}
        rubric={rubric}
        disabledReason={disabledReason}
      />
    </PageContainer>
  );
}
