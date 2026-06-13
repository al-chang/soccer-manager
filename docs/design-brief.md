# Soccer Manager — Design Brief

## What it is
A browser-based football/soccer management simulator in the spirit of *Football
Manager* / FIFA Career Mode. The player acts as a club manager: picks a squad,
sets tactics, buys and sells players, then simulates a season match-by-match and
day-by-day. Everything runs **100% client-side** — no backend, no accounts. Game
state lives in IndexedDB and autosaves on every action.

## Audience & tone
Management-sim enthusiasts who enjoy depth, numbers, and spreadsheets-that-
feel-alive. They expect a **dense, information-rich, "broadcast/sports-data"
aesthetic** — think Opta/ESPN stat panels, FM's data tables, EA Sports Career
Mode hubs. The current look is functional but flat; the goal is **polished,
professional, confident** — not playful or gamified-cartoonish.

## Platform & technical constraints (important for design)
- **React 19 + TypeScript + Vite**, hand-rolled CSS (single `index.css`, CSS
  custom properties — no Tailwind, no component library). Design should map to
  **CSS variables + utility/semantic classes**, not a heavy framework.
- **Desktop-first**, single-page app. There's a fixed left **sidebar nav** + top
  bar + scrollable content area. Already has a couple of responsive breakpoints
  (~1000px, ~900px) collapsing 2-col grids to 1-col.
- **Dark theme only** (`color-scheme: dark`). Keep dark as the default/primary;
  a refined dark palette is the priority.
- Heavy use of **data tables, badges, condition bars, and a rendered football
  pitch** (CSS, not images). These are the signature surfaces — they need the
  most design love.
- No external fonts currently (system `Segoe UI` stack). A web font is
  acceptable if it's justified and performance-light.

## Current visual system (the baseline to elevate)
Dark palette, green accent (football-pitch green):
- Backgrounds: `#0f1419` / `#161d26`, cards `#1c2530`–`#232e3c`, borders `#2d3a4a`
- Text `#e4ebf2`, muted `#8a99ab`
- Accent green `#2e9e5b` / `#38c172`; status colors green/amber/red/blue
- 12px radius cards, 8px buttons, uppercase letter-spaced section headers, dense
  13–14px type.
- Position badges (GK purple, DF blue, MF green, FW red), OVR rating badges
  tiered elite/good/decent/poor.

It's coherent but **generic and a bit drab** — low contrast hierarchy,
undifferentiated cards, flat tables, no depth/motion polish beyond a few
keyframes.

## Screen inventory (what needs designing)
1. **Title** — landing/new-game screen (currently a radial-gradient hero + a
   single card).
2. **Team Select** — league tabs + grid of club cards (color-coded top border).
3. **Home / Dashboard** — 2-col grid of cards: next match, recent results, mini
   league table, club status, latest news. *The hub — most important to nail.*
4. **Squad** — sortable data table of players (rating, position, condition,
   contract).
5. **Player detail + Player modal** — attribute grid (11 attributes), condition
   bars (fitness/sharpness/morale/wellbeing), form dots, season stats, transfer
   actions.
6. **Tactics** — formation picker, mentality/pressing/tempo selectors, and the
   **drag-and-drop Lineup Editor**: a rendered pitch with player chips +
   bench/reserves lists you drag between.
7. **Transfers** — search/filter, offer cards, incoming-offer cards with
   negotiation inputs.
8. **Fixtures** — schedule list with result chips.
9. **League table** — full standings with promotion/relegation edge markers.
10. **Inbox** — news feed, read/unread states, categorized
    (transfer/match/league/window).
11. **Club** — club profile.
12. **History** — past seasons/records.
13. **Match screen** — live simulation: big scoreboard, match clock + speed
    controls, possession bar, live event feed (goals/cards/injuries/subs styled
    distinctly), pitch view, substitution controls. *The showpiece moment.*
14. **Day-advance overlay** — full-screen "simulating…" overlay: a ticking date
    and a scrolling news feed animating in (FIFA-career-mode style). Already
    animated; wants to feel premium.

## Signature components to systematize
- **Cards** (currently one flat style — needs a hierarchy: hero cards vs. list
  cards vs. stat tiles)
- **Data tables** (the workhorse — needs better row rhythm, hover, sticky
  headers, sort affordances, zebra/highlight without noise)
- **OVR rating badge** & **position badge** (iconic, keep but refine)
- **Condition bars** + **form dots** (the manager *infers* a player's sharpness
  from these — see note below — so they must read clearly and quickly)
- **The pitch + player chips** (drag-and-drop; chips show squad number + rating
  ring + position color; warn-ring for out-of-position/injured)
- **Result chips** (W/D/L), **news category tags**, **status pills** (transfer
  window open/closed)
- **Scoreboard / match clock** (broadcast feel)

## Product rule that constrains the design
**Never surface a player's blended "effective rating" anywhere in the UI.** Each
player has one canonical user-facing number — their raw overall rating — shown
identically on every screen. Their *current* form/freshness is communicated
**only** through the explicit condition bars, form dots, and warning rings —
never as a single pre-blended number. So the design must make **condition/form
indicators legible and trustworthy enough to read at a glance**, because they
carry real decision-making weight.

## What to deliver
- A refined **design system**: dark palette (richer, better contrast/depth),
  type scale, spacing, elevation, radius, and motion guidelines — expressed as
  CSS custom properties.
- Restyled **core components** (cards, tables, badges, bars, chips, scoreboard,
  news items).
- High-fidelity direction for the **3 hero surfaces**: the **Home dashboard**,
  the **Tactics/Lineup pitch editor**, and the **live Match screen**.
- Keep it **performant and CSS-mappable** (no dependency on a UI library or
  build tooling we don't have).

## Direction keywords
Modern sports-data broadcast · premium dark UI · crisp typographic hierarchy ·
purposeful color (green as brand, status colors disciplined) · subtle depth and
motion · dense but never cluttered · *professional, not gamey*.
