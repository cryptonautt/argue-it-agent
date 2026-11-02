import { expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { E2E_PORT } from "./constants";

const ORIGIN = `http://localhost:${E2E_PORT}`;

export interface Person {
  page: Page;
  email: string;
  handle?: string;
}

/**
 * Sign a person in through the framework's real Better Auth endpoints (no UI sign-up, no auth bypass).
 * Each person gets their own browser context, so each has their own session cookie.
 *
 * - `/_agent-native/auth/register` creates the Better Auth account (ignored if it already exists, e.g. the
 *   seed created it).
 * - `/_agent-native/auth/login` sets the framework session cookie on this context.
 *
 * The dev server runs with AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT=1 (playwright.config.ts), otherwise every
 * context would be the same auto-created local dev user.
 * If these return 403 at runtime, check the Origin / frontend header requirements first (CSRF).
 */
export async function signIn(
  browser: Browser,
  options: { email: string; password: string; contextOptions?: BrowserContextOptions },
): Promise<Person> {
  const context = await browser.newContext(options.contextOptions);
  const headers = { origin: ORIGIN, "x-agent-native-frontend": "1" };
  const credentials = { email: options.email, password: options.password };

  const login = () => context.request.post("/_agent-native/auth/login", { data: credentials, headers });
  let response = await login();
  if (!response.ok()) {
    const register = await context.request.post("/_agent-native/auth/register", { data: credentials, headers });
    // 4xx here usually means "already exists with another password"; the login below reports the real error.
    if (!register.ok()) console.warn(`register ${options.email}: ${register.status()} ${await register.text()}`);
    response = await login();
  }
  expect(response.ok(), `login ${options.email}: ${response.status()} ${await response.text()}`).toBe(true);

  const page = await context.newPage();
  return { page, email: options.email };
}

/**
 * Call an action the way the UI does (`callAction` from @agent-native/core/client): same origin, the session
 * cookie, and the frontend marker header. Throws with the response body on a non-2xx status.
 */
export async function callAction<T = unknown>(
  page: Page,
  name: string,
  input: Record<string, unknown> = {},
  method: "GET" | "POST" = "POST",
): Promise<T> {
  if (page.url() === "about:blank") await page.goto("/");
  const result = await page.evaluate(
    async ({ name, input, method }) => {
      let url = `/_agent-native/actions/${name}`;
      const init: RequestInit = {
        method,
        credentials: "same-origin",
        headers: { "x-agent-native-frontend": "1", "content-type": "application/json" },
      };
      if (method === "GET") {
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) query.set(key, typeof value === "string" ? value : JSON.stringify(value));
        }
        if ([...query].length) url += `?${query}`;
      } else {
        init.body = JSON.stringify(input);
      }
      const response = await fetch(url, init);
      return { status: response.status, text: await response.text() };
    },
    { name, input, method },
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`action ${name} -> ${result.status}: ${result.text}`);
  }
  return (result.text ? JSON.parse(result.text) : undefined) as T;
}

/**
 * Give a freshly signed-in person an ARGUE IT profile (the `/welcome` step) through the `create-profile`
 * action (Task 5). Input shape assumed from the plan: `{ handle, displayName }`.
 * TODO verify against actions/create-profile.ts once it lands.
 */
export async function createProfile(person: Person, handle: string, displayName: string): Promise<void> {
  await person.page.goto("/welcome");
  await callAction(person.page, "create-profile", { handle, displayName });
  person.handle = handle;
}

/**
 * Save and lock in a formal entry from the competition room (the confirmation dialog is part of the flow).
 * Copied from the reference e2e; the room components are ported unchanged (Task 6), so the labels match.
 */
export async function lockIn(page: Page, round: "opening" | "rebuttal", text: string): Promise<void> {
  const label = round === "opening" ? "Opening argument" : "Rebuttal";
  const editor = page.getByLabel(label, { exact: true });
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await page.getByRole("button", { name: `Lock in ${round}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Lock in", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Depth-first search for the first object in an unknown JSON shape that satisfies `match`. */
export function findDeep<T>(value: unknown, match: (v: Record<string, unknown>) => boolean): T | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && match(value as Record<string, unknown>)) return value as T;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findDeep<T>(child, match);
    if (found) return found;
  }
  return undefined;
}

/** Every object in an unknown JSON shape that satisfies `match`. */
export function findAllDeep<T>(value: unknown, match: (v: Record<string, unknown>) => boolean, out: T[] = []): T[] {
  if (value === null || typeof value !== "object") return out;
  if (!Array.isArray(value) && match(value as Record<string, unknown>)) out.push(value as T);
  for (const child of Array.isArray(value) ? value : Object.values(value)) findAllDeep(child, match, out);
  return out;
}
