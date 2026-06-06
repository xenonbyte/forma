import { describe, expect, it } from "vitest";

import { composeSystemPrompt } from "../src/prompts/system.js";
import { DISCOVERY_AND_PHILOSOPHY } from "../src/prompts/discovery.js";

// Guard: the contracts copy of DISCOVERY_AND_PHILOSOPHY must have the same
// cap removal as apps/daemon/src/prompts/discovery.ts. The web app imports
// composeSystemPrompt from @xenonbyte/od-contracts, so only testing the daemon
// copy leaves the web-originated chat path unguarded.
describe("DISCOVERY_AND_PHILOSOPHY (contracts copy) — TodoWrite plan item count", () => {
  it('does not cap the plan at 10 items via "5–10" wording', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(/5[–-]10\s+short\s+imperative/);
  });

  it('does not cap the plan at 10 items via "5 to 10" wording', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(/5 to 10\s+(?:short\s+)?items/i);
  });

  it('does not re-introduce a numeric cap via "at most / maximum / no more than" phrasing', () => {
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(
      /(?:at most|maximum|no more than)\s+1[0-9]\s+(?:todo|plan|step|item)/i,
    );
  });

  it("still instructs the agent to write a TodoWrite plan", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain("TodoWrite");
    expect(DISCOVERY_AND_PHILOSOPHY).toContain("RULE 3");
  });

  it("also absent from the composed system prompt", () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).not.toMatch(/5[–-]10\s+short\s+imperative/);
  });
});

describe("composeSystemPrompt", () => {
  it("injects Chinese quick brief guidance when the UI locale is zh-CN", () => {
    const prompt = composeSystemPrompt({ locale: "zh-CN" });

    expect(prompt).toContain("# UI locale override");
    expect(prompt).toContain("`zh-CN` (Simplified Chinese)");
    expect(prompt).toContain("快速简报 — 30 秒");
    expect(prompt).toContain("目标用户");
    expect(prompt).toContain("视觉调性");
    expect(prompt).toContain("Keep machine-readable ids and object option `value` fields exact and unlocalized");
  });

  it("preserves canonical default task-type options under locale overrides", () => {
    const prompt = composeSystemPrompt({ locale: "zh-CN" });

    expect(prompt).toContain("keep the `taskType` option labels as the canonical routing choices");
    for (const option of [
      "Prototype",
      "Live artifact",
      "Slide deck",
      "Image",
      "Video",
      "HyperFrames",
      "Audio",
      "Other",
    ]) {
      expect(prompt).toContain(`"${option}"`);
    }
    expect(prompt).not.toContain("option labels as `原型`");
    expect(prompt).not.toContain("`实时作品`");
  });

  it("preserves canonical default task-type options for zh-TW locale overrides", () => {
    const prompt = composeSystemPrompt({ locale: "zh-TW" });

    expect(prompt).toContain("# UI locale override");
    expect(prompt).toContain("`zh-TW` (Traditional Chinese)");
    expect(prompt).toContain("keep the `taskType` option labels as the canonical routing choices");
    for (const option of [
      "Prototype",
      "Live artifact",
      "Slide deck",
      "Image",
      "Video",
      "HyperFrames",
      "Audio",
      "Other",
    ]) {
      expect(prompt).toContain(`"${option}"`);
    }
    expect(prompt).not.toContain("快速简报 — 30 秒");
    expect(prompt).not.toContain("option labels as `原型`");
    expect(prompt).not.toContain("`实时作品`");
  });

  it("treats an active design system as the visual direction", () => {
    const prompt = composeSystemPrompt({
      designSystemTitle: "ComfyUI",
      designSystemBody: "# ComfyUI\n\n--accent: #ffd500",
      metadata: { kind: "prototype" } as any,
      activeStageBlocks: ["\n\n## Active stage: plan\n\n### direction-picker\n\nAsk for 3-5 directions."],
    });

    expect(prompt).toContain("## Active design system — ComfyUI");
    expect(prompt).toContain("Active design system exception");
    expect(prompt).toContain("the active design system is the visual direction for this project");
    expect(prompt).toContain("Do not ask the user to pick a separate theme color");
    expect(prompt).toContain("Do not emit a direction question-form");
    expect(prompt).not.toContain('<question-form id="direction"');
    expect(prompt.indexOf("## Active design system visual direction")).toBeGreaterThan(
      prompt.indexOf("### direction-picker"),
    );
  });
});

describe("mobile de-shell (spec §5.4)", () => {
  it("does not instruct drawing an iPhone frame / Dynamic Island / home indicator", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(/Real iPhone frame/i);
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(/Dynamic Island/i);
    expect(DISCOVERY_AND_PHILOSOPHY).not.toMatch(/home indicator/i);
  });
  it("still keeps the 44px hit-target content constraint", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toMatch(/44px/);
  });
});

const SQUARE_EDGE_SENTENCE =
  "The outermost screen edges MUST be square — no border-radius on <body> or any full-bleed root container (no rounded screen silhouette).";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// TEST-PROMPT-001 — discovery.ts fixed square-edge sentences (SPEC-BEHAVIOR-001).
describe("mobile square outer edges — discovery (SPEC-BEHAVIOR-001)", () => {
  it("Mobile app prototype entry carries the square-edge rule right after the de-shell rule", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain(SQUARE_EDGE_SENTENCE);
    expect(DISCOVERY_AND_PHILOSOPHY).toContain(
      "do NOT draw any device shell (no phone frame, bezel, notch chrome, status bar, or gesture bar). " +
        SQUARE_EDGE_SENTENCE,
    );
  });

  it("iOS entry parenthetical requires square outer corners", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain(
      "(no iPhone frame, no notch or pill chrome, no status bar, no gesture bar, square outer corners — no rounded screen edges)",
    );
  });

  it("Android entry parenthetical requires square outer corners", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain(
      "(no Pixel frame, status bar, or nav bar chrome, square outer corners — no rounded screen edges)",
    );
  });

  it("multi-screen side-by-side panels keep square outer edges", () => {
    expect(DISCOVERY_AND_PHILOSOPHY).toContain(
      "compose the screens as plain content panels with square outer edges",
    );
  });
});

// TEST-PROMPT-002 — system.ts conditional square-edge injection (SPEC-BEHAVIOR-001).
describe("mobile square outer edges — system metadata rules (SPEC-BEHAVIOR-001)", () => {
  it("cross-platform deliverable rule carries the sentence when more than one target is selected", () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: "prototype", platformTargets: ["mobile-ios", "mobile-android"] } as any,
    });
    expect(prompt).toMatch(
      /- \*\*cross-platform deliverable rule\*\*:.*The outermost screen edges MUST be square — no border-radius on <body> or any full-bleed root container \(no rounded screen silhouette\)\./,
    );
  });

  it("product-realism rule carries the sentence for kind=prototype", () => {
    const prompt = composeSystemPrompt({ metadata: { kind: "prototype" } as any });
    expect(prompt).toMatch(
      /- \*\*product-realism rule\*\*:.*The outermost screen edges MUST be square — no border-radius on <body> or any full-bleed root container \(no rounded screen silhouette\)\./,
    );
  });

  it("a single platform target does not inject the cross-platform copy of the sentence", () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: "prototype", platformTargets: ["mobile-ios"] } as any,
    });
    expect(prompt).not.toContain("- **cross-platform deliverable rule**:");
    // discovery copy + product-realism copy only
    expect(countOccurrences(prompt, SQUARE_EDGE_SENTENCE)).toBe(2);
  });

  it("neither metadata-conditional copy fires for a single-target non-product kind", () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: "deck", platformTargets: ["mobile-ios"] } as any,
    });
    expect(prompt).not.toContain("- **cross-platform deliverable rule**:");
    expect(prompt).not.toContain("- **product-realism rule**:");
    // only the always-on discovery copy remains
    expect(countOccurrences(prompt, SQUARE_EDGE_SENTENCE)).toBe(1);
  });
});

import { OFFICIAL_DESIGNER_PROMPT } from "../src/prompts/official-system.js";

describe("scope fidelity (spec §5.5)", () => {
  it("ambition is scoped to craft, not added scope", () => {
    expect(OFFICIAL_DESIGNER_PROMPT).not.toMatch(/a notch more ambitious than what was asked for/i);
    expect(OFFICIAL_DESIGNER_PROMPT).toMatch(/scope|do not add|without (adding|expanding)/i);
  });

  it("the composed system prompt carries the final scope-fidelity rule", () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).toMatch(/build exactly the pages, sections, controls, and elements/i);
    expect(prompt).toMatch(/do not add features, screens, or content/i);
  });
});
