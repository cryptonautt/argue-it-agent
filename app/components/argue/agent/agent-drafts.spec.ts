import { describe, expect, it } from "vitest";
import { agentDraftKeys } from "./use-agent-draft";
import { isAppealDraftFor } from "./verdict-agent";
import { isArgumentDraft } from "./sharpen-with-agent";

describe("agent draft keys", () => {
  it("reads the tab-scoped key the agent wrote first, then the bare key (CLI writes)", () => {
    expect(agentDraftKeys("appeal-draft", "tab-123")).toEqual(["appeal-draft:tab-123", "appeal-draft"]);
    expect(agentDraftKeys("appeal-draft", null)).toEqual(["appeal-draft"]);
  });
});

describe("isAppealDraftFor", () => {
  const accept = isAppealDraftFor("c-1");
  it("accepts a well-formed draft for this debate only", () => {
    expect(accept({ competitionId: "c-1", ground: "factual_error", statement: "x" })).toBe(true);
    expect(accept({ competitionId: "c-2", ground: "factual_error", statement: "x" })).toBe(false);
    expect(accept({ competitionId: "c-1", ground: "just_disagree", statement: "x" })).toBe(false);
    expect(accept(null)).toBe(false);
  });
});

describe("isArgumentDraft", () => {
  it("requires title, body and category", () => {
    expect(isArgumentDraft({ title: "t", body: "b", categorySlug: "sports", proposition: null })).toBe(true);
    expect(isArgumentDraft({ title: "t", body: "b" })).toBe(false);
  });
});
