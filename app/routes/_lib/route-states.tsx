/**
 * Shared loading and error states for the 5b screens. Each route re-exports these as its own
 * `HydrateFallback` / `ErrorBoundary`, so a 404 or a load error renders inside the app shell (the agent
 * sidebar stays mounted) instead of bubbling to the root boundary.
 */
import { AlertTriangle, Lock, SearchX } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";

import { PageContainer } from "@/components/argue/shell/page";
import { ButtonLink } from "@/components/argue/ui/button";
import { EmptyState } from "@/components/argue/ui/empty-state";
import { Skeleton, SkeletonCard } from "@/components/argue/ui/skeleton";

/** Shown during SSR and while the first clientLoader runs (the SSR shell never carries per-user data). */
export function RouteLoading() {
  return (
    <PageContainer>
      <div className="flex flex-col gap-4 pb-10" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-2/3" />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </PageContainer>
  );
}

function errorMessage(data: unknown): string | null {
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  return typeof data === "string" && data ? data : null;
}

export function RouteErrorState() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return (
        <PageContainer>
          <EmptyState
            icon={<SearchX aria-hidden />}
            title="Not found"
            description="This page doesn't exist, or you can't see it."
            action={<ButtonLink href="/">Back to the feed</ButtonLink>}
          />
        </PageContainer>
      );
    }
    if (error.status === 403 || error.status === 423) {
      return (
        <PageContainer>
          <EmptyState
            icon={<Lock aria-hidden />}
            title={error.status === 423 ? "Your account is suspended" : "You can't open this page"}
            description={errorMessage(error.data) ?? undefined}
            action={<ButtonLink href="/">Back to the feed</ButtonLink>}
          />
        </PageContainer>
      );
    }
  }
  const message = isRouteErrorResponse(error) ? errorMessage(error.data) : null;
  return (
    <PageContainer>
      <EmptyState
        icon={<AlertTriangle aria-hidden />}
        title="Something went wrong"
        description={message ?? "We couldn't load this page. Try again in a moment."}
        action={<ButtonLink href="/">Back to the feed</ButtonLink>}
      />
    </PageContainer>
  );
}
