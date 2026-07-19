import type { GameState, League, LeagueEntry, Player, ClubSeasonRecord } from './types';
import { type Rng, chance, randInt, pick, clamp, gaussianIn } from './rng';
import { generateAllFixtures, emptyTableEntry, assignSquadNumbers, emptyLedger } from './world';
import { generatePlayer, overall, wageDemand, fullName } from './player';
import { clubPlayers, refreshClubLineup, totalWages } from './squad';
import { contractEndDay } from './transfers';
import { addNews } from './news';
import { YEAR_LENGTH } from './calendar';
import { prizeFor, boardEnvelope, recordMoney } from './finance';

export function sortedTable(league: League): LeagueEntry[] {
  return [...league.table].sort((a, b) =>
    b.points - a.points ||
    (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
    b.goalsFor - a.goalsFor ||
    a.clubId - b.clubId,
  );
}

export function leaguePosition(league: League, clubId: number): number {
  return sortedTable(league).findIndex((e) => e.clubId === clubId) + 1;
}

export function seasonFixturesDone(state: GameState): boolean {
  return state.fixtures.every((f) => f.played);
}

/**
 * Full end-of-season rollover. Called on Jun 30 (season-year day 364):
 * records history, promotes/relegates, ages contracts, retires players,
 * spawns youth regens, resets tables and generates next season's fixtures.
 */
export function processSeasonEnd(state: GameState, rng: Rng): void {
  const finishedSeason = state.season;

  // 1. Record history + adjust reputation, decide promotion/relegation.
  const promoted = new Set<number>();
  const relegated = new Set<number>();
  // Final standings captured here for the prize payout in step 5 (by then the
  // tables have been reset and some clubs have swapped tiers).
  const finalStanding = new Map<number, { tier: number; position: number; size: number }>();
  for (const league of state.leagues) {
    const table = sortedTable(league);
    table.forEach((entry, idx) => {
      const club = state.clubs[entry.clubId];
      const pos = idx + 1;
      finalStanding.set(club.id, { tier: league.tier, position: pos, size: table.length });
      const isChampion = pos === 1;
      const isPromoted = league.tier === 2 && pos <= league.promotionSpots;
      const isRelegated = league.tier === 1 && pos > table.length - league.relegationSpots;
      if (isPromoted) promoted.add(club.id);
      if (isRelegated) relegated.add(club.id);
      const record: ClubSeasonRecord = {
        season: finishedSeason,
        leagueId: league.id,
        leagueName: league.name,
        finalPosition: pos,
        won: entry.won,
        drawn: entry.drawn,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        points: entry.points,
        promoted: isPromoted,
        relegated: isRelegated,
        champions: isChampion,
      };
      club.history.push(record);
      // Reputation drifts with results.
      const drift = isChampion ? 3 : isPromoted ? 2 : isRelegated ? -3 : pos <= 4 ? 1 : pos >= table.length - 3 ? -1 : 0;
      club.reputation = clamp(club.reputation + drift, 20, 95);
      if (isChampion) {
        addNews(state, 'league', `${club.name} are ${league.name} champions!`,
          `${club.name} finish top of the ${league.name} with ${entry.points} points.`,
          true);
      }
    });
  }

  // 2. Swap promoted/relegated clubs between tiers (per nation).
  for (const nation of state.nations) {
    const top = state.leagues.find((l) => l.nationId === nation.id && l.tier === 1)!;
    const lower = state.leagues.find((l) => l.nationId === nation.id && l.tier === 2)!;
    const up = lower.clubIds.filter((id) => promoted.has(id));
    const down = top.clubIds.filter((id) => relegated.has(id));
    top.clubIds = top.clubIds.filter((id) => !relegated.has(id)).concat(up);
    lower.clubIds = lower.clubIds.filter((id) => !promoted.has(id)).concat(down);
    for (const id of up) state.clubs[id].leagueId = top.id;
    for (const id of down) state.clubs[id].leagueId = lower.id;
    if (up.length) {
      const names = up.map((id) => state.clubs[id].name).join(' and ');
      addNews(state, 'league', `Promotion to the ${top.name}`, `${names} are promoted to the ${top.name}.`, true);
    }
  }

  const nextSeasonStart = finishedSeason * YEAR_LENGTH; // day index of next Jul 1

  // 3. Players: retirement, contract expiry / AI renewals.
  const retirees: Player[] = [];
  for (const p of Object.values(state.players)) {
    const ovr = overall(p);
    let retireP = p.age >= 38 ? 0.95 : p.age >= 35 ? 0.5 : p.age >= 33 ? (ovr < 55 ? 0.35 : 0.12) : 0;
    // Unsigned veterans hang up their boots rather than linger in the pool.
    if (p.clubId === -1 && p.age >= 31) retireP = Math.max(retireP, 0.7);
    if (chance(rng, retireP)) {
      retirees.push(p);
      continue;
    }
    if (p.contract.expiresDay <= nextSeasonStart) {
      const club = p.clubId >= 0 ? state.clubs[p.clubId] : null;
      if (club && club.id !== state.userClubId) {
        // AI renewal: keep good-enough, young-enough players; thin squads
        // renew nearly everyone.
        const isStarter = club.lineup.starters.includes(p.id);
        const squadSize = clubPlayers(state, club.id).length;
        const renewP = squadSize <= 18 ? 0.92 : isStarter ? 0.9 : p.age <= 30 ? 0.7 : 0.35;
        if (chance(rng, renewP)) {
          p.contract = {
            ...p.contract,
            wage: wageDemand(ovr, p.age, club.reputation),
            expiresDay: contractEndDay(state, randInt(rng, 2, 4)) + YEAR_LENGTH,
          };
          continue;
        }
      }
      if (p.clubId === state.userClubId) {
        addNews(state, 'squad', `${fullName(p)} leaves on a free`,
          `${fullName(p)}'s contract has expired and he leaves the club as a free agent.`, true);
      }
      p.clubId = -1;
      p.transferListed = false;
    }
  }

  // 4. Retire players and spawn youth regens to keep the world populated.
  for (const p of retirees) {
    if (p.clubId === state.userClubId) {
      addNews(state, 'squad', `${fullName(p)} retires`,
        `${fullName(p)} has announced his retirement from football at age ${p.age}.`, true);
    }
    const formerClubId = p.clubId;
    delete state.players[p.id];
    // Regen: a fresh youth prospect appears at a club in the same nation.
    const clubPool = Object.values(state.clubs).filter((c) => c.nationId === p.nationId);
    const club = formerClubId >= 0 && chance(rng, 0.5) ? state.clubs[formerClubId] : pick(rng, clubPool);
    const quality = Math.round(gaussianIn(rng, club.reputation * 0.72, 7, 30, 76));
    const youth = generatePlayer(rng, state.nextId++, club.nationId, p.position, quality, randInt(rng, 17, 19),
      contractEndDay(state, randInt(rng, 2, 3)) + YEAR_LENGTH);
    youth.clubId = club.id;
    youth.potential = clamp(youth.potential + randInt(rng, 0, 10), overall(youth), 96);
    youth.contract.wage = wageDemand(overall(youth), youth.age, club.reputation);
    state.players[youth.id] = youth;
    if (club.id === state.userClubId) {
      addNews(state, 'squad', `Youth prospect joins: ${fullName(youth)}`,
        `${fullName(youth)} (${youth.position}, ${youth.age}) has come through the youth ranks and joins the first-team squad.`, true);
    }
  }

  // 5. Reset leagues, refresh club finances/squads, new fixtures.
  for (const league of state.leagues) {
    league.table = league.clubIds.map((id) => emptyTableEntry(id));
  }
  state.season += 1;
  for (const club of Object.values(state.clubs)) {
    const squad = clubPlayers(state, club.id);
    // New season, new season ledger / finance-history trend.
    club.ledger = emptyLedger();
    club.financeHistory = [];
    // Final-position prize is real income, recorded after the ledger reset so
    // it opens the new season's ledger. It hits the balance, then the board
    // sizes next season's envelope from that fresh balance.
    const standing = finalStanding.get(club.id);
    if (standing) {
      recordMoney(club, 'prize', prizeFor(standing.tier, standing.position, standing.size));
    }
    // The club's *new* league tier (post promotion/relegation) drives wage headroom.
    const newTier = state.leagues.find((l) => l.id === club.leagueId)!.tier;
    const envelope = boardEnvelope(club.balance, totalWages(squad), newTier);
    club.budget = envelope.budget;
    club.wageBudget = envelope.wageBudget;
    assignSquadNumbers(state, club.id);
    refreshClubLineup(state, club);
    // Reset season condition.
    for (const p of squad) {
      p.fitness = clamp(p.fitness + 20, 60, 100);
      p.sharpness = clamp(p.sharpness - 30, 20, 60);
      p.suspendedMatches = 0;
      p.form = [];
    }
  }

  // Offers don't carry over the rollover; cap histories.
  state.offers = [];
  if (state.transferHistory.length > 600) {
    state.transferHistory = state.transferHistory.slice(-600);
  }

  state.fixtures = generateAllFixtures(state, rng);
  state.phase = 'preseason';
  addNews(state, 'league', `Season ${state.season} begins`,
    `Pre-season is underway. The summer transfer window is open and the new campaign starts in mid-August.`, true);
}
