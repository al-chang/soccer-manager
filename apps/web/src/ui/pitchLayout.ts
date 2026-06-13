import type { FormationId } from '@soccer-manager/engine/types';

/**
 * On-pitch coordinates for each formation slot, in percentages of the pitch
 * (x: 0 = left touchline, 100 = right; y: 0 = opponent's goal, 100 = own goal).
 * Slot order matches FORMATIONS in @soccer-manager/engine/tactics (index 0 = GK).
 */
export interface SlotPos { x: number; y: number }

export const PITCH_LAYOUT: Record<FormationId, SlotPos[]> = {
  '4-4-2': [
    { x: 50, y: 91 },
    { x: 15, y: 72 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 85, y: 72 },
    { x: 15, y: 47 }, { x: 38, y: 51 }, { x: 62, y: 51 }, { x: 85, y: 47 },
    { x: 38, y: 23 }, { x: 62, y: 23 },
  ],
  '4-3-3': [
    { x: 50, y: 91 },
    { x: 15, y: 72 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 85, y: 72 },
    { x: 30, y: 50 }, { x: 50, y: 55 }, { x: 70, y: 50 },
    { x: 18, y: 25 }, { x: 50, y: 19 }, { x: 82, y: 25 },
  ],
  '4-2-3-1': [
    { x: 50, y: 91 },
    { x: 15, y: 72 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 85, y: 72 },
    { x: 38, y: 57 }, { x: 62, y: 57 },
    { x: 20, y: 37 }, { x: 50, y: 34 }, { x: 80, y: 37 },
    { x: 50, y: 15 },
  ],
  '3-5-2': [
    { x: 50, y: 91 },
    { x: 25, y: 74 }, { x: 50, y: 77 }, { x: 75, y: 74 },
    { x: 10, y: 48 }, { x: 32, y: 52 }, { x: 50, y: 56 }, { x: 68, y: 52 }, { x: 90, y: 48 },
    { x: 38, y: 22 }, { x: 62, y: 22 },
  ],
  '5-3-2': [
    { x: 50, y: 91 },
    { x: 10, y: 66 }, { x: 30, y: 74 }, { x: 50, y: 77 }, { x: 70, y: 74 }, { x: 90, y: 66 },
    { x: 30, y: 48 }, { x: 50, y: 52 }, { x: 70, y: 48 },
    { x: 38, y: 23 }, { x: 62, y: 23 },
  ],
  '4-5-1': [
    { x: 50, y: 91 },
    { x: 15, y: 72 }, { x: 38, y: 75 }, { x: 62, y: 75 }, { x: 85, y: 72 },
    { x: 10, y: 46 }, { x: 30, y: 51 }, { x: 50, y: 55 }, { x: 70, y: 51 }, { x: 90, y: 46 },
    { x: 50, y: 20 },
  ],
};
