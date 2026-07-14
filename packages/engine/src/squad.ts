import type { Club, GameState, Player, Position, FormationId, Lineup } from './types';
import { FORMATIONS } from './tactics';
import { effectiveRating, overall } from './player';

export function clubPlayers(state: GameState, clubId: number): Player[] {
  return Object.values(state.players).filter((p) => p.clubId === clubId);
}

export function isAvailable(p: Player): boolean {
  return p.injuryDays === 0 && p.suspendedMatches === 0;
}

/**
 * Pick the strongest available XI for a formation, plus a bench of up to 7.
 * Players are slotted at their natural position first; gaps are filled with
 * the best remaining players (out of position = effective quality penalty
 * handled by the match engine).
 */
export function pickBestLineup(players: Player[], formation: FormationId, useCondition = true): Lineup {
  const slots = FORMATIONS[formation];
  const available = players.filter(isAvailable);
  const rate = (p: Player) => (useCondition ? effectiveRating(p) : overall(p));
  const sorted = [...available].sort((a, b) => rate(b) - rate(a));
  const used = new Set<number>();
  const starters: number[] = new Array(slots.length).fill(-1);

  // First pass: natural fits, best players first.
  for (let i = 0; i < slots.length; i++) {
    const best = sorted.find((p) => !used.has(p.id) && p.position === slots[i]);
    if (best) {
      starters[i] = best.id;
      used.add(best.id);
    }
  }
  // Second pass: fill gaps with best remaining outfielders (or anyone for GK).
  for (let i = 0; i < slots.length; i++) {
    if (starters[i] !== -1) continue;
    const best = sorted.find((p) => !used.has(p.id) && (slots[i] === 'GK' ? true : p.position !== 'GK'))
      ?? sorted.find((p) => !used.has(p.id));
    if (best) {
      starters[i] = best.id;
      used.add(best.id);
    }
  }

  // Bench: backup GK + best remaining.
  const bench: number[] = [];
  const backupGk = sorted.find((p) => !used.has(p.id) && p.position === 'GK');
  if (backupGk) {
    bench.push(backupGk.id);
    used.add(backupGk.id);
  }
  for (const p of sorted) {
    if (bench.length >= 7) break;
    if (!used.has(p.id)) {
      bench.push(p.id);
      used.add(p.id);
    }
  }
  return { starters, bench };
}

/** Count of healthy players per position for AI squad-need analysis. */
export function positionCounts(players: Player[]): Record<Position, number> {
  const counts: Record<Position, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of players) counts[p.position]++;
  return counts;
}

/** Ideal squad composition the AI aims for. */
export const IDEAL_COUNTS: Record<Position, number> = { GK: 3, DF: 7, MF: 7, FW: 5 };

export function squadStrength(players: Player[]): number {
  if (players.length === 0) return 0;
  const top = [...players].sort((a, b) => overall(b) - overall(a)).slice(0, 16);
  return top.reduce((s, p) => s + overall(p), 0) / top.length;
}

export function totalWages(players: Player[]): number {
  return players.reduce((s, p) => s + p.contract.wage, 0);
}

export function refreshClubLineup(state: GameState, club: Club): void {
  club.lineup = pickBestLineup(clubPlayers(state, club.id), club.tactics.formation);
}
