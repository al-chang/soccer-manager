// WP4 — AI economy guardrails: full 10-season headless stability harness.
//
// Runs a no-user-club world for 10 seasons (every fixture auto-simmed) and
// asserts the WP4 invariants numerically, printing per-season economy metrics.
// This is the long version of test/economy-stability.test.ts (which runs the
// same shape at 3 seasons so it fits the unit suite).
//
// Run:  cd apps/web && npx tsx scripts/finance-sim.ts [seed] [seasons]
// Exits non-zero if any invariant fails.
import { generateWorld } from '@soccer-manager/engine/world';
import { advanceDay } from '@soccer-manager/engine/sim';
import { simulateFullMatch } from '@soccer-manager/engine/match';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { sellPressure } from '@soccer-manager/engine/finance';

const seed = Number(process.argv[2] ?? 12345);
const SEASONS = Number(process.argv[3] ?? 10);
const state = generateWorld(seed, 2025, 'finance-sim');
state.userClubId = -999;

const fmtM = (n: number) => (n / 1_000_000).toFixed(0);
const tierOf = (clubId: number) =>
  state.leagues.find((l) => l.id === state.clubs[clubId].leagueId)!.tier;
const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];

let globalMin = Infinity, globalMax = -Infinity;
let maxBlockedPerLeague = 0;
let minSquadEver = Infinity;
const t1MedBySeason: number[] = [];
const everStressed = new Set<number>();
const failures: string[] = [];

let day = 0;
for (let s = 0; s < SEASONS; s++) {
  const target = (s + 1) * 365;
  for (; day < target; day++) {
    advanceDay(state);
    for (const fx of state.fixtures.filter((f) => f.day <= state.day && !f.played)) {
      simulateFullMatch(state, fx);
    }
    for (const c of Object.values(state.clubs)) {
      minSquadEver = Math.min(minSquadEver, clubPlayers(state, c.id).length);
      if (sellPressure(c, totalWages(clubPlayers(state, c.id))) !== 'none') everStressed.add(c.id);
    }
    for (const lg of state.leagues) {
      maxBlockedPerLeague = Math.max(maxBlockedPerLeague, lg.clubIds.filter((id) => state.clubs[id].balance < 0).length);
    }
  }

  const t1 = [], t2 = [];
  let blocked = 0;
  for (const c of Object.values(state.clubs)) {
    (tierOf(c.id) === 1 ? t1 : t2).push(c.balance);
    if (c.balance < 0) blocked++;
    globalMin = Math.min(globalMin, c.balance);
    globalMax = Math.max(globalMax, c.balance);
  }
  t1MedBySeason.push(median(t1));
  const listed = Object.values(state.players).filter((p) => p.clubId >= 0 && p.transferListed).length;
  console.log(
    `S${String(s + 1).padStart(2)}: T1 med ${fmtM(median(t1))}M [${fmtM(Math.min(...t1))}..${fmtM(Math.max(...t1))}]  ` +
    `T2 med ${fmtM(median(t2))}M [${fmtM(Math.min(...t2))}..${fmtM(Math.max(...t2))}]  ` +
    `blocked ${blocked}/64  listed ${listed}`,
  );
}

const paid = state.transferHistory.filter((t) => t.fee > 0);
console.log(`\nTransfers: ${state.transferHistory.length} total, ${paid.length} paid` +
  (paid.length ? `, avg fee £${fmtM(paid.reduce((a, t) => a + t.fee, 0) / paid.length)}M` : ''));
console.log(`Distinct clubs that hit financial stress at least once: ${everStressed.size}/64`);
console.log(`Global balance range: [${fmtM(globalMin)}..${fmtM(globalMax)}]M  minSquadEver ${minSquadEver}  maxBlockedPerLeague ${maxBlockedPerLeague}`);

// ---- Invariants (mirror the in-suite 3-season assertions) ----
for (const c of Object.values(state.clubs)) {
  if (!Number.isFinite(c.balance)) failures.push(`${c.name} balance not finite`);
}
if (globalMin <= -100_000_000) failures.push(`min balance ${fmtM(globalMin)}M dived below -100M`);
if (globalMax >= 600_000_000) failures.push(`max balance ${fmtM(globalMax)}M exploded past 600M`);
if (maxBlockedPerLeague > 4) failures.push(`a league had ${maxBlockedPerLeague} signing-blocked clubs (> 4)`);
if (minSquadEver < 13) failures.push(`a squad fell to ${minSquadEver} players (< 13)`);

// WP7 drift bound: the top-flight median balance may grow over the run (rich
// clubs bank a modest surplus) but must not diverge. Target is < ~3× the
// opening season's median; the 3.4× bound leaves headroom for seed variance
// (observed 2.3–3.1× across sampled seeds) while still catching the pre-WP7
// ~5× runaway. Divergence, not slow accumulation, is the failure mode.
if (SEASONS >= 5 && t1MedBySeason.length >= 2) {
  const drift = t1MedBySeason[t1MedBySeason.length - 1] / t1MedBySeason[0];
  console.log(`T1 median balance drift over ${SEASONS} seasons: ${drift.toFixed(2)}x`);
  if (drift > 3.4) failures.push(`T1 median balance drifted ${drift.toFixed(2)}x (> 3.4x): balances diverging`);
}

if (failures.length) {
  console.log(`\nFAIL:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nAll WP4 invariants held.');
