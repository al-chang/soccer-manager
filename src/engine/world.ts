import type {
  GameState, Nation, League, Club, AiManager, Player, Position, Fixture, ManagerStyle, ManagerTemper,
} from './types';
import { SCHEMA_VERSION } from './types';
import { type Rng, createRng, randInt, pick, shuffle, gaussianIn, chance } from './rng';
import {
  NAME_POOLS, ALBION_CITIES, ALBION_SUFFIXES, HISPANIA_CITIES, HISPANIA_PREFIXES, CLUB_COLORS,
} from './names';
import { generatePlayer, wageDemand, overall } from './player';
import { tacticsForStyle, FORMATION_IDS } from './tactics';
import { pickBestLineup, clubPlayers } from './squad';
import { SEASON_FIRST_MATCH_DAY, ROUND_INTERVAL, YEAR_LENGTH } from './calendar';

const LEAGUE_SIZE = 16;
const STYLE_POOL: ManagerStyle[] = ['attacking', 'defensive', 'balanced', 'pressing', 'counter'];
const TEMPER_POOL: ManagerTemper[] = ['aggressive', 'patient', 'shrewd', 'impulsive', 'loyal'];

const SQUAD_TEMPLATE: { pos: Position; count: number }[] = [
  { pos: 'GK', count: 3 },
  { pos: 'DF', count: 7 },
  { pos: 'MF', count: 7 },
  { pos: 'FW', count: 5 },
];

export function generateWorld(seed: number, startYear: number, saveName: string): GameState {
  const rng = createRng(seed);
  let nextId = 1;
  const id = () => nextId++;

  const nations: Nation[] = [
    { id: 0, name: 'Albion', adjective: 'Albionese' },
    { id: 1, name: 'Hispania', adjective: 'Hispanian' },
  ];

  const leagues: League[] = [
    mkLeague(id(), 'Albion Premier Division', 0, 1, 72),
    mkLeague(id(), 'Albion Championship', 0, 2, 52),
    mkLeague(id(), 'Hispania Primera', 1, 1, 70),
    mkLeague(id(), 'Hispania Segunda', 1, 2, 50),
  ];

  const clubs: Record<number, Club> = {};
  const players: Record<number, Player> = {};
  const managers: Record<number, AiManager> = {};

  // Club names — draw cities without replacement per nation.
  const albionCities = shuffle(rng, [...ALBION_CITIES]);
  const hispaniaCities = shuffle(rng, [...HISPANIA_CITIES]);
  const colorPool = shuffle(rng, [...CLUB_COLORS]);
  let colorIdx = 0;

  for (const league of leagues) {
    for (let i = 0; i < LEAGUE_SIZE; i++) {
      const nationId = league.nationId;
      const name =
        nationId === 0
          ? `${albionCities.pop()!} ${pick(rng, ALBION_SUFFIXES)}`
          : `${pick(rng, HISPANIA_PREFIXES)} ${hispaniaCities.pop()!}`;
      // Reputation spread within the league: a few big clubs, a long tail.
      const reputation = Math.round(gaussianIn(rng, league.reputation, 7, league.reputation - 14, league.reputation + 16));
      const clubId = id();

      const manager: AiManager = {
        id: id(),
        name: `${pick(rng, NAME_POOLS[nationId].managerFirst)} ${pick(rng, NAME_POOLS[nationId].last)}`,
        nationId,
        style: pick(rng, STYLE_POOL),
        temper: pick(rng, TEMPER_POOL),
        activity: rng() * 0.7 + 0.3,
        youthBias: rng(),
      };
      managers[manager.id] = manager;

      const club: Club = {
        id: clubId,
        name,
        shortName: shortenName(name),
        nationId,
        leagueId: league.id,
        reputation,
        budget: budgetFor(reputation, rng),
        wageBudget: wageBudgetFor(reputation),
        managerId: manager.id,
        tactics: tacticsForStyle(manager.style, chance(rng, 0.3) ? pick(rng, FORMATION_IDS) : undefined),
        lineup: { starters: [], bench: [] },
        colors: colorPool[colorIdx++ % colorPool.length],
        history: [],
      };
      clubs[clubId] = club;
      league.clubIds.push(clubId);
      league.table.push(emptyTableEntry(clubId));

      // Squad generation: quality tracks reputation.
      for (const { pos, count } of SQUAD_TEMPLATE) {
        for (let j = 0; j < count; j++) {
          const age = randInt(rng, 17, 34);
          const baseQuality = reputation * 0.82 + 10;
          let target = gaussianIn(rng, baseQuality, 6, baseQuality - 14, baseQuality + 12);
          if (age <= 20) target -= randInt(rng, 4, 12); // youngsters start raw
          const contractYears = randInt(rng, 1, 4);
          const expires = YEAR_LENGTH * contractYears;
          // Foreign players occasionally appear in each nation's leagues.
          const playerNation = chance(rng, 0.82) ? nationId : 1 - nationId;
          const player = generatePlayer(rng, id(), playerNation, pos, Math.round(target), age, expires);
          player.clubId = clubId;
          player.contract.wage = wageDemand(overall(player), age, reputation);
          players[player.id] = player;
        }
      }
    }
  }

  // Free agents: a small pool of unattached players.
  for (let i = 0; i < 40; i++) {
    const pos = pick(rng, ['GK', 'DF', 'MF', 'FW'] as Position[]);
    const p = generatePlayer(rng, id(), randInt(rng, 0, 1), pos, randInt(rng, 38, 62), randInt(rng, 19, 35), 0);
    p.clubId = -1;
    players[p.id] = p;
  }

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    saveName,
    seed,
    nextId,
    day: 0,
    startYear,
    season: 1,
    userClubId: -1,
    nations,
    leagues,
    clubs,
    players,
    managers,
    fixtures: [],
    offers: [],
    transferHistory: [],
    news: [],
    liveMatch: null,
    trainingIntensity: 'normal',
    phase: 'preseason',
  };

  // Initial lineups and squad numbers.
  for (const club of Object.values(clubs)) {
    assignSquadNumbers(state, club.id);
    club.lineup = pickBestLineup(clubPlayers(state, club.id), club.tactics.formation, false);
  }

  state.fixtures = generateAllFixtures(state, rng);
  state.nextId = nextId;
  return state;
}

function mkLeague(id: number, name: string, nationId: number, tier: number, reputation: number): League {
  return {
    id, name, nationId, tier, clubIds: [], table: [], reputation,
    promotionSpots: tier === 1 ? 0 : 2,
    relegationSpots: tier === 1 ? 2 : 0,
  };
}

export function emptyTableEntry(clubId: number) {
  return { clubId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function shortenName(name: string): string {
  const words = name.split(' ');
  if (words.length === 1) return name.slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

function budgetFor(reputation: number, rng: Rng): number {
  const base = Math.pow(reputation / 10, 3.2) * 32_000;
  return Math.round((base * (0.7 + rng() * 0.6)) / 50_000) * 50_000;
}

function wageBudgetFor(reputation: number): number {
  return Math.round(Math.pow(reputation / 10, 2.7) * 2600 / 1000) * 1000;
}

export function assignSquadNumbers(state: GameState, clubId: number): void {
  const squad = clubPlayers(state, clubId).sort((a, b) => overall(b) - overall(a));
  const taken = new Set<number>();
  for (const p of squad) {
    if (p.squadNumber > 0 && !taken.has(p.squadNumber)) {
      taken.add(p.squadNumber);
      continue;
    }
    let n = p.position === 'GK' ? 1 : p.position === 'DF' ? 2 : p.position === 'MF' ? 6 : 9;
    while (taken.has(n)) n++;
    p.squadNumber = n;
    taken.add(n);
  }
}

/** Double round-robin fixtures for every league for the current season. */
export function generateAllFixtures(state: GameState, rng: Rng): Fixture[] {
  const fixtures: Fixture[] = [];
  const seasonStartDay = (state.season - 1) * YEAR_LENGTH;
  for (const league of state.leagues) {
    const ids = shuffle(rng, [...league.clubIds]);
    const rounds = roundRobin(ids);
    rounds.forEach((pairs, roundIdx) => {
      const day = seasonStartDay + SEASON_FIRST_MATCH_DAY + roundIdx * ROUND_INTERVAL;
      for (const [home, away] of pairs) {
        fixtures.push({
          id: state.nextId++,
          leagueId: league.id,
          round: roundIdx + 1,
          day,
          homeClubId: home,
          awayClubId: away,
          played: false,
          homeGoals: 0,
          awayGoals: 0,
        });
      }
    });
  }
  return fixtures;
}

/** Circle-method double round robin: returns rounds of [home, away] pairs. */
function roundRobin(clubIds: number[]): [number, number][][] {
  const n = clubIds.length;
  const rounds: [number, number][][] = [];
  const arr = [...clubIds];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Alternate home/away by round for fairness.
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    // Rotate all but the first element.
    arr.splice(1, 0, arr.pop()!);
  }
  // Second half: mirror fixtures.
  const firstHalf = [...rounds];
  for (const round of firstHalf) {
    rounds.push(round.map(([h, a]) => [a, h] as [number, number]));
  }
  return rounds;
}
