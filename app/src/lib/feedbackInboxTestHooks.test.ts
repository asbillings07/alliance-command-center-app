import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearFeedbackInboxTestHooks,
  runFeedbackInboxListQueryFailureHook,
  setFeedbackInboxListQueryFailuresRemaining,
} from "./feedbackInboxTestHooks";

describe("feedbackInboxTestHooks", () => {
  const originalEnv = process.env.FEEDBACK_INBOX_TEST_HOOKS;

  beforeEach(() => {
    clearFeedbackInboxTestHooks();
    process.env.FEEDBACK_INBOX_TEST_HOOKS = "true";
  });

  afterEach(() => {
    clearFeedbackInboxTestHooks();
    if (originalEnv === undefined) {
      delete process.env.FEEDBACK_INBOX_TEST_HOOKS;
    } else {
      process.env.FEEDBACK_INBOX_TEST_HOOKS = originalEnv;
    }
  });

  it("throws for the configured number of list query attempts then succeeds", async () => {
    setFeedbackInboxListQueryFailuresRemaining(2);

    await expect(runFeedbackInboxListQueryFailureHook()).rejects.toThrow(
      /simulated inbox query failure/,
    );
    await expect(runFeedbackInboxListQueryFailureHook()).rejects.toThrow(
      /simulated inbox query failure/,
    );
    await expect(runFeedbackInboxListQueryFailureHook()).resolves.toBeUndefined();
  });

  it("is inactive when FEEDBACK_INBOX_TEST_HOOKS is not true", async () => {
    process.env.FEEDBACK_INBOX_TEST_HOOKS = "false";
    setFeedbackInboxListQueryFailuresRemaining(1);

    await expect(runFeedbackInboxListQueryFailureHook()).resolves.toBeUndefined();
  });
});
