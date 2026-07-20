# Finances & budgets — v1 work plan

> **Status: complete (2026-07-17).** All seven work packages landed on
> `finances-budgets`. Final tuning truth lives in the calibration block in
> `packages/engine/src/finance.ts`; harnesses: `apps/web/scripts/finance-sim.ts`
> (invariants) and `apps/web/scripts/calibrate.ts` (metrics).

Grows out of the 🟡 roadmap line in [`docs/roadmap/product.md`](../docs/roadmap/product.md).
Design decisions were agreed 2026-07-15. This file is the working guidance for the
agents building it: read **Guidance** fully before starting any work package.

## Guidance (agreed design)

**Goal:** make money *real*. Today `Club.budget` / `Club.wageBudget` are static
gates — wages are never paid, no income exists, and the only movements are
transfer fees plus a conjured prize formula at season rollover
(`packages/engine/src/season.ts` ~line 162). V1 replaces that with a full ledger.

### The economy

- Every club gets a real **`balance`** (bank account).
- **Expenses:** the weekly wage bill is actually deducted; transfer fees out;
  a flat *operations* overhead tuned so a mid-table club roughly breaks even.
- **Income:**
  1. **Gate receipts** per home match — driven by club reputation (implied
     stadium size), current league position, and opponent draw.
  2. **TV / prize money** — monthly installments by league tier, plus a
     final-position payout at season end (replaces the rollover prize formula).
  3. **Commercial** — flat monthly amount from reputation.
- Cadence rides the existing day-advance: wages weekly, TV/commercial monthly,
  gate receipts on match day. A per-category **season ledger** records totals
  for the Finances screen.

### Budgets: board envelope + slider

- At season rollover the **board** looks at the balance and sets an overall
  spending **envelope**, split into transfer budget and wage budget.
- The user can **re-split at any time** with a transfer↔wage slider. The
  conversion is anchored to the season: moving money to wages spreads it across
  the remaining weeks (~£52k transfer budget ↔ £1k/week for a full year), so
  the exchange rate is honest and self-explanatory.
- Future **Board & expectations** feature will add budget *requests* that raise
  the envelope; the slider only re-splits it. Keep that seam clean.

### Discipline (no FFP in v1)

- Balance may dip negative briefly: the board sends escalating warnings
  (news items) and **new signings are blocked** until the club is back in the
  black. No sacking — that belongs to Board & expectations later.
- FFP-style revenue caps are explicitly **deferred to v2**.

### The world must stay believable

- AI clubs run the **identical economy** (cheap per-club arithmetic on day
  ticks). Their transfer AI already gates on budget/wageBudget, so it plugs in.
- Guardrail: a struggling AI club **sells players** rather than death-spiraling.
  The economy must be stable over multi-season sims.

### Surfaces

- New **Finances screen** — this is a signature surface (see
  `docs/design-brief.md` + PRODUCT.md principles: broadcast-dense, "spreadsheet
  that feels alive"). Tiles for balance / transfer budget / wage bill vs cap;
  season income & expense breakdown by category; monthly cash-flow trend; top
  earners list. The budget slider lives here.
- Home dashboard finance tile; "wage room" next to the budget label on
  Transfers; attendance line in post-match news; monthly financial summary
  news item (new or existing `board` news category).

### Constraints & conventions

- Engine stays plain TS, no React deps; `GameState` stays JSON-serializable.
- **Save migration required**: bump `SCHEMA_VERSION` to 3 in
  `packages/engine/src/types.ts`, migrate in `migrate.ts` (seed balances from
  reputation; preserve existing budget/wageBudget as the initial allocation).
- Money formatting: reuse the existing `formatMoney` helper.
- Follow `CLAUDE.md`: never surface `effectiveRating` in UI; don't drive a
  browser to verify — explain the change and let the human check.
- Known tuning risk: `wageDemand()` in `player.ts` uses a `pow(…, 2.6)` curve
  written when wages were free; it must be calibrated against real income
  (WP7).

---

## Work packages

Dependency graph: **WP1 → (WP2, WP3) → WP4 → WP7**; **WP5, WP6** need WP1–WP3.
WP2 and WP3 can run in parallel after WP1 lands; so can WP5 and WP6 after WP3.

Suggested agent tier per the usual split: *mechanical* → sonnet,
*design/tuning* → opus.

### WP1 — Engine: finance types + save migration *(mechanical, foundation)*

- Add finance state to `Club` in `packages/engine/src/types.ts`: `balance`,
  season ledger (per-category income/expense totals for the current season),
  keep `budget`/`wageBudget` as the board-allocation fields (document the new
  meaning).
- Bump `SCHEMA_VERSION` to 3; write the migration in `migrate.ts`: seed
  `balance` from reputation (same order of magnitude as `budgetFor()` in
  `world.ts`), zeroed ledger.
- Seed new-game worlds in `world.ts` with balances.
- **Done when:** typecheck + existing tests pass; a v2 save loads with sane
  balances; new games start with balances scaled by reputation.

### WP2 — Engine: income & expense processing *(mechanical-plus)*

- Hook into the day-advance (`sim.ts`): weekly wage deduction (all clubs),
  monthly TV + commercial income, matchday gate receipts for the home club,
  flat operations overhead. Record every movement in the season ledger.
- Gate receipts: reputation-implied attendance × ticket price, nudged by league
  position and opponent reputation. Emit the attendance figure so match news
  can show it.
- Monthly financial summary news item for the user club; attendance line in
  post-match news.
- Reset ledgers at season rollover.
- **Done when:** simming a season moves every club's balance through all five
  streams; ledger totals reconcile with the balance delta; news items appear.

### WP3 — Engine: board envelope, slider, discipline *(design-sensitive)*

- Replace the rollover prize formula in `season.ts` with the final-position
  payout (income, WP2) + board envelope setting: board derives transfer +
  wage budgets from the club's balance (all clubs, user and AI).
- New engine action: re-split the envelope (transfer↔wage) with the
  weeks-remaining conversion. Expose it through `gameStore.ts`.
- Negative-balance discipline: escalating board warnings via news; block new
  signings (user validations in `gameStore.ts` ~lines 305/350/403/427 and the
  AI gate in `transfers.ts`) while in the red.
- **Done when:** rollover sets believable budgets from balance; slider
  round-trips without creating/destroying money; a broke club cannot sign and
  receives warnings.

### WP4 — Engine: AI economy guardrails *(design-sensitive)*

- Struggling AI clubs (negative or trending-negative balance) list and sell
  players via the existing AI transfer machinery instead of spiraling.
- Multi-season stability: no systematic bankruptcy cascade, no runaway
  rich-get-richer explosion, league competitiveness preserved.
- **Done when:** a 10-season headless sim shows bounded balances across all
  clubs and no league where most clubs are signing-blocked.

### WP5 — UI: Finances screen *(design/tuning — signature surface)*

- New nav entry + screen in `apps/web/src/ui/`: headline tiles (balance,
  transfer budget remaining, wage bill vs cap as a bar), season income/expense
  breakdown by category, monthly cash-flow trend, top earners, and the budget
  slider (WP3 action).
- Earn signature-tier craft per the design brief; dark + light themes; WCAG AA;
  reduced-motion paths for any animation.
- **Done when:** the screen reads at a glance, matches the broadcast-data
  register, and every number reconciles with the engine ledger.

### WP6 — UI: integration touches *(mechanical)*

- Home dashboard finance tile (balance + wage headroom at minimum).
- Transfers screen: "wage room" beside the existing budget label
  (`TransfersScreen.tsx` ~line 160).
- Ensure monthly-summary and board-warning news render well in the inbox.
- **Done when:** finance state is visible from Home and Transfers without
  opening the Finances screen.

### WP7 — Economy calibration *(design/tuning — last)*

- Calibrate `wageDemand()` and the income formulas together: mid-table
  top-flight club ≈ break-even; promotion is a meaningful windfall; relegation
  with a bloated wage bill is a survivable-but-real crisis; star wages don't
  dominate total income.
- Build/extend a headless multi-season sim harness to assert the WP4/WP7
  invariants numerically (bounded balances, break-even bands).
- **Done when:** the harness passes and a hands-on season feels right to the
  human — report the tuned constants and the reasoning.
