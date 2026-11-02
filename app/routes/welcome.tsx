// Owner: 5b-screens-b (adapted from reference src/app/welcome/page.tsx). Onboarding after framework sign-up.
//
// New role in the Agent-Native port: the framework owns sign-in, ARGUE IT owns the `users` row. A signed-in
// email with no `users` row ("needs-handle", Task 2 `ensureAppUser`) is sent here by every screen's loader
// (app/routes/_lib/route-data.ts) as /welcome?setup=1&next=<path>. This page then lets the person pick a
// handle through the `create-profile` action and returns them to `next`. Without `setup=1` it shows the
// "how ARGUE IT works" explainer only.
//
// Not ported: the reference "What do you argue about?" interests picker (`saveInterests` has no action yet).
import { callAction } from "@agent-native/core/client/hooks";
import { Gavel, MessageCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  redirectDocument,
  useLoaderData,
  useNavigate,
  type ClientLoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import { PageContainer } from "@/components/argue/shell/page";
import { Button } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { Input } from "@/components/argue/ui/input";
import { SideTag } from "@/components/argue/ui/side-tag";
import { handleSchema } from "@domain/lib/handles";
import { safeRedirectPath } from "@domain/lib/redirect";

import { getFrameworkEmail, readLoadError, returnPathOf, signInHref } from "./_lib/route-data";
import { RouteErrorState, RouteLoading } from "./_lib/route-states";

export async function clientLoader({ request }: ClientLoaderFunctionArgs) {
  const email = await getFrameworkEmail();
  if (!email) throw redirectDocument(signInHref(returnPathOf(request)));
  const search = new URL(request.url).searchParams;
  return {
    email,
    needsHandle: search.get("setup") === "1",
    next: safeRedirectPath(search.get("next"), "/"),
  };
}
clientLoader.hydrate = true as const;

export const meta: MetaFunction = () => [{ title: "Welcome · ARGUE IT" }];

export const HydrateFallback = RouteLoading;
export const ErrorBoundary = RouteErrorState;

/** Suggest a handle from the email's local part; the person can change it. */
function suggestHandle(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
}

function HandleForm({ email, next }: { email: string; next: string }) {
  const navigate = useNavigate();
  const [handle, setHandle] = useState(() => suggestHandle(email));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = handleSchema.safeParse(handle);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your handle.");
      return;
    }
    setPending(true);
    try {
      await callAction("create-profile", { handle: parsed.data });
      navigate(next, { replace: true });
    } catch (err) {
      const e = readLoadError(err);
      const details = (err as { details?: { fieldErrors?: Record<string, unknown> } } | null)?.details;
      const fieldError = details?.fieldErrors?.handle;
      setError(
        Array.isArray(fieldError) && fieldError.length > 0
          ? String(fieldError[0])
          : e.code === "CONFLICT"
            ? "That handle is taken, or you already have a profile. Try another handle."
            : e.message,
      );
      setPending(false);
    }
  }

  return (
    <Card tone="judge">
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <h2 className="text-2xl text-ink">Pick your handle</h2>
        <p className="text-sm text-ink-2">
          This is your name on debates and verdicts: 3–20 lowercase letters, numbers or underscores. Signed in as{" "}
          {email}.
        </p>
        <Input
          label="Handle"
          name="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          error={error ?? undefined}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            Continue
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function WelcomePage() {
  const { email, needsHandle, next } = useLoaderData<typeof clientLoader>();

  return (
    <PageContainer>
      <div className="space-y-8 pb-10">
        <header>
          <p className="slant inline-flex h-7 items-center rounded-[3px] bg-ink px-3 font-display font-bold tracking-wide text-ink-inverse">
            <span className="unslant">WELCOME TO ARGUE IT</span>
          </p>
          <h1 className="mt-3 text-4xl break-words text-ink sm:text-5xl">
            {needsHandle ? "One step left." : "You're in."}
          </h1>
          <p className="mt-2 max-w-prose text-ink-2">Two ways to argue here. One is casual. One gets judged.</p>
        </header>

        {needsHandle ? <HandleForm email={email} next={next} /> : null}

        <section aria-labelledby="how-heading" className="space-y-3">
          <h2 id="how-heading" className="sr-only">
            How ARGUE IT works
          </h2>
          <Card>
            <div className="mb-2 flex items-center gap-2">
              <MessageCircle aria-hidden className="size-5 text-ink-3" />
              <h3 className="text-2xl text-ink">Pick a side &amp; comment</h3>
            </div>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              Take an <SideTag side="AGREE" size="sm" /> or <SideTag side="AGAINST" size="sm" /> position on any take.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li>Free, and you can change your mind any time.</li>
              <li>Comments are open discussion. They are never judged and never count as a debate entry.</li>
              <li>None of this touches your debate rating.</li>
            </ul>
          </Card>

          <Card tone="judge">
            <div className="mb-2 flex items-center gap-2">
              <Gavel aria-hidden className="size-5" />
              <h3 className="text-2xl text-ink">Direct challenge</h3>
            </div>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              Think someone&apos;s wrong? Hit “Challenge this” for a one-on-one debate: one of you argues
              <SideTag side="FOR" size="sm" /> the claim, the other <SideTag side="AGAINST" size="sm" />.
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
              <li>You both see and agree to the exact terms and scoring rubric before it starts.</li>
              <li>
                Openings are sealed — neither side sees the other&apos;s until both are in. Then each side gets a
                rebuttal.
              </li>
              <li>
                The AI judge reads the debate <strong>without names, followers or ratings</strong>, twice, with the
                sides in swapped order, and shows its reasons with quotes from each side.
              </li>
              <li>If it&apos;s too close or unclear, the verdict says so instead of forcing a winner. You can appeal once.</li>
              <li>Only these AI verdicts move your debate rating. Everyone starts at 1,500.</li>
            </ol>
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
