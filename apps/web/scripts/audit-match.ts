// Match-engine audit: does a deliberately sabotaged lineup (worst players,
// everyone out of position) still win matches? Run with: npx tsx scripts/audit-match.ts
import { generateWorld } from '@soccer-manager/engine/world';
import { createLiveMatch, simulateMinute } from '@soccer-manager/engine/match';
import { pickBestLineup, clubPlayers } from '@soccer-manager/engine/squad';
import { overall, effectiveRating } from '@soccer-manager/engine/player';
import { FORMATIONS, familiarity, positionGroup } from '@soccer-manager/engine/tactics';
import type { GameState, Fixture, Player } from '@soccer-manager/engine/types';

const state = generateWorld(42, 2025, 'audit');
const league = state.leagues[0];
const userClub = state.clubs[league.clubIds[Math.floor(league.clubIds.length / 2)]]; // mid-table club
state.userClubId = userClub.id; // so buildSide never refreshes our lineup

// ---- Lineup builders ----
function available(players: Player[]): Player[] {
  return players.filter((p) => p.injuryDays === 0 && p.suspendedMatches === 0);
}

/** pool: 'worst' | 'best'; oop: scramble positions; realGk: keep a natural GK in goal. */
function buildLineup(players: Player[], pool: 'worst' | 'best', oop: boolean, realGk: boolean): number[] {
  const slots = FORMATIONS[userClub.tactics.formation];
  const avail = available(players);
  const sorted = [...avail].sort((a, b) => pool === 'worst' ? overall(a) - overall(b) : overall(b) - overall(a));
  const used = new Set<number>();
  const starters: number[] = new Array(slots.length).fill(-1);
  if (realGk) {
    const gks = avail.filter((p) => p.position === 'GK').sort((a, b) => pool === 'worst' ? overall(a) - overall(b) : overall(b) - overall(a));
    if (gks.length) { starters[0] = gks[0].id; used.add(gks[0].id); }
  }
  const eleven = sorted.filter((p) => !used.has(p.id) && (!realGk || p.position !== 'GK')).slice(0, 11 - used.size);
  for (let i = 0; i < slots.length; i++) {
    if (starters[i] !== -1) continue;
    // oop scrambles by tactical group (e.g. a defender in a midfield slot) —
    // a much rougher mismatch than the detailed-position adjacency familiarity() scores.
    const match = oop
      ? eleven.find((p) => !used.has(p.id) && positionGroup(p.position) !== positionGroup(slots[i]))
      : eleven.find((p) => !used.has(p.id) && p.position === slots[i]);
    const chosen = match ?? eleven.find((p) => !used.has(p.id))!;
    starters[i] = chosen.id;
    used.add(chosen.id);
  }
  return starters;
}

function describeLineup(starters: number[]) {
  const slots = FORMATIONS[userClub.tactics.formation];
  return starters.map((id, i) => {
    const p = state.players[id];
    const fam = familiarity(p.position, slots[i]);
    const oop = fam < 1 ? ` (natural ${p.position}, fam ${fam.toFixed(2)})` : '';
    return `  slot ${i} ${slots[i]}: ovr ${overall(p)} eff ${effectiveRating(p).toFixed(1)}${oop}`;
  }).join('\n');
}

function runMatches(label: string, n: number) {
  let w = 0, d = 0, l = 0, gf = 0, ga = 0, shotsFor = 0, shotsAgainst = 0;
  let fxId = 900000;
  for (let i = 0; i < n; i++) {
    // Rotate opponents around the league; alternate home/away.
    const oppId = league.clubIds[(userClub.id + 1 + (i % (league.clubIds.length - 1))) % league.clubIds.length === userClub.id
      ? (userClub.id + 2) % league.clubIds.length
      : (league.clubIds.indexOf(userClub.id) + 1 + (i % (league.clubIds.length - 1))) % league.clubIds.length];
    const opp = league.clubIds.filter((c) => c !== userClub.id)[i % (league.clubIds.length - 1)];
    const home = i % 2 === 0;
    state.seed = (1000 + i * 7) >>> 0;
    const fx: Fixture = {
      id: fxId++, leagueId: league.id, round: 0, day: state.day,
      homeClubId: home ? userClub.id : opp, awayClubId: home ? opp : userClub.id,
      played: false, homeGoals: 0, awayGoals: 0,
    };
    const match = createLiveMatch(state, fx);
    while (!match.finished) simulateMinute(state, match);
    const us = home ? match.home : match.away;
    const them = home ? match.away : match.home;
    gf += us.goals; ga += them.goals; shotsFor += us.shots; shotsAgainst += them.shots;
    if (us.goals > them.goals) w++; else if (us.goals === them.goals) d++; else l++;
  }
  console.log(`${label}: W${w} D${d} L${l}  GF ${(gf / n).toFixed(2)}/g GA ${(ga / n).toFixed(2)}/g  shots ${(shotsFor / n).toFixed(1)} vs ${(shotsAgainst / n).toFixed(1)}  pts/g ${((w * 3 + d) / n).toFixed(2)}`);
}

const squad = clubPlayers(state, userClub.id);
const avgLeagueOvr = league.clubIds.map((cid) => {
  const ps = clubPlayers(state, cid).sort((a, b) => overall(b) - overall(a)).slice(0, 11);
  return ps.reduce((s, p) => s + overall(p), 0) / ps.length;
});
console.log(`League: ${league.name}. Best-XI avg overall across clubs: min ${Math.min(...avgLeagueOvr).toFixed(1)}, max ${Math.max(...avgLeagueOvr).toFixed(1)}`);
console.log(`\nUser club: ${userClub.name}`);

function scenario(label: string, starters: number[], show = false) {
  userClub.lineup = { starters, bench: [] };
  const avg = (starters.reduce((s, id) => s + overall(state.players[id]), 0) / 11).toFixed(1);
  console.log(`\n${label} (avg ovr ${avg})`);
  if (show) console.log(describeLineup(starters));
  runMatches('  result', 300);
}

scenario('1. BEST XI, natural positions', pickBestLineup(squad, userClub.tactics.formation).starters);
scenario('2. WORST XI, natural positions, real GK', buildLineup(squad, 'worst', false, true));
scenario('3. BEST XI, outfield scrambled, real GK', buildLineup(squad, 'best', true, true));
scenario('4. WORST XI, scrambled, real GK', buildLineup(squad, 'worst', true, true), true);
scenario('5. WORST XI, scrambled, outfielder in goal', buildLineup(squad, 'worst', true, false));
