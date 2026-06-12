# Design read & dials

A mandatory pre-generation step for design-generating commands: infer what
the page actually wants to be *before* writing any HTML. Most weak generated
design comes from jumping to a default aesthetic instead of reading the
brief. The requirement page spec stays authoritative for **scope**; the
design read shapes **execution** only.

> Adapted from [taste-skill](https://github.com/Leonxlnx/taste-skill) (MIT),
> re-scoped for Forma: brand tokens from the active `DESIGN.md` are binding,
> and Forma artifacts are pure-static (no JS), so there is no motion dial —
> motion is limited to CSS state transitions.

## 1. Read these signals first

1. **Surface kind** — *product UI* (workflows, forms, lists, tables,
   dashboards, settings: most Forma requirement pages) vs *marketing
   surface* (landing, promo, onboarding splash, store/brand page). This
   single classification gates which rules in `ai-tells.md` apply.
2. **Audience** — operator under time pressure, design-conscious consumer,
   procurement reviewer, first-run user. The audience picks the aesthetic,
   not your taste.
3. **Brand style** — the selected `brand_style` ships `DESIGN.md` + tokens.
   They are binding. The design read works *within* them: it decides
   composition, density, and rhythm, never palette or typeface invention.
4. **Platform and language** — mobile screens follow the mobile screen
   contract; RTL/CJK content changes typographic decisions.
5. **Quiet constraints** — accessibility-first audiences, regulated or
   trust-first domains, kids' products. These OVERRIDE aesthetic preference.

## 2. State a one-line design read

Before any HTML, state:

> "Reading this as: \<surface kind\> for \<audience\>, \<visual language
> within the active brand style\>, VARIANCE n / DENSITY n."

If the signals genuinely diverge, ask exactly one clarifying question.
Otherwise declare the read and proceed — do not ask for confirmation of an
inferable read.

## 3. The two dials

* **`DESIGN_VARIANCE` (1–10)** — 1 = strict symmetric grid, 10 = expressive
  asymmetric composition.
* **`VISUAL_DENSITY` (1–10)** — 1 = airy gallery, 10 = packed cockpit.

| Signal | VARIANCE | DENSITY |
|---|---|---|
| Product UI: forms / settings / CRUD flows | 3–4 | 5–6 |
| Product UI: dashboards / consoles / data tables | 3–5 | 6–8 |
| Product UI: content, feed, or media surfaces | 5–6 | 4–6 |
| Marketing: landing / promo / store page | 7–8 | 3–4 |
| Editorial / sustained reading | 5–6 | 3–4 |
| Trust-first / regulated / accessibility-critical | 2–3 | 4–5 |

## 4. How the dials gate other rules

- **VARIANCE ≤ 4:** symmetric, grid-faithful layout is *correct*, not lazy.
  Do not force asymmetry onto a settings form.
- **VARIANCE ≥ 7:** anti-center bias applies — avoid centered-everything;
  reach for split, offset, or asymmetric composition deliberately.
- **DENSITY ≥ 7:** generic card containers are banned as grouping devices;
  data breathes in plain layout with dividers and whitespace
  (`anti-ai-slop.md` card rules apply doubly here).
- **DENSITY ≤ 3:** sparse is intentional — resist filling space with
  decorative geometry or filler sections.
- Marketing-only rules in `ai-tells.md` (hero discipline, section rhythm,
  eyebrow quota, CTA dedupe) fire **only** when the read classifies the
  surface as marketing.

## 5. Anti-default discipline

Do not default to: AI-purple gradients, centered hero over a dark mesh,
three equal feature cards, glassmorphism on everything, `Inter` + slate on
every surface. These are the LLM defaults. Reach past them deliberately,
based on the design read — and always within the active brand tokens.

## 6. Scope fidelity is unchanged

The design read never adds pages, sections, features, or controls beyond
the page spec. When in doubt, follow the spec literally. A bolder read is
expressed through composition and rhythm, not through invented content.
