import type { FormationId, Position, PositionGroup, Tactics, Mentality, ManagerStyle } from './types';

/**
 * Formation slot layout: detailed position of each of the 11 slots (index 0 =
 * GK). Slot order matches apps/web/src/ui/pitchLayout.ts (x:0 = left touchline;
 * the middle slot of a three-man midfield band sits deepest, hence DM).
 */
export const FORMATIONS: Record<FormationId, Position[]> = {
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW'],
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'LW', 'AM', 'RW', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'DM', 'CM', 'RM', 'ST', 'ST'],
  '5-3-2': ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'ST', 'ST'],
  '4-5-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'DM', 'CM', 'RM', 'ST'],
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

// ---- Position taxonomy ----

/** Canonical display / sort order for detailed positions. */
export const POSITIONS: Position[] = [
  'GK', 'LB', 'CB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'ST',
];

const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: 'GK',
  LB: 'DF', CB: 'DF', RB: 'DF',
  DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF',
  LW: 'FW', RW: 'FW', ST: 'FW',
};

/** The coarse tactical group a detailed position belongs to. */
export function positionGroup(pos: Position): PositionGroup {
  return POSITION_GROUP[pos];
}

// Familiarity: how well a player rates a slot role relative to his own. A small
// deterministic multiplier in (0, 1] layered on top of the attribute-based cost
// that `effectiveRatingAs` already applies. Keyed by an unordered position pair.
const FAMILIARITY_PAIRS: Record<string, number> = {
  // Mirrored side, same role, and strongly adjacent roles.
  'LB|RB': 0.95, 'LM|RM': 0.95, 'LW|RW': 0.95,
  'LM|LW': 0.95, 'RM|RW': 0.95, 'CM|DM': 0.95, 'AM|CM': 0.95,
  // Same group, closely related.
  'CB|LB': 0.9, 'CB|RB': 0.9, 'AM|ST': 0.9,
  'CM|LM': 0.9, 'CM|RM': 0.9, 'LW|ST': 0.9, 'RW|ST': 0.9,
};

function pairKey(a: Position, b: Position): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Familiarity multiplier for a player whose natural position is `natural`
 * filling a `slot` role. 1.0 exact; ~0.95 mirrored/strongly-adjacent; ~0.9 same
 * group related; 0.85 same group otherwise; 0.8 outfield cross-group; 0.5 for
 * GK↔outfield. Symmetric and deterministic.
 */
export function familiarity(natural: Position, slot: Position): number {
  if (natural === slot) return 1.0;
  const gN = POSITION_GROUP[natural];
  const gS = POSITION_GROUP[slot];
  if (gN === 'GK' || gS === 'GK') return 0.5; // one side is a keeper
  const explicit = FAMILIARITY_PAIRS[pairKey(natural, slot)];
  if (explicit !== undefined) return explicit;
  return gN === gS ? 0.85 : 0.8;
}

/** Attack/defense bias per formation (multiplier deltas). */
export const FORMATION_BIAS: Record<FormationId, { attack: number; defense: number }> = {
  '4-4-2': { attack: 1.0, defense: 1.0 },
  '4-3-3': { attack: 1.08, defense: 0.95 },
  '4-2-3-1': { attack: 1.03, defense: 1.0 },
  '3-5-2': { attack: 1.05, defense: 0.94 },
  '5-3-2': { attack: 0.9, defense: 1.1 },
  '4-5-1': { attack: 0.92, defense: 1.06 },
};

export const MENTALITY_BIAS: Record<Mentality, { attack: number; defense: number; possession: number }> = {
  'very-defensive': { attack: 0.78, defense: 1.18, possession: -6 },
  defensive: { attack: 0.9, defense: 1.09, possession: -3 },
  balanced: { attack: 1.0, defense: 1.0, possession: 0 },
  attacking: { attack: 1.1, defense: 0.92, possession: 3 },
  'very-attacking': { attack: 1.2, defense: 0.82, possession: 6 },
};

export const MENTALITIES: Mentality[] = ['very-defensive', 'defensive', 'balanced', 'attacking', 'very-attacking'];

/** Default tactic an AI manager of a given style sets up with. */
export function tacticsForStyle(style: ManagerStyle, formation?: FormationId): Tactics {
  switch (style) {
    case 'attacking':
      return { formation: formation ?? '4-3-3', mentality: 'attacking', pressing: 'medium', tempo: 'fast' };
    case 'defensive':
      return { formation: formation ?? '5-3-2', mentality: 'defensive', pressing: 'low', tempo: 'slow' };
    case 'pressing':
      return { formation: formation ?? '4-2-3-1', mentality: 'balanced', pressing: 'high', tempo: 'fast' };
    case 'counter':
      return { formation: formation ?? '4-5-1', mentality: 'defensive', pressing: 'low', tempo: 'fast' };
    default:
      return { formation: formation ?? '4-4-2', mentality: 'balanced', pressing: 'medium', tempo: 'normal' };
  }
}

export function describeTactics(t: Tactics): string {
  return `${t.formation}, ${t.mentality.replace('-', ' ')}, ${t.pressing} press, ${t.tempo} tempo`;
}
