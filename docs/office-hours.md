# Office hours

**When:** Tue 3 Nov 2026, 8:30 AM PT (16:30 Lagos, UTC+1). Agent-Native Hackathon office hours.

## Questions

1. Is "Use Builder.io" LLM usage free for hackathon entries, and is there a quota?
2. Our judge is a fixed multi-pass scorer (blind case file, two passes in swapped order, quote checks) that runs in a
   background job through `resolveEngine()`. Is that acceptable "use of Agent-Native", or do you want it through
   `decide()`?
3. What's the recommended way to seed several demo accounts in the framework's Better Auth?
   (Our spike findings are under "Seeding" below.)
4. Does "Clips" mean the hosted Builder Clips or the `clips` template?

## Answers

_To fill in during the session (Tue 3 Nov)._

1. 
2. 
3. 
4. 

## Findings recorded during the build

Other tasks append what they learn here (the seeding spike from Task 2, which judge path won from Task 4).

## Seeding

Seeding spike (Task 2, Step 5, about 30 min, code reading only; not yet verified against a running server).
Question for office hours: what is the recommended way to seed several demo accounts in the framework's Better Auth?

What we found in `@agent-native/core@0.222.2`:

- **No public in-process sign-up.** The Better Auth instance accessor `getBetterAuth()` (its `api.signUpEmail({ body: { email, password, name } })`) lives in `dist/server/better-auth-instance.js`. It is **not** re-exported from `@agent-native/core/server`, and the package `exports` map blocks a deep import. `@agent-native/toolkit/app/auth/server` exports only `createToolkitAuthPlugin`, `renderAuthPage` and `renderAuthResetPasswordPage`.
- `createBetterAuthSessionForEmail(email)` **is** exported from `@agent-native/core/server`, but it only creates a session for an **existing** Better Auth user. It returns `null` when there is no such user, so it can't create accounts.
- **Programmatic path (HTTP, needs the dev server running):** `POST {origin}/_agent-native/auth/register` with JSON `{ "email": "...", "password": "..." }`.
  - Inside, the route calls `auth.api.signUpEmail` (the name becomes the email's local part).
  - Passwords need at least 12 characters (`PASSWORD_MIN_LENGTH`).
  - In development, email verification is skipped (`NODE_ENV=development`, or `AUTH_SKIP_EMAIL_VERIFICATION=1`), so the account works straight away.
  - Better Auth may check `Origin`, so send `Origin: <origin>`.
  - A seed helper can loop over the 4 demo emails, `POST` each one, and treat "user already exists" as success (idempotent).
- **ARGUE IT side.** The seed (Task 9) keys on email. The auth bridge (`server/domain/auth`) matches the framework session email to `users.email` case-insensitively, so the seeded `users` and `profiles` rows bind to whichever framework account signs in with that email.

**Fallback (if the register route doesn't work):** create the 4 demo accounts by hand through the sign-up page, then run the seed, which keys on email.
