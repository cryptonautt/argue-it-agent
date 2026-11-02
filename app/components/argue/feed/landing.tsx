import type { ReactNode } from "react";
import { Gavel, MessageSquare, PenLine, ScanEye, Shuffle, Swords, Users } from "lucide-react";
import { ArgumentCard } from "@/components/argue/arguments/argument-card";
import { ButtonLink } from "@/components/argue/ui/button";
import { ScoreBar, SplitBar } from "@/components/argue/ui/score-bar";
import { SideTag } from "@/components/argue/ui/side-tag";
import type { ArgumentCardData } from "@domain/arguments/types";

/**
 * Signed-out home: explain the loop (post → argue → challenge → AI verdict) in one screen, show real
 * arguments when there are any (clearly labelled examples otherwise), and invite sign-up.
 */
export function Landing({ live }: { live: ArgumentCardData[] }) {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="grid items-center gap-10 pt-10 pb-14 md:grid-cols-[1.05fr_1fr] md:pt-16">
        <div>
          <h1 className="text-6xl leading-[0.95] text-ink sm:text-7xl">
            Don&apos;t just argue.
            <br />
            Prove your point.
          </h1>
          <p className="mt-5 max-w-md text-lg text-ink-2">
            Post a hot take. Let people pick a side. Then challenge anyone to a one-on-one debate — judged by an AI
            that never sees who you are, and always shows its reasoning.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href="/sign-up" size="lg">
              Join free
            </ButtonLink>
            <ButtonLink href="/explore" size="lg" variant="secondary">
              See what people are arguing
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-ink-3">Free. No stakes, no betting — just the better argument.</p>
        </div>
        <MatchupPreview />
      </section>

      <HowItWorks />

      <section aria-labelledby="live-heading" className="border-t border-line py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="live-heading" className="text-4xl text-ink">
              {live.length > 0 ? "Arguments heating up" : "The kind of takes people argue about"}
            </h2>
            <p className="mt-1 text-ink-2">
              {live.length > 0
                ? "Real arguments from the community right now. Pick a side."
                : "Examples of the arguments you'll find here."}
            </p>
          </div>
          <ButtonLink href="/explore" variant="secondary" size="sm">
            Explore all
          </ButtonLink>
        </div>
        <ul className="mt-6 grid gap-3 md:grid-cols-3">
          {live.length > 0
            ? live.map((argument) => (
                <li key={argument.id}>
                  <ArgumentCard argument={argument} headingLevel="h3" className="h-full" />
                </li>
              ))
            : SAMPLE_TAKES.map((take) => (
                <li key={take.title}>
                  <SampleTake {...take} />
                </li>
              ))}
        </ul>
      </section>

      <section aria-labelledby="fair-heading" className="border-t border-line py-12">
        <h2 id="fair-heading" className="text-4xl text-ink">
          Judged on the argument, not the person
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-3">
          <Principle icon={<ScanEye aria-hidden />} title="Blind">
            The judge sees the two cases as Side A and Side B. No names, followers, likes or ratings.
          </Principle>
          <Principle icon={<Shuffle aria-hidden />} title="Checked twice">
            Every debate is judged twice with the sides in swapped order. If the two reads disagree, it&apos;s judged
            again — or called inconclusive.
          </Principle>
          <Principle icon={<Gavel aria-hidden />} title="Explained">
            You get scores per criterion, quotes from your own words, and a confidence level. Think it got it wrong?
            Appeal.
          </Principle>
        </ul>
        <p className="mt-8 max-w-2xl text-sm text-ink-3">
          No AI judge is perfect. That&apos;s why every verdict shows its reasoning, can come back &ldquo;too close to
          call&rdquo;, and can be appealed to a human reviewer.
        </p>
      </section>

      <section className="my-12 overflow-hidden rounded-[var(--radius-lg)] bg-ink px-6 py-10 text-ink-inverse sm:px-10">
        <h2 className="text-5xl leading-none">Got a take? Back it up.</h2>
        <p className="mt-3 max-w-md text-lg opacity-80">
          Football, music, movies, games, tech, crypto — post your argument and see who&apos;s brave enough to challenge it.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/sign-up" size="lg" variant="judge">
            Create your free account
          </ButtonLink>
          <ButtonLink
            href="/sign-in"
            size="lg"
            variant="ghost"
            className="text-ink-inverse hover:bg-[rgb(255_255_255/0.1)]"
          >
            I have an account
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

const STEPS = [
  {
    icon: PenLine,
    title: "Post a take",
    body: "State one clear claim — “Osimhen is Africa's best striker” — and back it up.",
  },
  {
    icon: Users,
    title: "People pick a side",
    body: "AGREE or AGAINST, comment, reply. Free discussion, never judged.",
  },
  {
    icon: Swords,
    title: "Challenge someone",
    body: "Think they're wrong? Start a one-on-one debate: same rules, sealed openings, then rebuttals.",
  },
  {
    icon: Gavel,
    title: "The AI verdict is in",
    body: "A blind AI judge scores both cases on a published rubric and shows exactly why.",
  },
] as const;

function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="border-t border-line py-12">
      <h2 id="how-heading" className="text-4xl text-ink">
        How it works
      </h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2 rounded-[var(--radius)] border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <span className="slant inline-flex h-8 items-center rounded-[3px] bg-ink px-2.5 font-display text-lg font-bold text-ink-inverse">
                <span className="unslant tabular">{String(index + 1).padStart(2, "0")}</span>
              </span>
              <step.icon aria-hidden className="size-6 text-ink-3" />
            </div>
            <h3 className="mt-2 text-2xl text-ink">{step.title}</h3>
            <p className="text-ink-2">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface SampleTakeProps {
  category: string;
  title: string;
  proposition: string;
  agree: number;
  against: number;
  comments: number;
}

const SAMPLE_TAKES: readonly SampleTakeProps[] = [
  {
    category: "Sports & Football",
    title: "Osimhen is Africa's best striker of this decade",
    proposition: "Victor Osimhen is the best African striker of the 2020s.",
    agree: 412,
    against: 268,
    comments: 96,
  },
  {
    category: "Entertainment",
    title: "Burna Boy is bigger than Wizkid",
    proposition: "Burna Boy has had a bigger global impact than Wizkid.",
    agree: 351,
    against: 377,
    comments: 140,
  },
  {
    category: "Technology",
    title: "AI will create more jobs than it kills",
    proposition: "AI will create more jobs in Nigeria than it destroys over the next ten years.",
    agree: 198,
    against: 233,
    comments: 61,
  },
];

/** A static illustrative card (not a link): shown only before real arguments exist. */
function SampleTake({ category, title, proposition, agree, against, comments }: SampleTakeProps) {
  return (
    <figure className="flex h-full flex-col gap-3 rounded-[var(--radius)] border border-dashed border-line-strong bg-surface p-4">
      <figcaption className="flex items-center justify-between text-xs font-semibold text-ink-3">
        <span>{category}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 uppercase">Example</span>
      </figcaption>
      <p className="font-display text-2xl leading-tight text-ink">{title}</p>
      <p className="text-[0.95rem] text-ink-2">{proposition}</p>
      <SplitBar forValue={agree} againstValue={against} size="sm" className="mt-auto" />
      <p className="flex items-center gap-1.5 text-sm text-ink-3">
        <MessageSquare aria-hidden className="size-4" /> {comments} comments
      </p>
    </figure>
  );
}

function Principle({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-2">
      <span className="text-ink [&_svg]:size-6">{icon}</span>
      <h3 className="text-2xl text-ink">{title}</h3>
      <p className="text-ink-2">{children}</p>
    </li>
  );
}

/** The hero: one debate, both corners, and the judge's card. Static illustration of the core loop. */
function MatchupPreview() {
  return (
    <figure
      aria-label="Example debate"
      className="overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface"
    >
      <div className="border-b border-line px-5 pt-5 pb-4">
        <p className="text-xs font-semibold text-ink-3">Sports &amp; Football · Debate · Example</p>
        <p className="mt-2 font-display text-3xl leading-tight text-ink">
          &ldquo;Messi is a better footballer than Ronaldo.&rdquo;
        </p>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-5">
        <div className="flex flex-col items-start gap-1.5">
          <SideTag side="FOR" />
          <span className="text-sm text-ink-2">Side A</span>
        </div>
        <span className="font-display text-3xl font-extrabold text-ink-3 italic">VS</span>
        <div className="flex flex-col items-end gap-1.5">
          <SideTag side="AGAINST" />
          <span className="text-sm text-ink-2">Side B</span>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-5 pb-5">
        <ScoreBar label="Evidence" forValue={8} againstValue={6.5} weight={30} />
        <ScoreBar label="Rebuttal" forValue={6} againstValue={7.5} weight={20} />
      </div>
      <div className="border-t border-judge bg-judge-soft px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-display text-xl text-ink">
            <Gavel aria-hidden className="size-5" /> The AI verdict is in
          </p>
          <span className="rounded-full bg-judge px-2.5 py-0.5 text-xs font-bold text-on-judge">High confidence</span>
        </div>
        <SplitBar forValue={71} againstValue={64} forLabel="Side A" againstLabel="Side B" size="sm" className="mt-3" />
      </div>
    </figure>
  );
}
