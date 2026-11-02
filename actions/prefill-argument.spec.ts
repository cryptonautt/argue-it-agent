import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARGUMENT_LIMITS } from "@domain/arguments/validation";
import { setupTestDb } from "@domain/test-helpers/db";
import { actAs } from "@domain/test-helpers/auth";
import { createTestUser } from "@domain/test-helpers/factories";

// Never touch the framework's app-state store (it lives on the framework DB connection) in tests.
const writeAppStateForCurrentTab = vi.fn(async (_key: string, _value: Record<string, unknown>) => undefined);
vi.mock("@agent-native/core/application-state", () => ({ writeAppStateForCurrentTab }));

const { default: prefillArgument } = await import("./prefill-argument");

const t = setupTestDb();

const VALID = {
  title: "Osimhen is a better striker than Lookman",
  proposition: "Victor Osimhen is a better striker than Ademola Lookman.",
  body: "Osimhen scores more often, wins more aerial duels and leads the line better.",
  categorySlug: "sports",
};

beforeEach(async () => {
  writeAppStateForCurrentTab.mockClear();
  const { user } = await createTestUser(t.db);
  actAs(user.id);
});

describe("prefill-argument", () => {
  it("writes the tab-scoped argument-draft for a valid draft", async () => {
    const result = await prefillArgument.run(VALID);
    expect(result).toMatchObject({ categorySlug: "sports", title: VALID.title, proposition: VALID.proposition });
    expect(writeAppStateForCurrentTab).toHaveBeenCalledTimes(1);
    expect(writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "argument-draft",
      expect.objectContaining({ title: VALID.title, body: VALID.body, categorySlug: "sports" }),
    );
  });

  it("prefill-argument rejects unknown category", async () => {
    await expect(prefillArgument.run({ ...VALID, categorySlug: "politics" })).rejects.toThrow(/politics/);
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("prefill-argument enforces createArgument title length", async () => {
    const title = "x".repeat(ARGUMENT_LIMITS.titleMax + 1);
    await expect(prefillArgument.run({ ...VALID, title })).rejects.toThrow();
    await expect(prefillArgument.run({ ...VALID, title: "ab" })).rejects.toThrow();
    expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
