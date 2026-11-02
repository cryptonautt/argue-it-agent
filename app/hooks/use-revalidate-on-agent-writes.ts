/**
 * Review Focus #4: route loaders don't refetch when the agent writes through a tool call.
 * The framework advances the `action` change-version on every successful mutating action and on
 * local chat-run side effects; when it moves, re-run the active route loaders once.
 * Mounted once in app/root.tsx.
 */
import { useChangeVersions } from "@agent-native/core/client/hooks";
import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

const SOURCES = ["action"] as const;

export function useRevalidateOnAgentWrites(): void {
  const version = useChangeVersions(SOURCES);
  const revalidator = useRevalidator();
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;
  const lastVersion = useRef(version);

  useEffect(() => {
    if (lastVersion.current === version) return;
    lastVersion.current = version;
    void revalidatorRef.current.revalidate();
  }, [version]);
}
