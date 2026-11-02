/**
 * Owner: moderation. Public server API for other teams (import from "@domain/moderation").
 *
 * Spam screening (arguments, comments, social):
 *   const assessment = await assessContent(user.id, text, links);   // text: what the user wrote
 *   assertContentAllowed(assessment);                               // throws ActionError on "block"
 *   …insert…
 *   await flagForReviewIfNeeded(assessment, { type: "comment", id }, tx);  // "review" → automatic report
 *
 * Automatic reports (judge's prompt-injection pre-scan, design §4.3.4):
 *   await openAutomaticReport({ targetType: "submission", targetId, reason: "prompt_injection", details }, tx);
 *
 * Cron (integration): await liftExpiredSuspensions();
 *
 * Server actions (fileReport, moderateContent, warnUser, suspendUser, …) live in ./actions.
 */
import "server-only";

export { assessContent, assertContentAllowed, flagForReviewIfNeeded } from "./spam";
export type { AssessOptions, ContentAssessment, ContentDecision, SpamSignal, SpamSignalCode } from "./spam";
export { liftExpiredSuspensions, openAutomaticReport } from "./service";
export type { AutomaticReportInput, AutomaticReportResult } from "./service";
export type { TargetRef } from "./targets";
