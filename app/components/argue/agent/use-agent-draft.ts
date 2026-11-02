// Owner: 8-explainer-host. Reads a draft the agent wrote with `writeAppStateForCurrentTab` (prefill-appeal,
// prefill-argument) so a form can pre-fill it. The user always submits; this never calls an action.
//
// Why two keys: on the server, `writeAppStateForCurrentTab(key, …)` stores `<key>:<browserTabId>` when the agent
// run carries this tab's id (chat in this tab), and the bare `<key>` when it doesn't (CLI). The app-state HTTP
// route only tab-scopes a fixed set of framework keys (navigation, navigate, …), so `readClientAppState("x")`
// would read the bare key only and miss the agent's tab-scoped write.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteClientAppState,
  getBrowserTabId,
  readClientAppState,
  useChangeVersions,
} from "@agent-native/core/client/hooks";

/** Storage keys to try, most specific first. */
export function agentDraftKeys(key: string, browserTabId: string | null | undefined): string[] {
  return browserTabId ? [`${key}:${browserTabId}`, key] : [key];
}

function currentTabId(): string | null {
  try {
    return typeof window === "undefined" ? null : getBrowserTabId();
  } catch {
    return null;
  }
}

/**
 * The latest agent draft for `key` that passes `accept` (e.g. "is for THIS debate"), or null.
 * Re-reads whenever app state or an action changes. `clear()` deletes both keys (call on submit or cancel).
 */
export function useAgentDraft<T extends Record<string, unknown>>(
  key: string,
  accept: (value: unknown) => value is T,
): { draft: T | null; clear: () => Promise<void> } {
  const version = useChangeVersions(["app-state", "action"]);
  const [draft, setDraft] = useState<T | null>(null);
  const acceptRef = useRef(accept);
  acceptRef.current = accept;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const storageKey of agentDraftKeys(key, currentTabId())) {
        try {
          const value = await readClientAppState<unknown>(storageKey);
          if (value && acceptRef.current(value)) {
            if (!cancelled) setDraft(value);
            return;
          }
        } catch {
          // No draft (or app state unavailable): keep whatever the form already shows.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  const clear = useCallback(async () => {
    setDraft(null);
    await Promise.all(agentDraftKeys(key, currentTabId()).map((k) => deleteClientAppState(k).catch(() => undefined)));
  }, [key]);

  return { draft, clear };
}
