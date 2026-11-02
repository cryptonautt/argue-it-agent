# ARGUE IT — Agent Guide

ARGUE IT is a debate app built on Agent-Native (ported from the Next.js reference app). People post arguments, challenge each other to two-round debates, and a blind AI judge (background job, never an action) scores both sides. Appeals and undecided debates go to human moderators. The agent drafts and explains; people decide. Actions carry capabilities; screens exist only for durable workflows.

## Actions

Every ARGUE IT action wraps the reference domain function unchanged (`server/domain/**`, imported as `@domain/*`) through `runDomain` in `server/lib/domain-action.ts`. Input schemas are the reference zod schemas (`server/lib/domain-action-schemas.ts`); `idempotencyKey` is optional (the server fills one in). Failures throw a typed action error whose `errorCode` is the reference `ActionErrorCode` (`VALIDATION`, `UNAUTHENTICATED`, `SUSPENDED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `IN_PROGRESS`, `INTERNAL`) plus `NEEDS_HANDLE` (signed in, no ARGUE IT profile yet), with `details.fieldErrors` for VALIDATION. Results are JSON (ISO date strings).

| Action | Wraps (reference) | HTTP | Who / gate | Use it to |
| --- | --- | --- | --- | --- |
| `list-feed` | `arguments/actions.loadFeedPage` (first page: `arguments/feed.getFeedPage`) | GET | signed in | Page through the feed (`tab`, `category`, `cursor` from `nextCursor`). |
| `get-argument` | `arguments/queries.getArgumentDetail` + positions, debates, comments | GET | signed in; hidden/removed bodies only for staff or author | Read one argument by `id`. |
| `list-categories` | `arguments/queries.listActiveCategories` | GET | signed in | Get category slugs for create/filter. |
| `create-argument` | `arguments/actions.createArgument` | POST | signed in, not suspended | Publish an argument. |
| `set-position` | `social/actions.setPosition` | POST | signed in | AGREE / AGAINST on an argument. |
| `create-comment` | `social/actions.createComment` | POST | signed in | Comment or reply (never judged). |
| `send-challenge` | `competitions/actions.sendChallenge` | POST | signed in | Start a debate on an argument (terms frozen at send). |
| `respond-to-challenge` | `competitions/actions.acceptChallenge` / `declineChallenge` | POST | the recipient | `response: "accept" \| "decline"`; accept needs `termsHash` from `get-competition`. |
| `get-competition` | `competitions/queries.getCompetitionRoom` | GET | signed in; drafts sealed | Read the debate room by `id`. |
| `save-submission` | `competitions/actions.saveSubmission` | POST | a debater | Save a draft for the current round. |
| `lock-submission` | `competitions/actions.lockSubmission` | POST | a debater; `needsApproval` | Make the round entry final (the user's act). |
| `get-verdict` | `appeals/queries.getVerdictPageData` | GET | signed in | Read the verdict, scores, quotes, appeals, eligibility. |
| `file-appeal` | `appeals/actions.fileAppeal` | POST | a debater; `needsApproval` | Appeal the current verdict (the user's act). |
| `list-review-queue` | `appeals/queries.getReviewQueue` + `getAppealQueue` | GET | `authorize`: moderator | Read both review queues. |
| `decide-appeal` | `appeals/actions.decideAppeal` | POST | `authorize`: moderator; `needsApproval` | Uphold / reevaluate / overturn an appeal (a human decision). |
| `resolve-review` | `appeals/actions.resolveReview` | POST | `authorize`: moderator; `needsApproval` | Settle a needs-review debate (a human decision). |
| `retry-evaluation` | `appeals/actions.retryFailedEvaluation` | POST | `authorize`: moderator | Re-queue a judge run that failed outright. |
| `get-profile` | `profiles/queries.getProfileByHandle` + record, history | GET | signed in | Read a profile by `handle`. |
| `create-profile` | new: insert `users` + `profiles` for the signed-in email | POST | framework session, no profile yet | Onboarding (`/welcome`): pick a handle. |

The agent never finalises a verdict, appeal decision or moderation action: those actions require human approval per agent call, and the UI path is a human click. Agent-role actions (screen context, drafts, explainer, prefill) are documented by their skills in `.agents/skills/`.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids (ARGUE IT routes: feed `/`, argument `/a/<id>`, new argument `/new`, debate `/c/<id>`, verdict `/c/<id>/verdict`, review queue `/admin/review`, profile `/u/<handle>`, rules `/rules`). Chat is `chat` at `/chat` and `/chat/<threadId>`.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
