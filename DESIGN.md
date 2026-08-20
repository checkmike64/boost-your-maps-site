---
# ── Boost Your Maps — DESIGN.md ── machine-readable tokens ──
colors:
  canvas:   "#FFFFFF"   # the ONLY page background — no colored section bands, ever
  ink:      "#17282E"   # text, headlines
  muted:    "#5D6B68"   # secondary text, captions, eyebrows
  hairline: "#E7EAE8"   # 1px rules — inside components + the two section breaks
  panel:    "#F5F7F5"   # ONE gray panel exists: the Visibility Report card
  red:      "#C5221F"   # THE visual accent and accessible primary-action background.
  redDeep:  "#A50E0E"   # hover and pressed states
  green:    "#12B76A"   # list checkmarks ONLY
  yellow:   "#FFC42E"   # the hand-drawn h1 underline ONLY
typography:
  display: { fontFamily: "'Gabarito', sans-serif", fontWeight: 800, letterSpacing: "-0.015em", lineHeight: 1.05 }
  body:    { fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 400, lineHeight: 1.65 }
  # EXACTLY three body sizes: body 1.05rem, lead 1.2rem, caption 0.9rem. No others.
rounded: { button: "12px", card: "16px", panel: "20px", chipNever: "no pill chips" }
spacing: { section: "96px", sectionTight: "64px", heroBottom: "52px" }  # the ONLY section paddings
motion: { easing: "cubic-bezier(.32,.72,0,1)", duration: "250ms", mascotBob: "4.2s subtle 9px" }
---

# Boost Your Maps — DESIGN.md (Style A, coach pass — LOCKED 2026-08-04)

## 1. Visual Theme & Atmosphere
Quiet confidence with small doses of play. White canvas, disciplined ink typography, and a single working red. Personality lives in exactly four small moments: the ultra-simple flat red pin mascot (dot eyes + smile — NEVER detailed, glossy, or hand-drawn-realistic), the yellow hand-drawn underline in the h1, the speech bubble, and the dashed route motif that stitches sections together. Everything else is restraint. History: colored bands + hard offset shadows + multi-color accents were rejected as "AI + Gumroad" / "Crayola"; detailed mascot renders were rejected twice.

## 2. Color Roles — the one-red rule
Red appears roughly ONCE per viewport, always pointing at an action or the brand: primary buttons (all carrying the same phrase), step numerals, route connector dots, eyebrow dots, the featured pricing border, the Visibility Report panel border, the mascot, the 93% stat. Checkmarks are green. The h1 underline is yellow. Nothing else on the page carries color. Gray `panel` is reserved for the Visibility Report card alone — the eye learns "gray panel = the form."

## 3. Typography Rules
Gabarito 800 display over Hanken Grotesk body. Three body sizes only (1.05 / 1.2 lead / .9 caption) — the earlier seven-size drift was the main cause of "dense" feel. Eyebrows are short functional labels (≤3 words, uppercase .78rem, muted with red dot) and appear ONLY on: hero, why, how, what-we-handle, pricing. Voicey sections (straight talk, proof, report, FAQ) lead with the h2 alone. Load Google Fonts with one <link> per family + generic fallbacks.

## 4. Components
- Primary button: deep red `#C5221F`, white text, radius 12, tinted red glow shadow, hover lifts 2px, active scale .98. This pair passes WCAG AA for normal text. EVERY navigation/CTA primary says the identical phrase: "Get my free visibility report →".
- Secondary actions are text links (Gabarito 600, hairline underline, red on hover) — not boxed buttons.
- Cards: white, 1px hairline, radius 14-16, no shadows. The Visibility Report panel: `panel` gray, radius 20, 1.5px red border (same "featured" language as the popular pricing tier).
- The two-field mini form (trade + ZIP + primary button) appears in the HERO and in the Visibility Report section.
- Hairlines live inside components (ticker, FAQ rows, footer) and as top borders on exactly two sections: pricing and FAQ (the story→transaction→objections mode shifts).

## 5. Layout & Flow System
Left spine for story sections (why, how, what-we-handle); centered only for symmetric grids (proof, pricing, FAQ, final). Between story sections, a centered 46px dashed connector ending in an 8px red dot hands one section into the next — same visual language as the dashed route line behind the three steps. Section rhythm: 96px standard, 64px around the flattened straight-talk passage and the report panel. Only the three steps are numbered (red numerals in outlined circles); the what-we-handle cards use small red pin-arrow glyphs instead. Mascot cadence = hero (large, speech bubble) → report panel (mini) → final CTA (mid, red): its recurrence means "you're near the ask."

## 6. Depth
Flat + hairlines. Shadows only: the red glow under primary buttons and one soft ambient under the interactive map card. No offset shadows, no borders thicker than 1.5px (and 1.5px only for the two red "featured" frames).

## 7. Do's and Don'ts
DO: one red per viewport; identical CTA phrase everywhere; three text sizes; route connectors between sections; the four playful moments; the interactive 3-Pack map (best element on the page — never remove).
DON'T: colored section backgrounds; hard offset shadows; 2.5px borders; pill chips; more than one gray panel; competing numbering systems; boxed secondary buttons; detailed/glossy mascot faces; Bricolage Grotesque/Space Grotesk/Clash Display/Geist/Cal Sans/Instrument Serif; centered header over a left-anchored list.

## 8. Responsive
Breakpoint 880px: grids stack, route connectors hide, mini-mascots hide, plain nav links hide, sections drop to 72/52px. Touch targets ≥44px.

## 9. Agent Prompt Guide
"Build/restyle per Boost Your Maps DESIGN.md: white canvas, Gabarito 800 + Hanken Grotesk (three body sizes only), single deep red #C5221F accent on actions/numerals/mascot with green checks and one yellow h1 underline, 1px hairlines inside components, dashed route connectors with red dots between sections, flat simple pin mascot (dot eyes + smile, never detailed), button-only visibility-report prompts in the hero and red-bordered gray report panel, identical CTA phrase on every primary button, secondaries as text links. No colored bands, no offset shadows, no pills, no icon-box grids, no extra grays. Motion: 250ms cubic-bezier(.32,.72,0,1), mascot idle bob only."
