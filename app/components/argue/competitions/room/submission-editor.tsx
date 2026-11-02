"use client";
// Owner: challenges. The formal, judged entry for a round — deliberately unlike the comment composer:
// side-coloured frame, explicit "formal judged entry" labelling, the round's limits and deadline, and a
// separate, confirmed "Lock in" step (PRD §8.4: a formal submission must use a distinct action).

import { useEffect, useState } from "react";
import { Gavel, Lock, Save } from "lucide-react";
import { Button } from "@/components/argue/ui/button";
import { Dialog } from "@/components/argue/ui/dialog";
import { SideTag } from "@/components/argue/ui/side-tag";
import { Textarea } from "@/components/argue/ui/textarea";
import { cn } from "@domain/lib/cn";
import { parseLinkList } from "@domain/lib/links";
import { formatDateTime } from "@domain/lib/time";
import { lockSubmission, saveSubmission } from "@domain/lib/server-actions";
import { useCompetitionAction } from "../use-competition-action";

export interface SubmissionEditorProps {
  competitionId: string;
  round: "opening" | "rebuttal";
  side: "FOR" | "AGAINST";
  maxChars: number;
  maxLinks: number;
  initialBody: string;
  initialLinks: string[];
  /** ISO time of the last saved draft, if any. */
  savedAt: string | null;
  opponentLocked: boolean;
}

const ROUND_NAME = { opening: "opening", rebuttal: "rebuttal" } as const;

export function SubmissionEditor({
  competitionId,
  round,
  side,
  maxChars,
  maxLinks,
  initialBody,
  initialLinks,
  savedAt: initialSavedAt,
  opponentLocked,
}: SubmissionEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [linksText, setLinksText] = useState(initialLinks.join("\n"));
  const [saved, setSaved] = useState({ body: initialBody, links: initialLinks.join("\n") });
  const [savedAt, setSavedAt] = useState(initialSavedAt);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dirty = body !== saved.body || linksText !== saved.links;

  const save = useCompetitionAction(saveSubmission, {
    success: "Draft saved",
    onSuccess: (data) => {
      setSaved({ body, links: linksText });
      setSavedAt(data.savedAt);
    },
  });
  const lock = useCompetitionAction(lockSubmission, {
    success: `Your ${ROUND_NAME[round]} is locked in`,
    onSuccess: () => {
      setSaved({ body, links: linksText });
      setConfirmOpen(false);
    },
  });

  // Don't lose a phone-typed essay to an accidental back swipe.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const input = () => ({ competitionId, round, body, links: parseLinkList(linksText) });
  const empty = body.trim().length === 0;
  const errors = { ...save.fieldErrors, ...lock.fieldErrors };
  const linkError = Object.entries(errors).find(([field]) => field === "links" || field.startsWith("links."))?.[1];
  const isFor = side === "FOR";

  return (
    <section
      aria-labelledby={`editor-${round}`}
      className={cn(
        "rounded-[var(--radius-lg)] border-2 bg-surface p-4 sm:p-5",
        isFor ? "border-for" : "border-against",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SideTag side={side} />
        <h2 id={`editor-${round}`} className="text-2xl text-ink">
          Your {ROUND_NAME[round]}
        </h2>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-judge-soft px-2.5 py-1 text-xs font-semibold text-ink">
          <Gavel aria-hidden className="size-3.5" /> Formal judged entry
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        {round === "opening"
          ? "Make your case. Your opening is sealed: your opponent can’t see it until the round closes, and you can’t see theirs."
          : "Answer your opponent’s opening. Rebuttals are optional but score on the rebuttal criterion, and stay sealed until the round closes."}{" "}
        This is not a comment — the AI judge scores exactly what is entered here.
      </p>
      {opponentLocked ? (
        <p className="mt-2 text-sm font-semibold text-ink" role="status">
          Your opponent has locked in. When you lock in too, the round closes straight away.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        <Textarea
          label={round === "opening" ? "Opening argument" : "Rebuttal"}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={maxChars}
          showCount
          rows={round === "opening" ? 12 : 9}
          error={errors.body}
          placeholder={round === "opening" ? "State your position, give your reasons and your evidence…" : "Where is their case weakest, and why?"}
        />
        <Textarea
          label={`Evidence links (optional, up to ${maxLinks})`}
          hint="One link per line, starting with https://. The judge sees the links but does not open them."
          value={linksText}
          onChange={(event) => setLinksText(event.target.value)}
          rows={3}
          error={linkError}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-xs text-ink-3 sm:mr-auto" aria-live="polite" suppressHydrationWarning>
          {dirty ? "Unsaved changes" : savedAt ? `Draft saved ${formatDateTime(savedAt)}` : "Not saved yet"}
          {" · "}A saved draft is entered as-is if the round closes before you lock in.
        </p>
        <Button
          variant="secondary"
          disabled={empty || !dirty}
          loading={save.pending}
          icon={<Save aria-hidden className="size-4" />}
          onClick={() => save.run(input())}
        >
          Save draft
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={empty}
          icon={<Lock aria-hidden className="size-4" />}
          onClick={() => setConfirmOpen(true)}
        >
          Lock in {ROUND_NAME[round]}
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Lock in your ${ROUND_NAME[round]}?`}
        description="This is your formal entry for this round. Once locked, you can’t edit it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button loading={lock.pending} icon={<Lock aria-hidden className="size-4" />} onClick={() => lock.run(input())}>
              Lock in
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
          <li>The AI judge will score exactly this text ({body.trim().length.toLocaleString("en-GB")} characters) against the rubric.</li>
          <li>It won’t see your name, your profile or who challenged whom.</li>
          <li>Your opponent sees it only after the round closes.</li>
        </ul>
      </Dialog>
    </section>
  );
}
