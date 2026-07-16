# Soccer Manager — project conventions

## Player ratings: never surface `effectiveRating` in the UI

`effectiveRating(p)` (in `packages/engine/src/player.ts`) is a player's ability adjusted
for fitness, sharpness, morale, and form. It is an **internal match-engine
input only** — do not display it to the user anywhere.

The user-facing canonical rating is always `overall(p)` (raw ability). Show
`overall` consistently across every screen (squad, lineup pitch + bench/reserve
lists, match pitch, player modal, transfers) so a player's number never appears
to change when they're moved between contexts.

**Why:** showing `effectiveRating` in some places and `overall` in others made a
player's rating "change" when dragged from the bench into the lineup, which was
confusing. The manager is meant to *infer* a player's current sharpness from the
explicit fitness/form/condition indicators (condition bars, form list, warn
rings), not read a single pre-blended number.

## Manual browser verification: don't drive it yourself

Don't spin up the dev server + a headless browser (chromium-cli, Playwright,
etc.) to visually verify a change. Make the code change, explain what you
changed and why you believe it fixes the issue, and let the human check it in
their own browser.

**Why:** launching a browser and driving it through screenshots burns a lot of
tokens for something the human can confirm in seconds by looking at the app
themselves.
