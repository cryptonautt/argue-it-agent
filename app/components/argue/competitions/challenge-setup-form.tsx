"use client";
// Owner: challenges. /challenge/new form: proposition, side, round length, opponent → full terms review
// → send. The review step renders the exact snapshot the server will freeze (same pure builder).

import { useRouter } from "@/shims/next-navigation";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Swords } from "lucide-react";
import { Avatar } from "@/components/argue/ui/avatar";
import { Button } from "@/components/argue/ui/button";
import { Card } from "@/components/argue/ui/card";
import { Input } from "@/components/argue/ui/input";
import { Textarea } from "@/components/argue/ui/textarea";
import { cn } from "@domain/lib/cn";
import { sendChallenge, type SendChallengeInput } from "@/lib/server-actions";
import {
  PROPOSITION_MAX_CHARS,
  ROUND_DURATION_HOURS,
  buildRulesSnapshot,
  otherSide,
  type RoundDurationHours,
  type RubricView,
} from "@domain/competitions/terms";
import { TermsPanel } from "./terms-panel";
import { useCompetitionAction } from "./use-competition-action";

type Side = "FOR" | "AGAINST";

export interface ChallengeSetupFormProps {
  challengerId: string;
  argument: { id: string; title: string; proposition: string };
  category: { id: string; slug: string; name: string };
  comment: { id: string; excerpt: string } | null;
  /** Pre-resolved opponent (argument author, commenter, or ?opponent=). */
  opponent: { userId: string; handle: string; displayName: string; avatarUrl: string | null } | null;
  /** True when challenging from a comment: the opponent is the commenter and can't be changed. */
  opponentFixed: boolean;
  rubric: RubricView;
  disabledReason: string | null;
}

const MIN_PROPOSITION = 10;

export function ChallengeSetupForm({
  challengerId,
  argument,
  category,
  comment,
  opponent,
  opponentFixed,
  rubric,
  disabledReason,
}: ChallengeSetupFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [proposition, setProposition] = useState(argument.proposition);
  const [side, setSide] = useState<Side | null>(null);
  const [duration, setDuration] = useState<RoundDurationHours>(24);
  const [changingOpponent, setChangingOpponent] = useState(opponent === null);
  const [opponentHandle, setOpponentHandle] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const { run, pending, fieldErrors } = useCompetitionAction<SendChallengeInput, { competitionId: string }>(
    sendChallenge,
    {
      success: "Challenge sent",
      onSuccess: (data) => router.push(`/c/${data.competitionId}`),
    },
  );

  const typedHandle = opponentHandle.trim().replace(/^@/, "").toLowerCase();
  const opponentLabel = changingOpponent ? (typedHandle ? `@${typedHandle}` : "your opponent") : `@${opponent?.handle}`;

  const preview = useMemo(
    () =>
      side
        ? buildRulesSnapshot({
            proposition,
            argumentId: argument.id,
            sourceCommentId: comment?.id ?? null,
            category,
            rubric: { id: rubric.id, version: rubric.version },
            challengerId,
            recipientId: opponent?.userId ?? "",
            challengerSide: side,
            roundDurationHours: duration,
            sentAt: new Date(0),
          })
        : null,
    [side, proposition, argument.id, comment, category, rubric, challengerId, opponent, duration],
  );

  function review(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (proposition.trim().length < MIN_PROPOSITION) {
      errors.proposition = "Write the proposition as one clear statement both sides can argue.";
    }
    if (!side) errors.side = "Choose the side you will argue.";
    if (changingOpponent && !typedHandle) errors.opponentHandle = "Enter the handle of the person you want to challenge.";
    setLocalErrors(errors);
    if (Object.keys(errors).length === 0) {
      setStep("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function send() {
    if (!side) return;
    run({
      argumentId: argument.id,
      commentId: comment?.id ?? null,
      opponentId: changingOpponent ? null : (opponent?.userId ?? null),
      opponentHandle: changingOpponent ? typedHandle : null,
      proposition,
      challengerSide: side,
      roundDurationHours: duration,
    });
  }

  const errorFor = (field: string) => localErrors[field] ?? fieldErrors[field];

  if (step === "review" && preview && side) {
    const forName = side === "FOR" ? "You" : opponentLabel;
    const againstName = side === "AGAINST" ? "You" : opponentLabel;
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="text-2xl text-ink">Review the terms</h2>
          <p className="mt-1 text-sm text-ink-2">
            This is exactly what {opponentLabel} will see. Once they accept, none of it can change.
          </p>
          <TermsPanel className="mt-4" terms={preview} rubric={rubric} forName={forName} againstName={againstName} />
        </Card>
        {Object.keys(fieldErrors).length > 0 ? (
          <p role="alert" className="text-sm font-medium text-danger">
            Something in the setup needs fixing. Go back to edit it.
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="lg" onClick={() => setStep("edit")} icon={<ArrowLeft aria-hidden className="size-4" />}>
            Back to edit
          </Button>
          <Button
            size="lg"
            loading={pending}
            onClick={send}
            disabled={disabledReason !== null}
            icon={<Swords aria-hidden className="size-4" />}
          >
            Send challenge
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={review} noValidate className="flex flex-col gap-5">
      <Card>
        <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">From the argument</p>
        <p className="mt-1 font-semibold text-ink">{argument.title}</p>
        {comment ? (
          <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-ink-2">{comment.excerpt}</blockquote>
        ) : null}
      </Card>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-ink">Your opponent</legend>
        {!changingOpponent && opponent ? (
          <div className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface p-3">
            <Avatar name={opponent.displayName} src={opponent.avatarUrl} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-ink">{opponent.displayName}</p>
              <p className="truncate text-sm text-ink-3">@{opponent.handle}</p>
            </div>
            {!opponentFixed ? (
              <Button variant="ghost" size="sm" onClick={() => setChangingOpponent(true)}>
                Change
              </Button>
            ) : null}
          </div>
        ) : (
          <Input
            label="Their handle"
            hideLabel
            placeholder="@handle"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={opponentHandle}
            onChange={(event) => setOpponentHandle(event.target.value)}
            error={errorFor("opponentHandle")}
            hint="Anyone can be challenged, as long as neither of you has blocked the other."
          />
        )}
      </fieldset>

      <Textarea
        label="The proposition"
        hint="Both sides argue this exact statement. Keep it clear and specific — the judge scores against it."
        value={proposition}
        onChange={(event) => setProposition(event.target.value)}
        maxLength={PROPOSITION_MAX_CHARS}
        showCount
        rows={3}
        required
        error={errorFor("proposition")}
      />

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Your side</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["FOR", "AGAINST"] as const).map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-16 cursor-pointer items-center gap-3 rounded-[var(--radius)] border-2 p-3 transition-colors",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                side === option
                  ? option === "FOR"
                    ? "border-for bg-for-soft"
                    : "border-against bg-against-soft"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <input
                type="radio"
                name="side"
                value={option}
                checked={side === option}
                onChange={() => setSide(option)}
                className="sr-only"
              />
              <span
                className={cn(
                  "slant inline-flex h-8 items-center rounded-[3px] px-3 font-display text-lg font-bold",
                  option === "FOR" ? "bg-for text-on-for" : "bg-against text-on-against",
                )}
              >
                <span className="unslant">{option}</span>
              </span>
              <span className="text-sm text-ink">
                {option === "FOR" ? "I’ll argue it’s true" : "I’ll argue it’s false"}
                <span className="block text-xs text-ink-3">
                  {opponentLabel} gets {otherSide(option)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errorFor("side") ? (
          <p role="alert" className="mt-1.5 text-sm font-medium text-danger">
            {errorFor("side")}
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Time for each round</legend>
        <div className="flex gap-2">
          {ROUND_DURATION_HOURS.map((hours) => (
            <label
              key={hours}
              className={cn(
                "flex h-11 flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-2 font-semibold",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
                duration === hours ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink",
              )}
            >
              <input
                type="radio"
                name="duration"
                value={hours}
                checked={duration === hours}
                onChange={() => setDuration(hours)}
                className="sr-only"
              />
              {hours}h
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-sm text-ink-3">
          Two rounds of {duration} hours. Your opponent has 48 hours to accept.
        </p>
      </fieldset>

      {disabledReason ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {disabledReason}
        </p>
      ) : null}

      <Button type="submit" size="lg" fullWidth disabled={disabledReason !== null}>
        Review terms
      </Button>
    </form>
  );
}
