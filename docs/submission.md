# ARGUE IT: Agent-Native Hackathon submission

- **Submit at:** <https://www.builder.io/hackathon/submit>
- **Deadline:** Mon 9 Nov 2026, 11:59 PM PT (Tue 10 Nov, 08:59 Lagos time). Target: Mon 9 Nov, 18:00 Lagos time.
- "Recording a clip alone does not submit an entry." Submit the form too, and save the confirmation to
  `docs/submission-receipt.png`.

## Links

| What | Link |
| --- | --- |
| Public Clips demo (plays logged out) | TBD (owner: human, Task 13 Step 2) |
| Repository | TBD (owner: human, if made public) |
| Deployment | TBD (owner: Task 13 Step 1; optional) |

## Title

ARGUE IT: debates judged by a blind AI, run with an agent, and people stay in control.

## Description

ARGUE IT is a social debating app. You post a hot take, others pick a side, and anyone can challenge you to a
one-on-one debate. Both sides write an opening and a rebuttal. An AI judge then scores the debate on a published
rubric. It is blind to who wrote what and reads the debate twice, in swapped order. Every score is backed by a
quote that is checked against the text. If the two readings disagree, it never forces a winner: the debate goes
to a human.

On Agent-Native, the agent has three real jobs, and people stay in control of every decision:

- **Moderator & Appeals agent.** It triages the review queue (appeals, inconclusive verdicts, prompt-injection
  flags) and drafts a decision for each item, with citations copied exactly from both sides. The moderator edits
  the draft and approves it, or discards it. The audit log records whether a human changed the agent's note. The
  agent cannot decide on its own: those actions require approval, and only moderators can draft.
- **Verdict Explainer.** On a verdict page you click "Ask why" on a criterion. The agent explains from the stored
  judging passes and quotes, and never re-judges. If you have a valid ground, it pre-fills your appeal. You edit
  it and submit it.
- **Debate Host.** It turns "osimhen > lookman" into one clear, arguable proposition with the right category and
  rubric, and pre-fills the post. You publish it.

**How it uses Agent-Native:**
- Every user operation is a `defineAction`, so the screens, the agent, the CLI and HTTP call the same code.
- The agent sees the current screen through `view-screen` and navigation state.
- Each role is a skill file plus actions plus a UI where a human approves: agent drafts are SQL rows, and form
  pre-fills are tab-scoped application state.
- Pages refresh as soon as the agent writes.
- The judge runs in a framework background job.

**Category:** Most Creative App / Best Use of Agent-Native.

## Disclosure (pre-existing work)

PRD written 30 Oct 2026 and a first Next.js version built 31 Oct 2026 (both after the 27 Oct start). During the
event we ported it to Agent-Native and added the Moderator & Appeals agent, Verdict Explainer and Debate Host.
Built with AI assistance (Claude Code). Libraries: Agent-Native, React Router, Drizzle, PGlite, zod,
Anthropic/Builder.io model connection.

Template: scaffolded from the Agent-Native `chat` template (`@agent-native/core` 0.222.2). The domain layer (judge,
fairness suite, competitions, appeals, moderation, reputation) was carried over from the 31 Oct Next.js version
behind thin shims. The web layer, the actions, the agent roles, their skills and their approval UI were written
during the event.
<!-- TBD (owner: human): confirm the model connection actually used (Anthropic key or Builder.io) and trim the
     disclosure's last library to match. -->

## Team

TBD (owner: human)

## Checklist before submitting

- [ ] The Clips demo uses a real provider (not `JUDGE_PROVIDER=mock`), and the verdict page shows a real model id.
- [ ] The Clips link plays in a private, logged-out window.
- [ ] The form is submitted, and the confirmation is saved to `docs/submission-receipt.png`.
