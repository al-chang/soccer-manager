---
target: apps/web/src/ui/HomeScreen.tsx (Home dashboard)
total_score: 27
p0_count: 0
p1_count: 3
timestamp: 2026-06-13T22-18-31Z
slug: apps-web-src-ui-homescreen-tsx
---
# Critique — apps/web/src/ui/HomeScreen.tsx (Home dashboard)

## Design Health Score: 27/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Status-rich hub; no skeletons (data synchronous). |
| 2 | Match System / Real World | 3 | Fluent football vocabulary; emoji status reads gamey. |
| 3 | User Control and Freedom | 3 | Read-only hub, several panels dead-end. |
| 4 | Consistency and Standards | 3 | Solid system; mixed drill-in affordances; one card bundles two sections. |
| 5 | Error Prevention | 3 | Largely n/a; autosave exists. |
| 6 | Recognition Rather Than Recall | 3 | Mini-table windows around user position — thoughtful. |
| 7 | Flexibility and Efficiency | 2 | No keyboard path, no shortcut to match, next-match can't launch match. |
| 8 | Aesthetic and Minimalist Design | 2 | Three same-weight flat cards, five uppercase eyebrows. Nothing leads. |
| 9 | Error Recovery | 3 | Empty states for all dynamic lists; "Nothing yet" thin. |
| 10 | Help and Documentation | 2 | No tooltips; hidden thresholds. |

## Anti-Patterns Verdict

Not landing-page slop — honest product UI. But it IS PRODUCT.md anti-reference #2: the generic drab dark admin dashboard. Three structurally identical flat `.card`s, each topped by an uppercase letter-spaced eyebrow (NEXT MATCH / RECENT RESULTS / LEAGUE / CLUB STATUS / LATEST NEWS). Five eyebrows = AI-grammar tell.

detect.mjs on HomeScreen.tsx: clean, exit 0, zero findings — but a blind spot, not clearance. Detector scans TSX className strings, never reads global.css where violations live:
- global.css:147 — side-stripe border (absolute ban): .news-list li { border-left: 3px solid transparent } colored by .unread. Repeats in match feed (.event-yellow/injury/tactic).
- Unread/highlight states are color-only.

Visual overlays: unavailable (no browser automation; dashboard needs active IndexedDB save). Source review stands in.

## What's Working

1. W/D/L result chips: textbook redundant color+letter encoding (global.css:108) — the a11y principle done right.
2. Mini-table windows around user's league position (HomeScreen.tsx:29) — real insight, not a static top-5.
3. Every dynamic list has a real empty state; season-over fallback tells you what to do next.

## Priority Issues

[P1] No visual hierarchy — the next match doesn't lead. Most important hub element (and the emotional peak) rendered identically to news/table; no way to start the match from here (must use sidebar). Fix: hero next-match block with opponent form, kickoff, primary "Play match" button; demote results/news to lighter list cards; differentiate card roles. Command: /impeccable layout (+ bolder).

[P1] Reads as the "generic drab dark admin" PRODUCT.md names as anti-reference. Five uppercase eyebrows + three flat same-weight cards. Fix: kill eyebrow reflex, let role/weight/size carry hierarchy; add a second surface tier + depth. Command: /impeccable layout + colorize.

[P1] Invisible keyboard focus + color-only states (a11y). .btn/.nav-item have :hover but no :focus-visible (global.css:53-63). Unread = border-left-color only; "your club" = background only. Fix: visible :focus-visible ring everywhere; pair unread/highlight with non-color cue. Command: /impeccable harden (or audit).

[P2] Side-stripe border on unread news — absolute ban (global.css:147-148). Fix: leading unread dot / bold title / full bg tint; same for match-feed events. Command: /impeccable polish.

[P2] Emoji status markers (injured/unhappy) undercut "not gamey" brand + a11y (inconsistent rendering, screen-reader noise). Fix: disciplined status pills matching .result-chip/.window-pill vocabulary; consider clickable to filter squad. Command: /impeccable clarify + colorize.

## Persona Red Flags

Alex (Power User): Can't launch match from hub; no keyboard shortcuts; result rows not clickable. Data without accelerators.
Sam (A11y): No visible focus ring; unread + highlight are color-only; emoji = odd SR output. Credit: W/D/L chips are redundant.
Morgan (Sim Enthusiast, from PRODUCT.md): Injured/unhappy counts dead-end (can't click to see who); hub shallow where a glanceable squad-health read is wanted.

## Minor Observations

- News body is --muted content (~5:1 on --bg2) — passes AA but thin for prose; nudge toward --text.
- span-2 news card lets body run >100ch on wide screens — no line-length cap.
- --muted on --card ~5.1:1 — AA floor; drift darker fails.
- .club-meta stuffs 4 items in one flat column — candidate for stat tiles.

## Questions to Consider

- What if next match owned the top third, everything else supporting beneath?
- Should the hub be where you act (play/advance/fix warnings), not just read?
- "Broadcast-grade": what's the one element a TV sports panel has that this doesn't?
