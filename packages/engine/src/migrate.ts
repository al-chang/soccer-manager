import type { GameState, Position, PositionGroup } from './types';
import { SCHEMA_VERSION } from './types';
import { FORMATIONS, positionGroup } from './tactics';

/**
 * Round-robin fallbacks used to spread schema-v1 group positions across the new
 * detailed roles. The first entry is the most common role in the group, so it
 * recurs as the cycle wraps (DF → CB, LB, RB, CB, …).
 */
const ROUND_ROBIN: Record<PositionGroup, Position[]> = {
  GK: ['GK'],
  DF: ['CB', 'LB', 'RB'],
  MF: ['CM', 'DM', 'AM', 'LM', 'RM'],
  FW: ['ST', 'LW', 'RW'],
};

/**
 * Upgrade a schema-v1 save (coarse 'GK'/'DF'/'MF'/'FW' positions) to schema v2
 * (detailed positions). Lineup starters take the detailed position of the slot
 * they occupy when the group matches; everyone else is assigned round-robin
 * within their old group, deterministically by player id. Safe (no-op) on a
 * save already at the current schema version.
 */
export function migrateState(state: GameState): GameState {
  if (state.schemaVersion >= SCHEMA_VERSION) return state;

  const assigned = new Set<number>();

  // Pass 1: starters inherit their formation slot's detailed position.
  for (const club of Object.values(state.clubs)) {
    const slots = FORMATIONS[club.tactics.formation];
    club.lineup.starters.forEach((pid, i) => {
      if (pid < 0) return;
      const p = state.players[pid];
      if (!p || i >= slots.length) return;
      const slotPos = slots[i];
      const oldGroup = p.position as unknown as PositionGroup;
      if (positionGroup(slotPos) === oldGroup) {
        p.position = slotPos;
        assigned.add(pid);
      }
    });
  }

  // Pass 2: everyone else (bench, reserves, free agents) round-robins within
  // their old group. Deterministic ordering by id.
  const cursors: Record<PositionGroup, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const remaining = Object.values(state.players)
    .filter((p) => !assigned.has(p.id))
    .sort((a, b) => a.id - b.id);
  for (const p of remaining) {
    const raw = p.position as unknown as PositionGroup;
    const group: PositionGroup = raw in cursors ? raw : 'MF';
    const cycle = ROUND_ROBIN[group];
    p.position = cycle[cursors[group] % cycle.length];
    cursors[group]++;
  }

  state.schemaVersion = SCHEMA_VERSION;
  return state;
}
