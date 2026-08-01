/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// Importing the real barrel pulls in GoogleSignInButton -> a "use server"
// action -> next-auth, which vitest's SSR module runner can't resolve here
// (see FeedbackList.test.tsx for the same established workaround). Mock the
// three primitives BetaWaveSelect actually uses with plain DOM elements.
// vi.mock factories are hoisted above module-scope declarations, so the
// mock components are built entirely inside the factory closure (no
// top-level consts to reference) and named via a local function
// declaration + displayName assignment to satisfy react/display-name.
vi.mock("@/app/src/components/client", () => {
  function Label({
    children,
    required,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
    return React.createElement(
      "label",
      props,
      children,
      required ? React.createElement("span", null, "*") : null,
    );
  }

  const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
    function Select(props, ref) {
      return React.createElement("select", { ...props, ref }, props.children);
    },
  );

  const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return React.createElement("input", { ...props, ref });
    },
  );

  return { Label, Select, Input };
});

import {
  BetaWaveSelect,
  NONE_WAVE_CHOICE,
  getWaveSubmitValue,
  isWaveChoiceValid,
  WAVE_LABEL_MAX,
  type WaveChoice,
} from "./BetaWaveSelect";
import type { BetaWaveOption } from "@/app/src/lib/platform/accessRequestInbox";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WAVE_OPTIONS: BetaWaveOption[] = [
  { id: "Wave 1", name: "Wave 1" },
  { id: "Founders cohort", name: "Founders cohort" },
];

let container: HTMLDivElement | undefined;
let root: Root | undefined;

/** Wraps the (mostly) controlled component so re-renders reflect the latest choice, like the real parent panel does. */
function Harness({
  waveOptions,
  onRequestOptions,
  initial = NONE_WAVE_CHOICE,
  onChangeSpy,
}: {
  waveOptions: BetaWaveOption[] | null;
  onRequestOptions: () => void;
  initial?: WaveChoice;
  onChangeSpy: (choice: WaveChoice) => void;
}) {
  return createElement(HarnessInner, { waveOptions, onRequestOptions, initial, onChangeSpy });
}

function HarnessInner({
  waveOptions,
  onRequestOptions,
  initial,
  onChangeSpy,
}: {
  waveOptions: BetaWaveOption[] | null;
  onRequestOptions: () => void;
  initial: WaveChoice;
  onChangeSpy: (choice: WaveChoice) => void;
}) {
  const [choice, setChoice] = useState(initial);
  return createElement(BetaWaveSelect, {
    idPrefix: "test",
    waveOptions,
    onRequestOptions,
    value: choice,
    onChange: (next: WaveChoice) => {
      setChoice(next);
      onChangeSpy(next);
    },
  });
}

async function mount(props: {
  waveOptions: BetaWaveOption[] | null;
  onRequestOptions: () => void;
  initial?: WaveChoice;
  onChangeSpy: (choice: WaveChoice) => void;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const mountedRoot = root;
  await act(async () => {
    mountedRoot.render(createElement(Harness, props));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
  }
  container?.remove();
  container = undefined;
  root = undefined;
});

function getSelect(): HTMLSelectElement {
  return container!.querySelector('[data-testid="test-wave-select"]') as HTMLSelectElement;
}

function getNewInput(): HTMLInputElement | null {
  return container!.querySelector('[data-testid="test-wave-new-input"]') as HTMLInputElement | null;
}

async function selectValue(select: HTMLSelectElement, nextValue: string) {
  await act(async () => {
    select.value = nextValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function typeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("WaveChoice pure logic", () => {
  it("is invalid when kind is none", () => {
    expect(isWaveChoiceValid({ kind: "none" })).toBe(false);
    expect(getWaveSubmitValue({ kind: "none" })).toBeNull();
  });

  it("is invalid when the trimmed value is empty or over the bound", () => {
    expect(isWaveChoiceValid({ kind: "new", value: "   " })).toBe(false);
    expect(isWaveChoiceValid({ kind: "new", value: "a".repeat(WAVE_LABEL_MAX + 1) })).toBe(false);
    expect(isWaveChoiceValid({ kind: "existing", value: "a".repeat(WAVE_LABEL_MAX) })).toBe(true);
  });

  it("submits the exact trimmed value, never a UI sentinel", () => {
    expect(getWaveSubmitValue({ kind: "existing", value: "Wave 1" })).toBe("Wave 1");
    expect(getWaveSubmitValue({ kind: "new", value: "  Founders  " })).toBe("Founders");
  });
});

describe("BetaWaveSelect", () => {
  it("defaults to a blank, selectable placeholder and requests options exactly once on mount", async () => {
    const onRequestOptions = vi.fn();
    await mount({ waveOptions: null, onRequestOptions, onChangeSpy: vi.fn() });

    const select = getSelect();
    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe("Select a beta wave…");
    expect(onRequestOptions).toHaveBeenCalledTimes(1);
  });

  it("lists existing waves preserving spelling/case, with 'Create new wave…' as the final option", async () => {
    await mount({ waveOptions: WAVE_OPTIONS, onRequestOptions: vi.fn(), onChangeSpy: vi.fn() });

    const select = getSelect();
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(["Select a beta wave…", "Wave 1", "Founders cohort", "Create new wave…"]);
  });

  it("selecting an existing wave emits the real wave name, not the UI-only option value", async () => {
    const onChangeSpy = vi.fn();
    await mount({ waveOptions: WAVE_OPTIONS, onRequestOptions: vi.fn(), onChangeSpy });

    await selectValue(getSelect(), "existing:1");

    expect(onChangeSpy).toHaveBeenCalledWith({ kind: "existing", value: "Founders cohort" });
    // No sentinel leakage: the emitted value is a real wave name, never "existing:1".
    expect(onChangeSpy).not.toHaveBeenCalledWith(expect.objectContaining({ value: "existing:1" }));
  });

  it("selecting 'Create new wave…' reveals a required, focused input and never auto-fills it from typed text", async () => {
    const onChangeSpy = vi.fn();
    await mount({ waveOptions: WAVE_OPTIONS, onRequestOptions: vi.fn(), onChangeSpy });

    expect(getNewInput()).toBeNull();

    await selectValue(getSelect(), "create");

    expect(onChangeSpy).toHaveBeenCalledWith({ kind: "new", value: "" });
    const input = getNewInput();
    expect(input).not.toBeNull();
    expect(input?.required).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("shows a validation error for a whitespace-only new wave and clears it once corrected", async () => {
    const onChangeSpy = vi.fn();
    await mount({ waveOptions: [], onRequestOptions: vi.fn(), onChangeSpy });

    await selectValue(getSelect(), "create");
    const input = getNewInput()!;
    // The input's own maxLength already caps native typing at WAVE_LABEL_MAX
    // characters — isWaveChoiceValid's upper-bound branch is covered above
    // at the pure-logic level.
    expect(input.maxLength).toBe(WAVE_LABEL_MAX);

    const mountedContainer = container!;
    await typeValue(input, "   ");
    expect(mountedContainer.querySelector('[data-testid="test-wave-error"]')).not.toBeNull();

    await typeValue(input, "Valid Wave Name");
    expect(mountedContainer.querySelector('[data-testid="test-wave-error"]')).toBeNull();
  });

  it("restores focus to the select when the choice is reset externally (panel cancel/success)", async () => {
    // Renders BetaWaveSelect directly (not through the Harness wrapper) so
    // both root.render calls reconcile the SAME component instance — a
    // fresh mount would reset the internal "previous kind" ref and trivially
    // pass regardless of whether the focus-restoration effect actually ran.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onChangeSpy = vi.fn();

    await act(async () => {
      root!.render(
        createElement(BetaWaveSelect, {
          idPrefix: "test",
          waveOptions: WAVE_OPTIONS,
          onRequestOptions: vi.fn(),
          value: { kind: "new", value: "Draft" } as WaveChoice,
          onChange: onChangeSpy,
        }),
      );
    });

    expect(getNewInput()).not.toBeNull();

    // Simulate the parent panel resetting the choice back to blank after a
    // successful submission — never touching the select directly.
    await act(async () => {
      root!.render(
        createElement(BetaWaveSelect, {
          idPrefix: "test",
          waveOptions: WAVE_OPTIONS,
          onRequestOptions: vi.fn(),
          value: NONE_WAVE_CHOICE,
          onChange: onChangeSpy,
        }),
      );
    });

    expect(getNewInput()).toBeNull();
    expect(document.activeElement).toBe(getSelect());
  });
});
