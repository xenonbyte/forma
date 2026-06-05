/**
 * Self-review checklist: craft-checkable items the model verifies AFTER generating
 * a design (the non-mechanical complements to the deterministic craft lint). Each
 * item references a bundled craft doc slug. Surfaced/enforced by the P6 templates.
 */

export interface SelfReviewItem {
  /** stable kebab-case id */
  id: string;
  /** bundled craft doc slug this item draws from (must exist in craft/) */
  craftDoc: string;
  /** a concrete yes/no question the model answers about its own output */
  prompt: string;
}

export const SELF_REVIEW_CHECKLIST: SelfReviewItem[] = [
  {
    id: "no-ai-slop",
    craftDoc: "anti-ai-slop",
    prompt:
      "Does the design avoid generic AI-slop patterns (centered everything, default purple gradients, equal-weight cards, emoji bullets)?",
  },
  {
    id: "type-hierarchy",
    craftDoc: "typography-hierarchy",
    prompt: "Is there a clear typographic hierarchy with a small, consistent type scale rather than many ad-hoc sizes?",
  },
  {
    id: "color-restraint",
    craftDoc: "color",
    prompt:
      "Is color used with restraint — a small palette, accent reserved for primary actions, neutrals carrying most surfaces?",
  },
  {
    id: "contrast-accessible",
    craftDoc: "accessibility-baseline",
    prompt: "Does every text/control meet WCAG AA contrast against its actual background?",
  },
  {
    id: "state-coverage",
    craftDoc: "state-coverage",
    prompt: "Are empty, loading, error, and edge states represented rather than only the happy path?",
  },
  {
    id: "form-validation",
    craftDoc: "form-validation",
    prompt: "Do forms show inline validation, clear required/optional cues, and accessible error messaging?",
  },
  {
    id: "motion-discipline",
    craftDoc: "animation-discipline",
    prompt: "Is motion purposeful and restrained (no gratuitous animation), respecting reduced-motion intent?",
  },
  {
    id: "ux-laws",
    craftDoc: "laws-of-ux",
    prompt: "Does the layout honor core UX laws (Fitts, Hick, proximity, consistent affordances)?",
  },
];
