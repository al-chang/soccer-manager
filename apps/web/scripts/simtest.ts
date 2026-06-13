// Headless engine balance test: simulates multiple seasons with no user club
// interaction (user club set to a real club but matches auto-simmed) and
// prints sanity metrics. Run with: npx tsx scripts/simtest.ts
import { generateWorld } from '../src/engine/world';
import { advanceDay } from '../src/engine/sim';
import { simulateFullMatch } from '../src/engine/match';
import { sortedTable } from '../src/engine/season';
import { overall } from '../src/engine/player';

const state = generateWorld(12345, 2025, 'sim-test');
state.userClubId = -999; // no user club: every fixture auto-sims

const SEASONS = 6;
const targetDays = SEASONS * 365;
let goals = 0, matches = 0;

console.time('simulation');
for (let d = 0; d < targetDays; d++) {
  advanceDay(state);
  // No user club, so no fixtures are left pending; but guard anyway.
  for (const fx of state.fixtures.filter((f) => f.day <= state.day && !f.played)) {
    simulateFullMatch(state, fx);
  }
}
console.timeEnd('simulation');

for (const club of Object.values(state.clubs)) {
  for (const h of club.history) {
    goals += h.goalsFor;
    matches += h.won + h.drawn + h.lost;
  }
}

console.log(`\nSeasons simulated: ${state.season - 1} (now in season ${state.season})`);
console.log(`Goals per match: ${(goals / (matches / 2) / 2).toFixed(2)} (target ~2.6)`);
console.log(`Player count: ${Object.keys(state.players).length}`);
console.log(`Free agents: ${Object.values(state.players).filter((p) => p.clubId === -1).length}`);
console.log(`Transfers completed: ${state.transferHistory.length}`);
const fees = state.transferHistory.filter((t) => t.fee > 0).map((t) => t.fee);
if (fees.length) {
  console.log(`Paid transfers: ${fees.length}, avg fee £${Math.round(fees.reduce((a, b) => a + b, 0) / fees.length / 1000)}K, max £${Math.round(Math.max(...fees) / 1_000_000 * 10) / 10}M`);
}

// Squad size sanity: no club should be unable to field a team.
const squadSizes = Object.values(state.clubs).map((c) =>
  Object.values(state.players).filter((p) => p.clubId === c.id).length);
console.log(`Squad sizes: min ${Math.min(...squadSizes)}, max ${Math.max(...squadSizes)}, avg ${(squadSizes.reduce((a, b) => a + b, 0) / squadSizes.length).toFixed(1)}`);

// Promotion/relegation actually happened?
const movedClubs = Object.values(state.clubs).filter((c) => c.history.some((h) => h.promoted || h.relegated)).length;
console.log(`Clubs promoted/relegated at least once: ${movedClubs}`);

// Age distribution (regens keeping the world young?).
const ages = Object.values(state.players).map((p) => p.age);
console.log(`Ages: min ${Math.min(...ages)}, max ${Math.max(...ages)}, avg ${(ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1)}`);

// Ability distribution.
const ovrs = Object.values(state.players).map((p) => overall(p));
console.log(`Overall: min ${Math.min(...ovrs)}, max ${Math.max(...ovrs)}, avg ${(ovrs.reduce((a, b) => a + b, 0) / ovrs.length).toFixed(1)}`);

// Sample final table from last season.
const league = state.leagues[0];
console.log(`\n${league.name} current table (season ${state.season}):`);
for (const [i, e] of sortedTable(league).entries()) {
  const c = state.clubs[e.clubId];
  console.log(`${String(i + 1).padStart(2)}. ${c.name.padEnd(26)} P${e.played} ${e.won}-${e.drawn}-${e.lost} GF${e.goalsFor} GA${e.goalsAgainst} Pts${e.points}`);
}
