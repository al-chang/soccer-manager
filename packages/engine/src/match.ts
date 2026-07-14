import type {
  GameState, Fixture, LiveMatch, MatchSide, MatchPlayerState, Tactics, Mentality,
} from './types';
import { type Rng, createRng, chance, pick, weightedPick, clamp, randInt } from './rng';
import { FORMATIONS, FORMATION_BIAS, MENTALITY_BIAS, MENTALITIES } from './tactics';
import { effectiveRating, effectiveRatingAs, recordFormRating, currentSeasonStats, fullName } from './player';
import { pickBestLineup, clubPlayers } from './squad';
import { INJURY_NAMES } from './names';

const HOME_ADVANTAGE = 1.15;
const MAX_SUBS = 5;

// ---- Setup ----

export function createLiveMatch(state: GameState, fixture: Fixture, refreshAiLineups = true): LiveMatch {
  const home = buildSide(state, fixture.homeClubId, refreshAiLineups);
  const away = buildSide(state, fixture.awayClubId, refreshAiLineups);
  return {
    fixtureId: fixture.id,
    minute: 0,
    home,
    away,
    events: [{ minute: 0, type: 'kickoff', side: -1, text: 'Kick off!' }],
    finished: false,
    seed: (state.seed ^ (fixture.id * 2654435761)) >>> 0,
  };
}

function buildSide(state: GameState, clubId: number, refreshLineup: boolean): MatchSide {
  const club = state.clubs[clubId];
  const isUser = clubId === state.userClubId;
  if (refreshLineup && !isUser) {
    club.lineup = pickBestLineup(clubPlayers(state, clubId), club.tactics.formation);
  }
  const players: MatchPlayerState[] = [];
  club.lineup.starters.forEach((pid, slot) => {
    if (pid < 0) return; // empty slot — team plays short-handed
    players.push(mkMatchPlayer(pid, slot, true));
  });
  for (const pid of club.lineup.bench) {
    players.push(mkMatchPlayer(pid, -1, false));
  }
  return {
    clubId,
    tactics: { ...club.tactics },
    players,
    subsUsed: 0,
    goals: 0,
    shots: 0,
    onTarget: 0,
    possessionTicks: 0,
  };
}

function mkMatchPlayer(playerId: number, slot: number, onPitch: boolean): MatchPlayerState {
  return { playerId, rating: 6.3, goals: 0, assists: 0, yellow: false, sentOff: false, injured: false, fatigue: 0, onPitch, slot };
}

// ---- Strength model ----

interface SideStrength {
  attack: number;
  midfield: number;
  defense: number;
  gk: number;
}

function playerContribution(state: GameState, mp: MatchPlayerState, side: MatchSide): number {
  const p = state.players[mp.playerId];
  const slots = FORMATIONS[side.tactics.formation];
  const slotPos = mp.slot >= 0 && mp.slot < slots.length ? slots[mp.slot] : p.position;
  // Rate the player for the role he's actually filling. His attributes carry
  // most of the out-of-position cost (an off-role player has weak technicals for
  // the slot); a small unfamiliarity penalty covers the rest.
  let q = effectiveRatingAs(p, slotPos);
  if (slotPos !== p.position) q *= 0.92; // unfamiliar with the role
  // In-match fatigue saps quality late on.
  q *= 1 - clamp(mp.fatigue, 0, 60) / 220;
  return q;
}

function computeStrength(state: GameState, side: MatchSide): SideStrength {
  const slots = FORMATIONS[side.tactics.formation];
  let attack = 0, midfield = 0, defense = 0, gk = 30;
  let nA = 0, nM = 0, nD = 0;
  for (const mp of side.players) {
    if (!mp.onPitch || mp.sentOff) continue;
    const q = playerContribution(state, mp, side);
    const pos = mp.slot >= 0 && mp.slot < slots.length ? slots[mp.slot] : state.players[mp.playerId].position;
    if (pos === 'GK') {
      gk = q;
    } else if (pos === 'DF') {
      defense += q; nD++;
      midfield += q * 0.25;
    } else if (pos === 'MF') {
      midfield += q; nM++;
      attack += q * 0.4; defense += q * 0.4;
    } else {
      attack += q; nA++;
      midfield += q * 0.25;
    }
  }
  attack = nA + nM ? attack / Math.max(1, nA + nM * 0.4) : 20;
  midfield = midfield / Math.max(1, nM + nD * 0.25 + nA * 0.25);
  defense = defense / Math.max(1, nD + nM * 0.4);

  const fb = FORMATION_BIAS[side.tactics.formation];
  const mb = MENTALITY_BIAS[side.tactics.mentality];
  attack *= fb.attack * mb.attack;
  defense *= fb.defense * mb.defense;
  if (side.tactics.pressing === 'high') { midfield *= 1.07; defense *= 0.97; }
  if (side.tactics.pressing === 'low') { midfield *= 0.95; defense *= 1.04; }

  // Playing with 10 men hurts everywhere.
  const onPitch = side.players.filter((m) => m.onPitch && !m.sentOff).length;
  if (onPitch < 11) {
    const penalty = 1 - (11 - onPitch) * 0.09;
    attack *= penalty; midfield *= penalty; defense *= penalty * 1.02;
  }
  return { attack, midfield, defense, gk };
}

// ---- Minute simulation ----

export function simulateMinute(state: GameState, match: LiveMatch): void {
  if (match.finished) return;
  match.minute++;
  const minute = match.minute;
  const rng = createRng((match.seed + minute * 7919) >>> 0);

  if (minute === 46) {
    match.events.push({ minute: 45, type: 'halftime', side: -1, text: 'Half time.' });
    // Light fatigue recovery at the break.
    for (const side of [match.home, match.away]) {
      for (const mp of side.players) mp.fatigue = Math.max(0, mp.fatigue - 6);
    }
  }

  const hs = computeStrength(state, match.home);
  const as = computeStrength(state, match.away);

  // Possession share from midfield battle.
  const homeMid = hs.midfield * HOME_ADVANTAGE + MENTALITY_BIAS[match.home.tactics.mentality].possession;
  const awayMid = as.midfield + MENTALITY_BIAS[match.away.tactics.mentality].possession;
  const homePoss = homeMid / Math.max(1, homeMid + awayMid);
  if (rng() < homePoss) match.home.possessionTicks++; else match.away.possessionTicks++;

  // Tempo raises event frequency for both sides.
  const tempoBoost = (t: Tactics) => (t.tempo === 'fast' ? 1.12 : t.tempo === 'slow' ? 0.9 : 1);
  const eventP = 0.52 * ((tempoBoost(match.home.tactics) + tempoBoost(match.away.tactics)) / 2);

  if (chance(rng, eventP)) {
    // Whose attack? Weighted by possession and attacking strength.
    const homeWeight = homePoss * hs.attack * HOME_ADVANTAGE;
    const awayWeight = (1 - homePoss) * as.attack;
    const isHome = rng() < homeWeight / (homeWeight + awayWeight);
    resolveAttack(state, match, rng, isHome ? match.home : match.away, isHome ? match.away : match.home,
      isHome ? hs : as, isHome ? as : hs, isHome ? 0 : 1);
  }

  // Discipline: fouls/cards, slightly more likely for high pressing sides.
  for (const [side, sideIdx] of [[match.home, 0], [match.away, 1]] as const) {
    const cardP = 0.016 * (side.tactics.pressing === 'high' ? 1.4 : side.tactics.pressing === 'low' ? 0.8 : 1);
    if (chance(rng, cardP)) bookPlayer(state, match, rng, side, sideIdx);
  }

  // Injuries.
  if (chance(rng, 0.0035)) {
    const side = chance(rng, 0.5) ? match.home : match.away;
    const sideIdx = side === match.home ? 0 : 1;
    injurePlayer(state, match, rng, side, sideIdx);
  }

  // Fatigue accumulation.
  for (const side of [match.home, match.away]) {
    const pressDrain = side.tactics.pressing === 'high' ? 1.25 : side.tactics.pressing === 'low' ? 0.85 : 1;
    for (const mp of side.players) {
      if (!mp.onPitch || mp.sentOff) continue;
      const p = state.players[mp.playerId];
      mp.fatigue += pressDrain * (1.1 - p.attributes.stamina / 250) * (0.8 + (100 - p.fitness) / 180);
    }
  }

  // AI managers react (user side is controlled from the UI).
  aiMatchManagement(state, match, rng);

  const endMinute = 90 + (match.events.some((e) => e.type === 'goal' && e.minute > 80) ? 4 : 3);
  if (minute >= endMinute) {
    match.finished = true;
    match.events.push({ minute, type: 'fulltime', side: -1, text: 'Full time.' });
  }
}

function pitchPlayers(side: MatchSide): MatchPlayerState[] {
  return side.players.filter((m) => m.onPitch && !m.sentOff);
}

function resolveAttack(
  state: GameState, match: LiveMatch, rng: Rng,
  att: MatchSide, def: MatchSide, attStr: SideStrength, defStr: SideStrength, sideIdx: 0 | 1,
): void {
  const minute = match.minute;
  const attackers = pitchPlayers(att).filter((mp) => mp.slot !== 0);
  if (attackers.length === 0) return;
  const slots = FORMATIONS[att.tactics.formation];
  const posWeight = (mp: MatchPlayerState) => {
    const pos = mp.slot >= 0 ? slots[mp.slot] : state.players[mp.playerId].position;
    return pos === 'FW' ? 5 : pos === 'MF' ? 2.4 : pos === 'DF' ? 0.5 : 0.05;
  };
  const shooter = weightedPick(rng, attackers, posWeight);
  const shooterP = state.players[shooter.playerId];

  const shotP = clamp(0.5 + (attStr.attack - defStr.defense) / 160, 0.16, 0.7);
  if (!chance(rng, shotP)) {
    match.events.push({
      minute, type: 'chance', side: sideIdx,
      text: `${state.clubs[att.clubId].shortName} build an attack but ${fullName(shooterP)} is crowded out.`,
      playerId: shooter.playerId,
    });
    return;
  }

  att.shots++;
  const quality = shooterP.attributes.shooting * 0.6 + shooterP.attributes.composure * 0.4;
  // On-target chance rewards shooter quality but is dragged down by defensive pressure.
  const onTargetP = clamp(0.18 + quality / 260 + (attStr.attack - defStr.defense) / 300, 0.12, 0.46);
  if (!chance(rng, onTargetP)) {
    shooter.rating = clamp(shooter.rating - 0.05, 1, 10);
    match.events.push({
      minute, type: 'miss', side: sideIdx,
      text: `${fullName(shooterP)} shoots wide!`, playerId: shooter.playerId,
    });
    return;
  }

  att.onTarget++;
  const goalP = clamp(0.135 + (quality - defStr.gk) / 95, 0.03, 0.46);
  if (chance(rng, goalP)) {
    att.goals++;
    shooter.goals++;
    shooter.rating = clamp(shooter.rating + 1.0, 1, 10);
    // Assist: a teammate (usually MF/FW) gets credit most of the time.
    let assistText = '';
    if (chance(rng, 0.72)) {
      const others = pitchPlayers(att).filter((m) => m !== shooter && m.slot !== 0);
      if (others.length) {
        const assister = weightedPick(rng, others, posWeight);
        assister.assists++;
        assister.rating = clamp(assister.rating + 0.6, 1, 10);
        assistText = ` (assist: ${fullName(state.players[assister.playerId])})`;
      }
    }
    match.events.push({
      minute, type: 'goal', side: sideIdx,
      text: `GOAL! ${fullName(shooterP)} scores for ${state.clubs[att.clubId].name}!${assistText}`,
      playerId: shooter.playerId,
    });
    // Conceding side's defenders/GK take a small ratings hit.
    for (const mp of pitchPlayers(def)) {
      const pos = mp.slot >= 0 ? FORMATIONS[def.tactics.formation][mp.slot] : state.players[mp.playerId].position;
      if (pos === 'GK' || pos === 'DF') mp.rating = clamp(mp.rating - 0.25, 1, 10);
    }
  } else {
    const gk = pitchPlayers(def).find((m) => m.slot === 0);
    if (gk) gk.rating = clamp(gk.rating + 0.25, 1, 10);
    shooter.rating = clamp(shooter.rating + 0.1, 1, 10);
    match.events.push({
      minute, type: 'save', side: sideIdx,
      text: `${fullName(shooterP)} forces a save from ${gk ? fullName(state.players[gk.playerId]) : 'the keeper'}!`,
      playerId: shooter.playerId,
    });
  }
}

function bookPlayer(state: GameState, match: LiveMatch, rng: Rng, side: MatchSide, sideIdx: 0 | 1): void {
  const candidates = pitchPlayers(side);
  if (!candidates.length) return;
  const mp = weightedPick(rng, candidates, (m) => {
    const p = state.players[m.playerId];
    return p.position === 'DF' ? 3 : p.position === 'MF' ? 2 : 1;
  });
  const p = state.players[mp.playerId];
  if (chance(rng, 0.04)) {
    mp.sentOff = true;
    mp.onPitch = false;
    mp.rating = clamp(mp.rating - 1.5, 1, 10);
    match.events.push({ minute: match.minute, type: 'red', side: sideIdx, text: `RED CARD! ${fullName(p)} is sent off!`, playerId: p.id });
  } else if (mp.yellow) {
    mp.sentOff = true;
    mp.onPitch = false;
    mp.rating = clamp(mp.rating - 1.2, 1, 10);
    match.events.push({ minute: match.minute, type: 'red', side: sideIdx, text: `Second yellow — ${fullName(p)} is off!`, playerId: p.id });
  } else {
    mp.yellow = true;
    mp.rating = clamp(mp.rating - 0.2, 1, 10);
    match.events.push({ minute: match.minute, type: 'yellow', side: sideIdx, text: `${fullName(p)} is booked.`, playerId: p.id });
  }
}

function injurePlayer(state: GameState, match: LiveMatch, rng: Rng, side: MatchSide, sideIdx: 0 | 1): void {
  const candidates = pitchPlayers(side);
  if (!candidates.length) return;
  const mp = weightedPick(rng, candidates, (m) => 1 + m.fatigue / 30);
  const p = state.players[mp.playerId];
  mp.injured = true;
  match.events.push({ minute: match.minute, type: 'injury', side: sideIdx, text: `${fullName(p)} is down injured and can't continue.`, playerId: p.id });
  // Forced sub (AI handles its own; user side auto-subs like-for-like if subs remain).
  makeSub(state, match, side, sideIdx, mp, true);
  if (!mp.onPitch) return; // sub made; injured player removed in makeSub
  mp.onPitch = false; // no subs left — play on with 10
}

/** Substitute `out` for the best available bench player (like-for-like first). */
export function makeSub(
  state: GameState, match: LiveMatch, side: MatchSide, sideIdx: 0 | 1,
  out: MatchPlayerState, forced: boolean,
): boolean {
  if (side.subsUsed >= MAX_SUBS) return false;
  const slots = FORMATIONS[side.tactics.formation];
  const outPos = out.slot >= 0 ? slots[out.slot] : state.players[out.playerId].position;
  const bench = side.players.filter((m) => !m.onPitch && !m.sentOff && m.slot === -1 && !m.injured && m.fatigue === 0);
  if (!bench.length) return false;
  const likeForLike = bench.filter((m) => state.players[m.playerId].position === outPos);
  const pool = likeForLike.length ? likeForLike : bench.filter((m) => state.players[m.playerId].position !== 'GK' || outPos === 'GK');
  if (!pool.length) return false;
  const sub = pool.sort((a, b) => effectiveRating(state.players[b.playerId]) - effectiveRating(state.players[a.playerId]))[0];
  sub.onPitch = true;
  sub.slot = out.slot;
  out.onPitch = false;
  out.slot = -1;
  side.subsUsed++;
  match.events.push({
    minute: match.minute, type: 'sub', side: sideIdx,
    text: `${state.clubs[side.clubId].shortName} sub${forced ? ' (forced)' : ''}: ${fullName(state.players[sub.playerId])} on for ${fullName(state.players[out.playerId])}.`,
  });
  return true;
}

/** Apply a user-driven substitution by player ids. */
export function userSub(state: GameState, match: LiveMatch, outId: number, inId: number): boolean {
  const side = match.home.clubId === state.userClubId ? match.home : match.away;
  const sideIdx: 0 | 1 = side === match.home ? 0 : 1;
  if (side.subsUsed >= MAX_SUBS) return false;
  const out = side.players.find((m) => m.playerId === outId && m.onPitch);
  const sub = side.players.find((m) => m.playerId === inId && !m.onPitch && !m.sentOff && !m.injured);
  if (!out || !sub) return false;
  sub.onPitch = true;
  sub.slot = out.slot;
  out.onPitch = false;
  out.slot = -1;
  side.subsUsed++;
  match.events.push({
    minute: match.minute, type: 'sub', side: sideIdx,
    text: `${state.clubs[side.clubId].shortName} sub: ${fullName(state.players[inId])} on for ${fullName(state.players[outId])}.`,
  });
  return true;
}

// ---- AI in-match management ----

function aiMatchManagement(state: GameState, match: LiveMatch, rng: Rng): void {
  for (const [side, other, sideIdx] of [[match.home, match.away, 0], [match.away, match.home, 1]] as const) {
    if (side.clubId === state.userClubId) continue;
    const club = state.clubs[side.clubId];
    const manager = state.managers[club.managerId];
    if (!manager) continue;
    const minute = match.minute;
    const diff = side.goals - other.goals;
    const aggression = manager.temper === 'aggressive' || manager.temper === 'impulsive' ? 1.5 : 1;

    // Tactical shifts when chasing/protecting a result.
    if (minute >= 55 && minute % 5 === 0) {
      if (diff < 0 && chance(rng, 0.35 * aggression)) {
        const next = stepMentality(side.tactics.mentality, +1);
        if (next !== side.tactics.mentality) {
          side.tactics.mentality = next;
          match.events.push({ minute, type: 'tactic', side: sideIdx, text: `${club.shortName} push forward (${next.replace('-', ' ')}).` });
        }
      } else if (diff > 0 && minute >= 70 && chance(rng, manager.style === 'defensive' ? 0.5 : 0.25)) {
        const next = stepMentality(side.tactics.mentality, -1);
        if (next !== side.tactics.mentality) {
          side.tactics.mentality = next;
          match.events.push({ minute, type: 'tactic', side: sideIdx, text: `${club.shortName} drop deeper to protect the lead.` });
        }
      }
    }

    // Subs for tired players after the hour mark.
    if (minute >= 60 && side.subsUsed < MAX_SUBS && minute % 4 === 0) {
      const tired = pitchPlayers(side)
        .filter((m) => m.slot !== 0 && m.fatigue > 42)
        .sort((a, b) => b.fatigue - a.fatigue)[0];
      if (tired && chance(rng, 0.5)) makeSub(state, match, side, sideIdx, tired, false);
    }
  }
}

export function stepMentality(m: Mentality, dir: 1 | -1): Mentality {
  const idx = MENTALITIES.indexOf(m);
  return MENTALITIES[clamp(idx + dir, 0, MENTALITIES.length - 1)];
}

// ---- Finishing ----

export function finishMatch(state: GameState, match: LiveMatch): void {
  const fixture = state.fixtures.find((f) => f.id === match.fixtureId)!;
  // Players suspended coming into this match serve a game of their ban
  // (done before new red cards from this match are processed below).
  for (const p of Object.values(state.players)) {
    if (p.suspendedMatches > 0 && (p.clubId === fixture.homeClubId || p.clubId === fixture.awayClubId)) {
      p.suspendedMatches -= 1;
    }
  }
  fixture.played = true;
  fixture.homeGoals = match.home.goals;
  fixture.awayGoals = match.away.goals;

  // League table.
  const league = state.leagues.find((l) => l.id === fixture.leagueId)!;
  const homeEntry = league.table.find((e) => e.clubId === fixture.homeClubId)!;
  const awayEntry = league.table.find((e) => e.clubId === fixture.awayClubId)!;
  applyResult(homeEntry, match.home.goals, match.away.goals);
  applyResult(awayEntry, match.away.goals, match.home.goals);

  // Man of the match: highest rating across both sides.
  const all = [...match.home.players, ...match.away.players].filter((m) => m.fatigue > 0 || m.onPitch || m.sentOff);
  const motm = all.length ? all.reduce((best, m) => (m.rating > best.rating ? m : best), all[0]) : null;

  const rng = createRng((match.seed + 999983) >>> 0);
  for (const [side, other] of [[match.home, match.away], [match.away, match.home]] as const) {
    const won = side.goals > other.goals;
    const drew = side.goals === other.goals;
    for (const mp of side.players) {
      const played = mp.fatigue > 0 || mp.onPitch || mp.sentOff;
      const p = state.players[mp.playerId];
      if (!played) continue;
      // Post-match condition.
      p.fitness = clamp(p.fitness - mp.fatigue * 0.55 - 8, 5, 100);
      p.sharpness = clamp(p.sharpness + 14, 0, 100);
      p.morale = clamp(p.morale + (won ? 6 : drew ? 1 : -5) + (mp.rating - 6.5) * 1.5, 0, 100);
      p.wellbeing = clamp(p.wellbeing + (won ? 1.5 : drew ? 0 : -1.5), 0, 100);
      if (mp.injured) {
        p.injuryDays = randInt(rng, 4, 35);
        p.injuryName = pick(rng, INJURY_NAMES);
      }
      if (mp.sentOff) p.suspendedMatches = 2;
      // Season stats.
      const s = currentSeasonStats(p, state);
      s.apps++;
      s.goals += mp.goals;
      s.assists += mp.assists;
      if (mp.yellow) s.yellows++;
      if (mp.sentOff) s.reds++;
      s.ratingSum += mp.rating;
      if (motm && mp === motm) s.motm++;
      recordFormRating(p, mp.rating);
    }
    // Unused players on the squad lose a bit of sharpness/morale.
    for (const mp of side.players) {
      const played = mp.fatigue > 0 || mp.onPitch || mp.sentOff;
      if (played) continue;
      const p = state.players[mp.playerId];
      p.morale = clamp(p.morale - 0.5, 0, 100);
    }
  }
}

function applyResult(entry: { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; points: number }, gf: number, ga: number) {
  entry.played++;
  entry.goalsFor += gf;
  entry.goalsAgainst += ga;
  if (gf > ga) { entry.won++; entry.points += 3; }
  else if (gf === ga) { entry.drawn++; entry.points += 1; }
  else entry.lost++;
}

/** Run an entire match instantly (for AI-vs-AI fixtures). */
export function simulateFullMatch(state: GameState, fixture: Fixture): LiveMatch {
  const match = createLiveMatch(state, fixture);
  while (!match.finished) simulateMinute(state, match);
  finishMatch(state, match);
  return match;
}
