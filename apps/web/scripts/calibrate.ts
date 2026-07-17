// WP7 — economy calibration metrics harness.
//
// Runs a no-user-club world for N seasons and, at the end of each season (the
// day before rollover, when the ledger holds a full realized season), buckets
// every club by reputation band and reports the WP7 calibration targets:
//   - wage-to-revenue ratio distribution per band
//   - season net (operating + transfers) per band
//   - balance drift curve (league-median T1/T2)
//   - promotion / relegation case studies
//   - transfer volume + average fee
//   - market-value vs wage sanity for the top players
//
// Run:  cd apps/web && npx tsx scripts/calibrate.ts [seed] [seasons]
import { generateWorld } from '@soccer-manager/engine/world';
import { advanceDay } from '@soccer-manager/engine/sim';
import { simulateFullMatch } from '@soccer-manager/engine/match';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { prizeFor, sellPressure } from '@soccer-manager/engine/finance';
import { leaguePosition } from '@soccer-manager/engine/season';
import { dayOfSeasonYear } from '@soccer-manager/engine/calendar';
import { marketValue, overall } from '@soccer-manager/engine/player';

const seed = Number(process.argv[2] ?? 12345);
const SEASONS = Number(process.argv[3] ?? 10);
const state = generateWorld(seed, 2025, 'calibrate');
state.userClubId = -999;

const fmtM = (n: number) => (n / 1_000_000).toFixed(1);
const tierOf = (clubId: number) =>
  state.leagues.find((l) => l.id === state.clubs[clubId].leagueId)!.tier;
const median = (arr: number[]) => arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : 0;
const mean = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const band = (rep: number) => `${Math.floor(rep / 10) * 10}s`;

interface ClubSeason {
  season: number; rep: number; tier: number; band: string;
  gate: number; tv: number; commercial: number; prize: number; operations: number; wages: number;
  transfersNet: number; net: number; wageBill: number; annualRevenue: number; wageToRev: number;
  balance: number; position: number;
}

const rows: ClubSeason[] = [];
// Track prior-season tier per club to detect promotions/relegations.
const priorTier = new Map<number, number>();
const promoCases: { season: number; rep: number; prevRev: number; newRev: number }[] = [];
const relCases: { season: number; rep: number; prevNet: number; newNet: number; recovered: boolean }[] = [];
const prevRevByClub = new Map<number, number>();

function snapshotSeason(s: number) {
  for (const c of Object.values(state.clubs)) {
    const league = state.leagues.find((l) => l.id === c.leagueId)!;
    const pos = leaguePosition(league, c.id);
    const prize = prizeFor(league.tier, pos, league.clubIds.length);
    const l = c.ledger;
    const wages = -l.wages; // stored negative
    const operations = -l.operations;
    const transfersNet = l.playerSales + l.transferFees; // sales +, fees -
    const annualRevenue = l.gate + l.tv + l.commercial + prize;
    const net = l.gate + l.tv + l.commercial + prize + l.operations + l.wages + transfersNet;
    const wageBill = totalWages(clubPlayers(state, c.id));
    rows.push({
      season: s, rep: c.reputation, tier: league.tier, band: band(c.reputation),
      gate: l.gate, tv: l.tv, commercial: l.commercial, prize, operations, wages,
      transfersNet, net, wageBill, annualRevenue,
      wageToRev: annualRevenue > 0 ? wages / annualRevenue : Infinity,
      balance: c.balance, position: pos,
    });
    // promotion / relegation case study vs prior tier
    const pt = priorTier.get(c.id);
    const prevRev = prevRevByClub.get(c.id);
    if (pt !== undefined && prevRev !== undefined) {
      if (pt === 2 && league.tier === 1) promoCases.push({ season: s, rep: c.reputation, prevRev, newRev: annualRevenue });
      if (pt === 1 && league.tier === 2) relCases.push({ season: s, rep: c.reputation, prevNet: 0, newNet: net, recovered: c.balance > -wageBill });
    }
    priorTier.set(c.id, league.tier);
    prevRevByClub.set(c.id, annualRevenue);
  }
}

let day = 0;
const driftT1: number[][] = [];
const driftT2: number[][] = [];
for (let s = 0; s < SEASONS; s++) {
  const target = (s + 1) * 365;
  for (; day < target; day++) {
    // Snapshot the full season the day before rollover fires.
    if (dayOfSeasonYear(state.day + 1) === 364) snapshotSeason(s + 1);
    advanceDay(state);
    for (const fx of state.fixtures.filter((f) => f.day <= state.day && !f.played)) {
      simulateFullMatch(state, fx);
    }
  }
  const t1 = [], t2 = [];
  for (const c of Object.values(state.clubs)) (tierOf(c.id) === 1 ? t1 : t2).push(c.balance);
  driftT1.push(t1); driftT2.push(t2);
}

// ---- Report ----
console.log(`\n=== WP7 calibration — seed ${seed}, ${SEASONS} seasons ===\n`);

// Per reputation band, per tier: wage/rev ratio + season net (all seasons pooled).
const bands = [...new Set(rows.map((r) => r.band))].sort();
console.log('Reputation band × tier (pooled across seasons):');
console.log('  band  tier   n   wage/rev[med,p10,p90]   annRev(med)  wages(med)  net(med)   net/rev(med)');
for (const b of bands) {
  for (const tier of [1, 2]) {
    const rs = rows.filter((r) => r.band === b && r.tier === tier);
    if (!rs.length) continue;
    const ratios = rs.map((r) => r.wageToRev).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const p10 = ratios[Math.floor(ratios.length * 0.1)] ?? 0;
    const p90 = ratios[Math.floor(ratios.length * 0.9)] ?? 0;
    const rev = median(rs.map((r) => r.annualRevenue));
    const nets = rs.map((r) => r.net);
    const netRev = median(rs.map((r) => (r.annualRevenue > 0 ? r.net / r.annualRevenue : 0)));
    console.log(
      `  ${b.padEnd(5)} T${tier}  ${String(rs.length).padStart(3)}   ` +
      `${median(ratios).toFixed(2)} [${p10.toFixed(2)},${p90.toFixed(2)}]        ` +
      `${fmtM(rev).padStart(6)}M     ${fmtM(median(rs.map((r) => r.wages))).padStart(6)}M    ` +
      `${(median(nets) >= 0 ? '+' : '') + fmtM(median(nets))}M    ${(netRev * 100).toFixed(0)}%`,
    );
  }
}

// Drift curve.
console.log('\nBalance drift (league-median, [min..max]):');
for (let s = 0; s < SEASONS; s++) {
  console.log(`  S${String(s + 1).padStart(2)}: T1 med ${fmtM(median(driftT1[s]))}M [${fmtM(Math.min(...driftT1[s]))}..${fmtM(Math.max(...driftT1[s]))}]   T2 med ${fmtM(median(driftT2[s]))}M [${fmtM(Math.min(...driftT2[s]))}..${fmtM(Math.max(...driftT2[s]))}]`);
}
const t1s1 = median(driftT1[0]), t1sN = median(driftT1[SEASONS - 1]);
console.log(`  T1 median drift: ${fmtM(t1s1)}M → ${fmtM(t1sN)}M  (${(t1sN / t1s1).toFixed(2)}x)`);

// Promotion windfall.
console.log('\nPromotion windfall (tier-2 → tier-1 clubs, revenue jump):');
if (promoCases.length) {
  const mults = promoCases.map((p) => p.newRev / p.prevRev);
  console.log(`  n=${promoCases.length}  prevRev(med) ${fmtM(median(promoCases.map((p) => p.prevRev)))}M → newRev(med) ${fmtM(median(promoCases.map((p) => p.newRev)))}M  multiple[med] ${median(mults).toFixed(2)}x  (new revenue as multiple of OLD t2 revenue)`);
}

// Relegation crunch.
console.log('\nRelegation crunch (tier-1 → tier-2, first t2 season net):');
if (relCases.length) {
  const nets = relCases.map((r) => r.newNet);
  console.log(`  n=${relCases.length}  net(med) ${fmtM(median(nets))}M [${fmtM(Math.min(...nets))}..${fmtM(Math.max(...nets))}]  survived(balance>-1wk): ${relCases.filter((r) => r.recovered).length}/${relCases.length}`);
}

// Transfers.
const paid = state.transferHistory.filter((t) => t.fee > 0);
console.log(`\nTransfers: ${state.transferHistory.length} total over ${SEASONS} seasons (${(state.transferHistory.length / SEASONS).toFixed(0)}/season), ${paid.length} paid` +
  (paid.length ? `, avg fee £${fmtM(paid.reduce((a, t) => a + t.fee, 0) / paid.length)}M, max £${fmtM(Math.max(...paid.map((t) => t.fee)))}M` : ''));

// Market value vs wage sanity (current squads).
const allPlayers = Object.values(state.players).filter((p) => p.clubId >= 0);
const topByOvr = [...allPlayers].sort((a, b) => overall(b) - overall(a)).slice(0, 20);
console.log('\nTop-20 players: value vs annual wage (value ÷ annual wage = years-of-wage):');
const yow = topByOvr.map((p) => marketValue(p, state.day) / (p.contract.wage * 52));
console.log(`  ovr[${overall(topByOvr[topByOvr.length - 1])}..${overall(topByOvr[0])}]  value(med) £${fmtM(median(topByOvr.map((p) => marketValue(p, state.day))))}M  wk-wage(med) £${(median(topByOvr.map((p) => p.contract.wage)) / 1000).toFixed(0)}k  years-of-wage[med ${median(yow).toFixed(1)}, range ${Math.min(...yow).toFixed(1)}..${Math.max(...yow).toFixed(1)}]`);

// Stress summary.
let stressed = 0;
for (const c of Object.values(state.clubs)) if (sellPressure(c, totalWages(clubPlayers(state, c.id))) !== 'none') stressed++;
console.log(`\nClubs under sell-pressure at end: ${stressed}/64`);
