// Season-long audit: user club fields a deliberately sabotaged lineup every
// match (worst available players, scrambled positions, real GK — the most the
// UI allows). Where do they finish? Run with: npx tsx scripts/audit-season.ts
import { generateWorld } from '@soccer-manager/engine/world';
import { advanceDay } from '@soccer-manager/engine/sim';
import { createLiveMatch, simulateMinute, finishMatch } from '@soccer-manager/engine/match';
import { clubPlayers } from '@soccer-manager/engine/squad';
import { overall } from '@soccer-manager/engine/player';
import { sortedTable, seasonFixturesDone } from '@soccer-manager/engine/season';
import { FORMATIONS } from '@soccer-manager/engine/tactics';
import type { GameState, Player } from '@soccer-manager/engine/types';

function sabotage(state: GameState, clubId: number): { starters: number[]; bench: number[] } | null {
  const club = state.clubs[clubId];
  const slots = FORMATIONS[club.tactics.formation];
  const avail = clubPlayers(state, clubId).filter((p) => p.injuryDays === 0 && p.suspendedMatches === 0);
  if (avail.length < 11) return null;
  const worstFirst = [...avail].sort((a, b) => overall(a) - overall(b));
  const used = new Set<number>();
  const starters: number[] = new Array(11).fill(-1);
  // Real GK (the UI forces this), worst one we have.
  const gk = worstFirst.find((p) => p.position === 'GK');
  if (gk) { starters[0] = gk.id; used.add(gk.id); }
  const outfield = worstFirst.filter((p) => !used.has(p.id) && p.position !== 'GK');
  for (let i = 0; i < 11; i++) {
    if (starters[i] !== -1) continue;
    const mismatch = outfield.find((p) => !used.has(p.id) && p.position !== slots[i]);
    const chosen = mismatch ?? worstFirst.find((p) => !used.has(p.id))!;
    starters[i] = chosen.id;
    used.add(chosen.id);
  }
  const bench = worstFirst.filter((p) => !used.has(p.id)).slice(0, 7).map((p) => p.id);
  return { starters, bench };
}

function runSeason(seed: number, clubPick: 'top' | 'mid') {
  const state = generateWorld(seed, 2025, 'audit');
  const league = state.leagues[0];
  const byStrength = [...league.clubIds].sort((a, b) => state.clubs[b].reputation - state.clubs[a].reputation);
  const clubId = clubPick === 'top' ? byStrength[0] : byStrength[Math.floor(byStrength.length / 2)];
  state.userClubId = clubId;
  const club = state.clubs[clubId];

  let w = 0, d = 0, l = 0, guard = 0;
  while (!(state.phase === 'season' && seasonFixturesDone(state)) && guard++ < 400) {
    const res = advanceDay(state);
    if (res.userFixture) {
      const fx = res.userFixture;
      const lineup = sabotage(state, clubId);
      if (lineup) club.lineup = lineup;
      const match = createLiveMatch(state, fx);
      while (!match.finished) simulateMinute(state, match);
      finishMatch(state, match);
      const us = fx.homeClubId === clubId ? match.home : match.away;
      const them = fx.homeClubId === clubId ? match.away : match.home;
      if (us.goals > them.goals) w++; else if (us.goals === them.goals) d++; else l++;
    }
  }
  const table = sortedTable(league);
  const pos = table.findIndex((e) => e.clubId === clubId) + 1;
  const entry = table.find((e) => e.clubId === clubId)!;
  console.log(`seed ${seed} ${clubPick.padEnd(3)} club ${club.name.padEnd(22)} rep ${club.reputation}: finished ${String(pos).padStart(2)}/${table.length}  W${w} D${d} L${l}  GF${entry.goalsFor} GA${entry.goalsAgainst} Pts${entry.points}`);
}

console.log('Sabotaged lineup every match, full season, real advanceDay flow:\n');
for (const seed of [1, 2, 3]) {
  runSeason(seed, 'mid');
  runSeason(seed, 'top');
}
