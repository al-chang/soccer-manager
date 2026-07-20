import type { Club, Fixture, GameState, LedgerCategory, SeasonLedger } from './types';
import { clamp } from './rng';
import { clubPlayers, totalWages } from './squad';
import { leaguePosition } from './season';
import { dayOfSeasonYear, dayToDate, YEAR_LENGTH } from './calendar';
import { addNews } from './news';
import { formatMoney } from './transfers';

/**
 * Apply a signed money movement to a club: income positive, expense negative.
 * Every balance change must go through here so the season ledger reconciles
 * with the balance delta.
 */
export function recordMoney(club: Club, category: LedgerCategory, amount: number): void {
  club.balance += amount;
  club.ledger[category] += amount;
}

// ---------------------------------------------------------------------------
// ECONOMY CALIBRATION — single source of tuning truth (WP7).
//
// The whole finance feature deferred its number-tuning to this pass. The levers
// live in three files but are calibrated together here: wageDemand() and
// marketValue() in player.ts, the income/operations constants below, prizeFor()
// and boardEnvelope() further down, and balanceFor() in world.ts. Method:
// a 10-season, no-user headless sim reporting per-reputation-band metrics
// (apps/web/scripts/calibrate.ts) and the invariant checker (finance-sim.ts),
// iterated across ≥3 seeds until the targets below held.
//
// THE PROBLEM WP7 INHERITED (all confirmed empirically before tuning):
//   wageDemand()'s pow((ovr-35)/10, 2.6) curve was written when wages were free.
//   Summed over a real 22-player squad it is far STEEPER in reputation than any
//   income stream: a rep-80 squad cost ~20× a rep-40 one, while gate+tv+
//   commercial income scales only ~2.5× across that range. So wage-to-revenue
//   swung from ~0.11 (rep-30, effectively free money — squad at the £500 floor)
//   to ~1.2 (rep-80, a structural ~£22M/yr deficit). The old near-flat
//   operations overhead (200k+rep·3k ≈ £5M/yr for everyone) was far too small to
//   matter, so every club banked a fat surplus and the tier-1 median balance
//   drifted 36M → 182M (~5×) over 10 seasons — margins too fat everywhere.
//
// THE FIX — two coordinated reshapings (see targets/results below):
//
//   1. FLATTEN wageDemand (player.ts): pivot 35→25, exponent 2.6→2.0, scale
//      1800→2100, rep factor 0.8+rep/250 → 0.85+rep/400. This compresses the
//      squad wage bill's growth in reputation so wage-to-revenue lands inside a
//      ~0.5–0.85 band across the whole ladder instead of 0.11–1.2.
//
//   2. Make OPERATIONS a real, revenue-tracking cost (below): base 120k, a steep
//      pow(rep/10, 2.9)·2210 reputation term, ×2.5 (tier 1) / ×0.5 (tier 2).
//      (The tier-2 factor started at 0.8 but that left the bottom of tier 2
//      with no margin: one fresh seed in six ended a league with 7 clubs
//      signing-blocked. 0.5 clears a 10-seed sweep with late-season blocked
//      counts of 0-2 — at the accepted cost of a softer relegation crunch,
//      see the relegation bullet below.)
//      This is the balancing item — with wages ~0.55–0.70 of revenue, operations
//      at ~0.25–0.35 of revenue pulls a mid-table top-flight club to break-even.
//      The STEEP reputation exponent is deliberate: it charges the biggest clubs
//      (who would otherwise bank the largest surplus and drive balance drift)
//      disproportionately more, while relieving small clubs (who would otherwise
//      be the ones tipping into the red and getting signing-blocked) — so it
//      curbs drift at the top and blocked-clubs at the bottom at the same time.
//
//   marketValue() coefficient trimmed 220k→200k so a top player's fee stays
//   ~2–4 years of his (now lower) wage; the promotion lump and prize pots were
//   re-verified against the new income (unchanged). boardEnvelope + balanceFor
//   re-verified stable under the new curves (unchanged).
//
// TARGETS → RESULTS (10-season sim, pooled by reputation band, 10-seed sweep):
//   • wage-to-revenue in ~0.55–0.85 for most, superclubs ≤~0.95, none <0.35 or
//     >1.05 → tier-1 medians 0.50–0.57, tier-2 ~0.75–0.84; superclubs ~0.50 net
//     positive (comfortable, never permanent deficit). ✓
//   • mid-table tier-1 ≈ break-even (|net| ≤ ~15% of income) → rep-70 net ~+5–8%. ✓
//   • promotion windfall ~1.5–2.5× tier-2 revenue → ~1.44× recurring revenue plus
//     the one-time £6M promotion prize ≈ ~1.6× first-season income. ✓ (edge)
//   • relegation crunch survivable by shedding ~20–30% wages → SOFTER than the
//     original target after the tier-2 ops cut: median first-t2-season net is
//     mildly positive, with the tail facing real deficits (worst ~-£11M);
//     36/36 relegated clubs survive. Accepted trade-off vs signing-block risk.
//   • balance drift < ~3× over 10 seasons, no divergence, WP4 invariants hold →
//     tier-1 median drift 1.9–3.3× across 10 seeds (was ~5×); balances bounded;
//     late-season signing-blocked 0–2 per 64 clubs; squads never below 13. ✓
//   • transfer sanity → ~52 deals/season, top fees ~2–4 yr of wage (median 3.2). ✓
//
// CONSEQUENCE FOR EXISTING SAVES: wageDemand changes only flow in via renewals /
// new signings / new worlds — already-signed contracts are NOT migrated (that
// would rewrite the user's squad underneath them). An in-progress save therefore
// converges onto the new curve gradually as contracts turn over, rather than
// snapping to it. Determinism is preserved: same seed ⇒ same world.
// ---------------------------------------------------------------------------

const TV_MONTHLY_TIER1 = 1_450_000;
const TV_MONTHLY_TIER2 = 450_000;

const COMMERCIAL_REP_EXPONENT = 2.4;
const COMMERCIAL_K = 12_500;

// Operations overhead (WP7) — the revenue-tracking balancing cost. Steep in
// reputation and higher in tier 1; see fix #2 in the calibration block above.
const OPERATIONS_BASE = 120_000;
const OPERATIONS_REP_EXPONENT = 2.9;
const OPERATIONS_K = 2_210;
const OPERATIONS_TIER1 = 2.5;
const OPERATIONS_TIER2 = 0.5;

const ATTENDANCE_REP_EXPONENT = 2.0;
const ATTENDANCE_K = 590;
/** Max swing (as a fraction of base attendance) from league position / opponent draw. */
const POSITION_SWING = 0.15;
const OPPONENT_SWING = 0.12;

const TICKET_PRICE_TIER1 = 60;
const TICKET_PRICE_TIER2 = 30;

export function tvMonthlyIncome(tier: number): number {
  return tier === 1 ? TV_MONTHLY_TIER1 : TV_MONTHLY_TIER2;
}

export function commercialMonthlyIncome(reputation: number): number {
  return Math.round(Math.pow(reputation / 10, COMMERCIAL_REP_EXPONENT) * COMMERCIAL_K);
}

export function operationsMonthlyOverhead(reputation: number, tier: number): number {
  const tierFactor = tier === 1 ? OPERATIONS_TIER1 : OPERATIONS_TIER2;
  return Math.round((OPERATIONS_BASE + Math.pow(reputation / 10, OPERATIONS_REP_EXPONENT) * OPERATIONS_K) * tierFactor);
}

export function ticketPriceForTier(tier: number): number {
  return tier === 1 ? TICKET_PRICE_TIER1 : TICKET_PRICE_TIER2;
}

/**
 * Implied home attendance for a fixture: driven by the home club's
 * reputation (bigger reputation → bigger home ground), nudged by the home
 * club's current league position (top of the table draws a bigger crowd than
 * the bottom) and the away side's reputation (a big away team boosts the
 * gate a little).
 */
export function matchAttendance(state: GameState, fixture: Fixture): number {
  const home = state.clubs[fixture.homeClubId];
  const away = state.clubs[fixture.awayClubId];
  const league = state.leagues.find((l) => l.id === fixture.leagueId);
  const base = Math.pow(home.reputation / 10, ATTENDANCE_REP_EXPONENT) * ATTENDANCE_K;
  if (!league || !away) return Math.max(0, Math.round(base));

  const tableSize = league.clubIds.length;
  const position = leaguePosition(league, home.id); // 1 = top
  const positionFactor = tableSize > 1
    ? 1 + POSITION_SWING * (((tableSize + 1) / 2 - position) / ((tableSize - 1) / 2))
    : 1;
  const opponentFactor = 1 + clamp((away.reputation - league.reputation) / 250, -OPPONENT_SWING, OPPONENT_SWING);

  return Math.max(0, Math.round(base * positionFactor * opponentFactor));
}

/**
 * Process gate receipts for a fixture about to be played: credits the home
 * club's ledger and returns the attendance figure (for news). Attendance is
 * derived purely from pre-match state (reputation/position), so this can run
 * before the match itself is simulated.
 *
 * sim.ts calls this for every AI-simulated fixture during the day-advance;
 * the user's own fixtures are simulated by the web app's match flow instead,
 * which calls this from gameStore's concludeMatch. Every fixture must go
 * through exactly one of those two paths.
 */
export function processMatchGate(state: GameState, fixture: Fixture): number {
  const home = state.clubs[fixture.homeClubId];
  const league = state.leagues.find((l) => l.id === fixture.leagueId);
  const attendance = matchAttendance(state, fixture);
  const revenue = attendance * ticketPriceForTier(league?.tier ?? 1);
  recordMoney(home, 'gate', revenue);
  return attendance;
}

/** Sum of a season ledger's income categories (>= 0) and expense categories (< 0, sign kept). */
function ledgerTotals(ledger: SeasonLedger): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const v of Object.values(ledger)) {
    if (v >= 0) income += v; else expense += v;
  }
  return { income, expense };
}

/**
 * Push one monthly checkpoint for the Finances screen's cash-flow trend.
 * `income`/`expense` are derived as the delta between the club's cumulative
 * season ledger totals now and the sum already recorded in `financeHistory`
 * — so each entry captures only the month just completed, not the running
 * season total.
 */
export function takeFinanceSnapshot(club: Club, day: number): void {
  const { income, expense } = ledgerTotals(club.ledger);
  const pastIncome = club.financeHistory.reduce((s, f) => s + f.income, 0);
  const pastExpense = club.financeHistory.reduce((s, f) => s + f.expense, 0);
  club.financeHistory.push({
    day,
    balance: club.balance,
    income: income - pastIncome,
    expense: expense - pastExpense,
  });
}

/** Every club's weekly wage bill, deducted from balance and recorded in the ledger. */
export function payWeeklyWages(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    const bill = totalWages(clubPlayers(state, club.id));
    if (bill > 0) recordMoney(club, 'wages', -bill);
  }
}

/**
 * Monthly cadence for every club: snapshot the month just completed (before
 * this month's flows land), then pay tv/commercial income and operations
 * overhead. Posts a financial summary news item for the user's club.
 */
export function payMonthlyFinances(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    takeFinanceSnapshot(club, state.day);

    if (club.id === state.userClubId) {
      const snapshot = club.financeHistory[club.financeHistory.length - 1];
      const net = snapshot.income + snapshot.expense;
      const wageBill = totalWages(clubPlayers(state, club.id));
      const netSign = net >= 0 ? '+' : '-';
      addNews(state, 'board', 'Monthly finance summary',
        `Balance: ${formatMoney(club.balance)}. Last month's net: ${netSign}${formatMoney(Math.abs(net))}. ` +
        `Weekly wage bill ${formatMoney(wageBill)} against a wage budget of ${formatMoney(club.wageBudget)}/week.`);
    }

    const league = state.leagues.find((l) => l.id === club.leagueId);
    const tier = league?.tier ?? 1;
    recordMoney(club, 'tv', tvMonthlyIncome(tier));
    recordMoney(club, 'commercial', commercialMonthlyIncome(club.reputation));
    recordMoney(club, 'operations', -operationsMonthlyOverhead(club.reputation, tier));
  }
}

// ---------------------------------------------------------------------------
// Season rollover: final-position prize + board envelope
// ---------------------------------------------------------------------------

/** Whole weeks in a season year (365 / 7 ≈ 52). Used across the finance math. */
export const WEEKS_PER_SEASON = 52;

/**
 * Final-position prize / TV payout for finishing `position` (1-based) of
 * `leagueSize` clubs in a league of the given `tier`. Real income — recorded
 * against the 'prize' ledger category at rollover.
 *
 * Design (kept "in a believable ratio to the reputation-based budgets seeded in
 * world.ts", where a top-flight club's transfer budget is ~£10-30M):
 *   - Each tier has a pot: the top flight (tier 1) pays far more than tier 2,
 *     modelling the TV-money cliff between divisions.
 *   - A merit share scales the pot linearly with finishing position, but even
 *     the bottom club banks a 35% "participation" floor — nobody finishes a
 *     season with nothing.
 *   - Promotion is a deliberate windfall: the two promoted (tier-2) clubs get a
 *     large lump on top, because next season they draw the tier-1 pot and face a
 *     tier-1 wage market. Champions of either tier get a title bonus too.
 *
 * These are the levers WP7 will finally calibrate against the income streams; the
 * shape (champions/promotion meaningfully richer, relegation still paid but
 * squeezed) is what matters here.
 */
export function prizeFor(tier: number, position: number, leagueSize: number): number {
  const pot = tier === 1 ? 8_000_000 : 2_500_000;
  const meritFrac = (leagueSize - position + 1) / leagueSize; // 1.0 top .. 1/size bottom
  let payout = pot * (0.35 + 0.65 * meritFrac);
  // Promotion windfall: the clubs going up bank a lump for the jump.
  if (tier === 2 && position <= 2) payout += 6_000_000;
  // Title bonus.
  if (position === 1) payout += tier === 1 ? 4_000_000 : 2_000_000;
  return Math.round(payout / 10_000) * 10_000;
}

/** Weeks of the current squad's wage bill the board holds back before allocating
 * a transfer budget — a ~2-month operating reserve. */
const ENVELOPE_BUFFER_WEEKS = 8;
/** Share of the balance above the reserve the board is willing to earmark for
 * transfers (the rest stays as working cash). */
const ENVELOPE_BUDGET_SHARE = 0.85;

export interface BoardEnvelope {
  budget: number; // transfer allocation
  wageBudget: number; // weekly wage cap
}

/**
 * The board's next-season spending envelope, derived from the club's actual
 * `balance` and its current weekly wage bill — never conjured from thin air.
 *
 *   - **budget** (transfer allocation): the share of the balance sitting above a
 *     reserve of `ENVELOPE_BUFFER_WEEKS` of wages, floored at 0. A club in the
 *     red (or one whose cash barely covers its reserve) gets nothing to spend.
 *     Because it's a fraction of a positive balance it is always coverable.
 *   - **wageBudget**: anchored to the actual wage bill with headroom that grows
 *     with balance health and (slightly) with tier — generous for a rich
 *     top-flight side, pinned just above the bill for a poor one. It never lands
 *     below the current bill, so a club is never in instant violation of its own
 *     cap at rollover. A relegated club carrying a fat bill therefore gets a cap
 *     barely above that bill and little-to-no transfer budget: the squeeze.
 *
 * `wageBill` is the squad's current total weekly wages (from `totalWages`).
 */
export function boardEnvelope(balance: number, wageBill: number, tier: number): BoardEnvelope {
  const reserve = wageBill * ENVELOPE_BUFFER_WEEKS;
  const spendable = Math.max(0, balance - reserve);
  const budget = Math.round((spendable * ENVELOPE_BUDGET_SHARE) / 50_000) * 50_000;

  // Wage headroom: 0.05 base + a tier nudge + up to 0.35 for balance health,
  // where "health" is the balance measured against half a season of wages.
  const tierBonus = tier === 1 ? 0.10 : 0.05;
  const healthRatio = wageBill > 0 ? Math.min(1, Math.max(0, balance / (wageBill * 26))) : 1;
  const headroom = 0.05 + tierBonus + 0.35 * healthRatio;
  // Never round below the actual bill, or the club is in instant violation.
  const wageBudget = Math.max(wageBill, Math.round((wageBill * (1 + headroom)) / 1_000) * 1_000);

  return { budget, wageBudget };
}

// ---------------------------------------------------------------------------
// Transfer ↔ wage slider
// ---------------------------------------------------------------------------

/** Wage-budget moves round to this step so the slider round-trips exactly. */
const WAGE_STEP = 100;

/** Whole weeks left in the current season year, clamped to at least 1 so the
 * slider's exchange rate stays finite right up to the last week. */
export function weeksRemaining(day: number): number {
  return Math.max(1, Math.round((YEAR_LENGTH - dayOfSeasonYear(day)) / 7));
}

/**
 * Re-split the board envelope between transfer budget and wage room, at the
 * season-anchored exchange rate: a lump of transfer budget converts to a weekly
 * wage allowance spread over the weeks remaining (so ~£52k ↔ £1k/week at the
 * start of a season). `transferDelta` is the signed change to `budget`:
 *   - negative → move cash out of transfers into wage room (wageBudget rises);
 *   - positive → pull wage room back into transfers (wageBudget falls).
 * The inverse move at the same point in the season restores the split exactly
 * and conserves money — this only re-labels allocations, `balance` is untouched.
 *
 * Returns an error message on a rejected move (and leaves the club unchanged),
 * or null on success.
 */
export function resplitBudget(state: GameState, club: Club, transferDelta: number): string | null {
  if (!Number.isFinite(transferDelta) || transferDelta === 0) return 'No change.';

  const weeks = weeksRemaining(state.day);
  // Convert on magnitude then re-apply the sign so +X and −X round identically
  // (JS Math.round is asymmetric around .5 for negatives — this avoids drift).
  const weeklyMag = Math.round(Math.abs(transferDelta) / weeks / WAGE_STEP) * WAGE_STEP;
  const wageDelta = -Math.sign(transferDelta) * weeklyMag; // budget up ⇒ wage room down

  const newBudget = club.budget + transferDelta;
  const newWageBudget = club.wageBudget + wageDelta;

  if (newBudget < 0) return 'Transfer budget cannot go negative.';
  const wageBill = totalWages(clubPlayers(state, club.id));
  if (newWageBudget < wageBill) return 'Wage budget cannot drop below the current wage bill.';

  club.budget = newBudget;
  club.wageBudget = newWageBudget;
  return null;
}

// ---------------------------------------------------------------------------
// Discipline: overdraft warnings
// ---------------------------------------------------------------------------

export type OverdraftSeverity = 'none' | 'notice' | 'concern' | 'crisis';

/**
 * How deep in the red a club is, graded against its weekly wage bill (so a big
 * club and a small club at the same "weeks of wages" underwater are treated
 * alike). Derived purely from current state — no persisted counters.
 */
export function overdraftSeverity(club: Club, weeklyWageBill: number): OverdraftSeverity {
  if (club.balance >= 0) return 'none';
  const deficit = -club.balance;
  const weeksUnderwater = weeklyWageBill > 0 ? deficit / weeklyWageBill : Infinity;
  if (weeksUnderwater < 4) return 'notice'; // < ~1 month of wages
  if (weeksUnderwater < 12) return 'concern'; // 1-3 months
  return 'crisis'; // > 3 months of wages in the red
}

/**
 * How hard an AI club should be trying to raise cash by selling, on a 4-level
 * scale. This is WP4's central "financial stress" grader: it extends
 * `overdraftSeverity` *below* zero to also catch clubs that are still solvent
 * but whose balance no longer covers a safe wage runway — they should start
 * trimming the wage bill BEFORE they hit the red, not after (selling is the
 * lever that pays twice: a fee now and wage relief forever, and it takes weeks
 * for a listed player to actually attract a bid, so a club that waits until it
 * is already overdrawn reacts far too late).
 *
 * Graded by **wage runway** — how many weeks the current balance would cover
 * the weekly wage bill:
 *   - `>= SELL_TRIGGER_WEEKS`  → `'none'`     comfortable; sheds only true surplus.
 *   - `0 .. SELL_TRIGGER_WEEKS` → `'trim'`     cash thinning: proactively list
 *                                              surplus, and stop discretionary buying.
 *   - in the red (notice/concern) → `'sell'`   list more, and accept below-value bids.
 *   - deep in the red (crisis)    → `'firesale'` list aggressively at steep discounts.
 *
 * `SELL_TRIGGER_WEEKS` is deliberately the same 8 weeks the board holds back as
 * an operating reserve in `boardEnvelope`, so a club starts trimming exactly
 * when its cash dips into the reserve the board never wanted it to touch.
 */
export type SellPressure = 'none' | 'trim' | 'sell' | 'firesale';

export const SELL_TRIGGER_WEEKS = 8;

export function sellPressure(club: Club, weeklyWageBill: number): SellPressure {
  if (club.balance < 0) {
    return overdraftSeverity(club, weeklyWageBill) === 'crisis' ? 'firesale' : 'sell';
  }
  if (weeklyWageBill <= 0) return 'none'; // no wages to shed and in the black
  const runwayWeeks = club.balance / weeklyWageBill;
  return runwayWeeks < SELL_TRIGGER_WEEKS ? 'trim' : 'none';
}

const OVERDRAFT_COPY: Record<Exclude<OverdraftSeverity, 'none'>, { title: string; body: string }> = {
  notice: {
    title: 'The board notes the overdraft',
    body: 'The club has slipped into the red. The board expects the books balanced before further spending.',
  },
  concern: {
    title: 'Board concerned by the finances',
    body: 'The overdraft is now several weeks of wages deep and the board is growing concerned. Trim the wage bill or bring in transfer income.',
  },
  crisis: {
    title: 'Board alarmed at the deficit',
    body: 'The deficit has ballooned to months of wages and the board is alarmed. Sell players and cut costs urgently.',
  },
};

/**
 * Monthly board warning while the user club is overdrawn. Self-gating: emits at
 * most once a month (on the 1st) and only when the balance is negative, with a
 * tone that escalates with `overdraftSeverity`. Safe to call every simulated
 * day. Kept out of the engine's day loop (which WP2 owns) — the caller decides
 * cadence by calling it once per advanced day.
 */
export function maybeEmitOverdraftWarning(state: GameState): void {
  const club = state.clubs[state.userClubId];
  if (!club || club.balance >= 0) return;
  if (dayToDate(state.day, state.startYear).dayOfMonth !== 1) return;
  const wageBill = totalWages(clubPlayers(state, club.id));
  const sev = overdraftSeverity(club, wageBill);
  if (sev === 'none') return;
  const copy = OVERDRAFT_COPY[sev];
  addNews(state, 'board', copy.title, copy.body, true);
}
