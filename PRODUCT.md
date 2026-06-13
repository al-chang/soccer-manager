# Product

## Register

product

## Users

Football management-sim enthusiasts — the *Football Manager* / FIFA Career Mode
crowd who enjoy depth, numbers, and "spreadsheets that feel alive." They sit down
at a desktop for a long, absorbed session: picking a squad, tuning tactics,
working the transfer market, then simulating a season match-by-match and
day-by-day. Their context is private, single-player, offline — everything runs
100% client-side with saves in IndexedDB, no backend and no accounts. Their job
on any given screen is to **read state quickly and make a confident decision**:
who starts, who to sell, when to press, what the table says.

## Product Purpose

A browser-based football management simulator that gives one person full control
of a club and a believable world to manage it in. It exists to deliver the depth
and "living dashboard" satisfaction of a desktop management sim with zero install
and zero friction — open a tab, manage a club, simulate a season. Success looks
like a manager trusting the interface enough to make fast decisions from the data
alone: the condition bars, form dots, league edges, and scoreboard read true at a
glance, and the showpiece moments (live match, day-advance) feel premium rather
than gamey.

## Brand Personality

Professional, confident, broadcast-grade. Three words: **sharp, credible, alive.**
The voice is a modern sports-data broadcast — Opta/ESPN stat panels, FM data
tables, EA Career Mode hubs — dense and authoritative but never cluttered. Color
is purposeful (pitch-green as the brand spine; status colors disciplined, not
decorative). It should feel like a tool a real analyst would respect, with subtle
depth and motion that rewards attention. It evokes focus and quiet competence,
never childish delight.

## Anti-references

- **Gamified / cartoonish sports games** — bouncy mascots, chunky arcade UI,
  confetti, emoji-driven feedback. This is a sim, not a mobile game.
- **The generic drab dark admin dashboard** — flat undifferentiated cards, low
  contrast hierarchy, lifeless tables, a single gray-on-charcoal note. The
  current baseline leans here; the whole point is to escape it.
- **SaaS-cream / warm-editorial marketing aesthetics** — wrong register entirely;
  there is no landing-page-as-product surface here.
- **Decorative glassmorphism and gradient-text flourishes** — depth must come
  from real elevation and disciplined color, not blur-for-blur's-sake.

## Design Principles

1. **The indicators carry the decision.** A player's current sharpness is never a
   single blended number — it is read off explicit condition bars, form dots, and
   warning rings. Those signals must be legible and trustworthy enough to act on
   at a glance, because they replace a number the user is deliberately denied.
2. **One number per player, everywhere.** The canonical user-facing rating
   (`overall`) appears identically on every screen — squad, lineup, pitch, modal,
   transfers. A player's number must never appear to change as they move between
   contexts.
3. **Density with hierarchy, never clutter.** Pack real information, but earn it
   with rhythm, contrast, and elevation so the eye always finds the next decision.
   Broadcast-dense, not spreadsheet-flat.
4. **Color means something or it's absent.** Pitch-green is the brand; status
   colors (W/D/L, fitness, transfer-window) are a disciplined, redundant signal
   layer — never paint chrome with them.
5. **Premium through restraint, not effects.** Depth and motion are subtle and
   purposeful — they reinforce state and reward attention. The signature surfaces
   (Home dashboard, Lineup pitch, live Match screen) earn extra craft; the rest
   stays calm.

## Accessibility & Inclusion

- **Target WCAG 2.1 AA.** Body text ≥4.5:1, large/bold text ≥3:1, against its
  actual background. **Dark and light themes** are both supported (dark is the
  default; theme follows the OS by default with a manual override persisted in
  `localStorage`). Contrast must hold in both — semantic *text* colors darken on
  light surfaces while brand *fill* colors (chips/badges) stay shared. The pitch
  (green grass) and the title screen stay cinematically dark in both themes; the
  day-advance overlay follows the theme (a brand-green scrim over the theme bg).
- **Color is never the sole channel.** Every color-coded signal is paired with a
  shape, letter, icon, or position so it survives color blindness — position
  badges keep their GK/DF/MF/FW letters, W/D/L result chips keep their glyphs,
  condition bars pair hue with fill level and (where decisive) a label. Red/green
  and blue/purple pairings must stay distinguishable for deuteranopia/protanopia.
- **Full reduced-motion paths.** Every animation — including the live match feed,
  match clock, and day-advance overlay — has a `prefers-reduced-motion: reduce`
  alternative (crossfade or instant) that still communicates the underlying state.
  Showpieces inform without requiring motion.
