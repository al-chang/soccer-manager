// Shared test fixtures. Import with relative paths from test files
// (`../src/xyz`), not the package's self-referential `@soccer-manager/engine/*`
// export map — that requires the workspace to be linked/built first.
import type { Attributes, GameState, Player } from '../src/types';
import { generateWorld } from '../src/world';

const DEFAULT_ATTRIBUTES: Attributes = {
  pace: 60, strength: 60, stamina: 60, passing: 60, shooting: 60,
  dribbling: 60, defending: 60, goalkeeping: 20, vision: 60, composure: 60, workRate: 60,
};

let nextTestId = 1;

/**
 * A fully-formed Player with sane defaults, everything overridable. Ids
 * auto-increment per test module unless you pass one explicitly — pass
 * explicit ids in tests where identity/dedup matters (e.g. lineup selection).
 */
export function makePlayer(overrides: Partial<Player> = {}): Player {
  const { attributes: attrOverrides, ...rest } = overrides;
  const id = rest.id ?? nextTestId++;
  return {
    id,
    firstName: 'Test',
    lastName: `Player${id}`,
    nationId: 0,
    age: 25,
    birthDayOfYear: 100,
    position: 'CM',
    attributes: { ...DEFAULT_ATTRIBUTES, ...attrOverrides },
    potential: 65,
    clubId: -1,
    contract: { wage: 1000, expiresDay: 365 * 3 },
    squadNumber: 0,
    fitness: 100,
    sharpness: 80,
    morale: 70,
    wellbeing: 80,
    injuryDays: 0,
    injuryName: null,
    suspendedMatches: 0,
    form: [],
    transferListed: false,
    stats: [],
    retiring: false,
    ...rest,
  };
}

/** A full generated world, with the user club pointed at a real club (first club of the first league) so match/lineup logic that keys off userClubId behaves like a real save. */
export function makeState(seed = 1, startYear = 2025): GameState {
  const state = generateWorld(seed, startYear, `test-seed-${seed}`);
  state.userClubId = state.leagues[0].clubIds[0];
  return state;
}
