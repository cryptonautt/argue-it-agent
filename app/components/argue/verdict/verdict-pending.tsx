// Owner: verdict. What the verdict page shows before (or instead of) a verdict.
import { CircleSlash, Hourglass, Swords, UserCheck } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import type { CompetitionStatus } from "@domain/db/schema";

const COPY: Partial<Record<CompetitionStatus, { icon: ReactNode; title: string; description: string }>> = {
  locked: {
    icon: <Hourglass />,
    title: "The AI judge is about to start",
    description: "Submissions are locked. The judge reads them blind, twice, in swapped order. This usually takes a few minutes.",
  },
  evaluating: {
    icon: <Hourglass />,
    title: "The AI judge is reviewing this debate",
    description:
      "It reads both sides blind, twice, in swapped order, and runs two more passes if those disagree. Refresh in a few minutes.",
  },
  needs_review: {
    icon: <UserCheck />,
    title: "A human is checking this one",
    description:
      "The judging passes didn't agree confidently enough, or the evaluation failed, so a reviewer who isn't in the debate will decide. We never force a winner.",
  },
  under_appeal: {
    icon: <UserCheck />,
    title: "This verdict is under appeal",
    description: "A reviewer is looking at the appeal.",
  },
  cancelled: {
    icon: <CircleSlash />,
    title: "No verdict: the debate was cancelled",
    description: "Cancelled debates aren't judged and don't change anyone's rating.",
  },
};

const IN_PROGRESS: { icon: ReactNode; title: string; description: string } = {
  icon: <Swords />,
  title: "No verdict yet",
  description: "This debate is still in progress. The AI verdict appears here once both rounds close.",
};

const ENDED: { icon: ReactNode; title: string; description: string } = {
  icon: <CircleSlash />,
  title: "This challenge never started",
  description: "It was declined, withdrawn or expired before both sides accepted, so there's nothing to judge.",
};

export function VerdictPending({ competitionId, status }: { competitionId: string; status: CompetitionStatus }) {
  const copy =
    COPY[status] ??
    (status === "declined" || status === "expired" || status === "withdrawn" ? ENDED : IN_PROGRESS);
  return (
    <div aria-live="polite">
      <EmptyState
        icon={copy.icon}
        title={copy.title}
        description={copy.description}
        action={
          <ButtonLink href={`/c/${competitionId}`} variant="secondary">
            Go to the debate
          </ButtonLink>
        }
      />
    </div>
  );
}
