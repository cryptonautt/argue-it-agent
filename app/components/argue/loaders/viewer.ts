import { callAction } from "@agent-native/core/client/hooks";

import { normaliseViewer, type ArgueViewer } from "./screen-a";

/**
 * Calls the `get-session` GET action and shapes it: the signed-in ARGUE IT user, or `null` when signed
 * out. Rethrows what `callAction` throws (e.g. errorCode `NEEDS_HANDLE`: a framework session with no
 * ARGUE IT profile yet), so a route can map it with `readLoadError` / `responseForLoadError`.
 * Do not use `loadAction` for this one: it turns the signed-out `null` into a 404.
 */
export async function fetchViewer(): Promise<ArgueViewer | null | undefined> {
  return normaliseViewer(await callAction("get-session", {}, { method: "GET" }));
}

/**
 * Like `fetchViewer`, but never throws: `undefined` when unknown (the call failed, or `NEEDS_HANDLE`).
 * Callers hide viewer-dependent controls when it's `undefined` rather than guessing.
 */
export async function loadViewer(): Promise<ArgueViewer | null | undefined> {
  try {
    return await fetchViewer();
  } catch {
    return undefined;
  }
}
