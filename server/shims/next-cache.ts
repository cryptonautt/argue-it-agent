/**
 * Alias target for `next/cache` in server code. Next's cache revalidation has no meaning in the
 * Agent-Native app: UI refresh after writes (including agent writes) is handled by the client hook
 * `useRevalidateOnAgentWrites` (Task 6). Both functions are deliberate no-ops.
 */
export function revalidatePath(_path?: string, _type?: "page" | "layout"): void {}

export function revalidateTag(_tag?: string): void {}

export function refresh(): void {}
