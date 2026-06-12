# Production AI tells (hard bans & quotas)

Patterns that mark output as "default LLM design" in production testing.
Complements `anti-ai-slop.md` (vendored, lint-backed cardinal sins) with
production-tested tells; nothing here repeats that file. **Universal**
sections apply to every page. **Marketing-only** sections fire when the
design read (`design-read.md`) classifies the surface as marketing.

> Adapted from [taste-skill](https://github.com/Leonxlnx/taste-skill) (MIT),
> re-scoped to Forma's pure-static artifacts and brand-token system.

## Universal — every page

### Punctuation

- **Em-dash (`—`) and en-dash (`–`) are banned in visible Latin-script
  copy** — headlines, labels, buttons, body, captions, attribution. The
  single most reliable LLM signature. Restructure with a period, comma,
  colon, or hyphen (`-`). *(auto-checked: `no-em-dash` craft lint)*
  - CJK exemption: the Chinese double dash `——` and dashes adjacent to CJK
    characters are legitimate punctuation; the lint only flags dashes in
    non-CJK context.
- Typographic quotes (“ ”) or none; never straight ASCII quotes as a design
  flourish around testimonial/quote text.

### Demo content & copy

- **No fake-precise numbers** (`92%`, `4.1×`, `48k`) unless they come from
  the requirement or are visibly sample data. Demo data should look
  organic (`47.2%`, `+1 312 847-1928`), never perfect (`99.99%`, `1234567`).
- **No generic placeholder people** — "John Doe", "Jane Smith", "张三",
  egg/initial avatars. Use realistic, locale-appropriate names and
  believable avatar treatments.
- **No filler verbs** — "Elevate", "Seamless", "Unleash", "Revolutionize",
  "赋能", "引领", "开启新篇章". Concrete verbs only.
- **Copy self-audit before declaring done:** re-read every visible string
  (headlines, labels, buttons, captions, errors). Flag grammar breaks,
  unclear referents, and mock-poetic micro-meta; replace cute-but-wrong
  phrasing with plain functional copy. One copy register per page.

### Typography emphasis

- Emphasis inside a headline uses **italic or bold of the same family**.
  Never inject a single serif word into a sans headline (or vice versa)
  for "visual interest" — mixed-family emphasis is amateur.
- Italic display words containing descenders (`y g j p q`) need line-height
  ≥ 1.1 plus bottom padding reserve, or the descender clips.
- Typeface *choice* itself is bound by the active brand `DESIGN.md`;
  these rules govern usage, not selection.

### Theme, color & shape consistency

- **Theme lock:** one theme per page. No light warm-paper section
  sandwiched inside a dark page (or vice versa). Background tints within
  the same family are fine; a mid-scroll theme flip is broken design
  unless the spec explicitly stages one deliberate switch.
- **Accent consistency lock:** once an accent is chosen it serves the
  whole page. A warm-grey page does not grow a teal badge in the footer.
- **Shape consistency lock:** pick ONE corner-radius scale (all-sharp /
  all-soft / all-pill) or document a mixed rule ("buttons pill, cards
  16px, inputs 8px") and apply it everywhere. Round buttons inside a
  square layout is broken design.
- **Premium-consumer palette rotation:** when tokens leave room (component
  library or style work), do not reflexively reach for warm
  beige/cream + brass/clay/oxblood — the default "artisan" palette of
  every LLM. Rotate real alternatives (cold luxury greys, forest + bone,
  black + tan, cobalt + cream, terracotta + slate). Binding brand tokens
  always win over this rule.

### Micro-decoration

- **No decorative status dots** before nav items, list rows, or badges.
  A colored dot is allowed only for real semantic state, sparingly.
- **Middle-dot (`·`) is rationed** — max one per metadata line, never a
  universal separator chain (`foo · bar · baz · qux`).
- **No version labels as decoration** — `V2.0`, `BETA`, `EARLY ACCESS`
  eyebrows; `v1.4.2 · build 0048` footers. Allowed only when the surface
  is genuinely about release status or is real devtool UI.
- **No vertical rotated text** and **no crosshair/hairline grids drawn
  purely as decoration**.
- **No tags/pills overlaid on images** and **no invented photo-credit
  captions** (`Frame XII · 35mm`). Caption below the image, functional,
  or nothing.

## Marketing surfaces only

### Hero discipline

- Hero fits the initial viewport: headline ≤ 2 lines, subtext ≤ 20 words,
  primary CTA visible without scrolling.
- Max 4 text elements in the hero: (eyebrow OR brand strip), headline,
  subtext, CTAs. Trust micro-strips, pricing teasers, feature bullets,
  and avatar rows move to sections below; logo walls live under the hero,
  never inside it.
- **No scroll cues** (`↓ Scroll to explore`). The viewport bottom needs no
  label.
- **No section-number eyebrows** (`00 / INDEX`, `001 · Capabilities`) —
  eyebrows name topics in plain language or are dropped.

### Section rhythm

- **Eyebrow quota:** max 1 eyebrow (small uppercase wide-tracking label
  above a headline) per 3 sections, hero included.
  *(auto-checked: `eyebrow-density` craft lint)*
- **Zigzag cap:** max 2 consecutive image/text split sections; the third
  consecutive split is a fail. Break with a full-width, stacked, or grid
  section.
- A section layout family (3-col cards, full-width quote, split
  text+image) appears at most once per page; 8 sections need ≥ 4 layout
  families.
- **Split-header ban:** "big left headline + small floating right
  paragraph" as a section header is banned as default; stack headline
  over body (max-width ~65ch) unless the right column carries a real
  visual.

### CTAs

- CTA label fits one line at desktop width — ≤ 3 words for the primary.
- **One label per intent:** "Get started" + "Try free" + "Sign up free"
  are the same intent; pick one label and reuse it everywhere on the page.

### Imagery

- **No div-built fake screenshots** — fake task lists, terminals, or
  dashboards assembled from styled rectangles. Use a real mini component
  preview built from the page's actual design system, or a clearly
  labelled `.ph-img` placeholder slot. (Forma artifacts are pure-static:
  no external image URLs; inline `data:` assets or placeholder classes
  only.)
