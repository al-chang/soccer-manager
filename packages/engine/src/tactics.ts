import type { FormationId, Position, Tactics, Mentality, ManagerStyle } from './types';

/** Formation slot layout: position of each of the 11 slots (index 0 = GK). */
export const FORMATIONS: Record<FormationId, Position[]> = {
  '4-4-2': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-3-3': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'],
  '4-2-3-1': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
  '3-5-2': ['GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '5-3-2': ['GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'],
  '4-5-1': ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'],
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

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
