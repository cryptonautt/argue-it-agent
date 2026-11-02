// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  version: 0,
  revalidate: vi.fn(),
  sources: [] as unknown[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useChangeVersions: (sources: readonly string[]) => {
    state.sources.push(sources);
    return state.version;
  },
}));

vi.mock("react-router", () => ({
  // A fresh object every render, like a real hook might return: the hook must not re-fire on identity.
  useRevalidator: () => ({ revalidate: state.revalidate, state: "idle" }),
}));

import { useRevalidateOnAgentWrites } from "./use-revalidate-on-agent-writes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useRevalidateOnAgentWrites();
  return null;
}

describe("useRevalidateOnAgentWrites", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.version = 0;
    state.revalidate.mockReset();
    state.sources = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("revalidates once when the action change-version increments", () => {
    act(() => root.render(<Probe />));
    expect(state.revalidate).not.toHaveBeenCalled();
    expect(state.sources.at(-1)).toEqual(["action"]);

    // Re-rendering with the same version does nothing.
    act(() => root.render(<Probe />));
    expect(state.revalidate).not.toHaveBeenCalled();

    // The agent writes: the action counter moves.
    state.version = 1;
    act(() => root.render(<Probe />));
    expect(state.revalidate).toHaveBeenCalledTimes(1);

    // Further renders at the same version don't revalidate again.
    act(() => root.render(<Probe />));
    act(() => root.render(<Probe />));
    expect(state.revalidate).toHaveBeenCalledTimes(1);
  });
});
