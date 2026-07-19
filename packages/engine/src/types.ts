// Core domain types for the simulation. The engine is plain TypeScript with no
// React dependencies; the entire GameState is JSON-serializable for saves.

export type Position =
  | 'GK'
  | 'LB' | 'CB' | 'RB'
  | 'DM' | 'CM' | 'AM'
  | 'LM' | 'RM'
  | 'LW' | 'RW'
  | 'ST';

export type PositionGroup = 'GK' | 'DF' | 'MF' | 'FW';

export interface Attributes {
  pace: number;
  strength: number;
  stamina: number;
  passing: number;
  shooting: number;
  dribbling: number;
  defending: number;
  goalkeeping: number;
  vision: number;
  composure: number;
  workRate: number;
}

export type AttributeKey = keyof Attributes;

export interface Contract {
  wage: number; // weekly wage
  /** Day index the contract expires (end of a season). */
  expiresDay: number;
  /** Fee at or above which any bid auto-accepts the fee stage; null = no clause. */
  releaseClause: number | null;
  /** Paid to the player per appearance, 0 if none. */
  appearanceFee: number;
  /** Paid to the player per goal, 0 if none. */
  goalBonus: number;
}

export interface SeasonStats {
  season: number;
  clubId: number;
  apps: number;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
  ratingSum: number; // avg rating = ratingSum / apps
  motm: number;
}

export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  nationId: number;
  age: number;
  /** Birthday as day-of-year (0-364) for aging on the right day. */
  birthDayOfYear: number;
  position: Position;
  attributes: Attributes;
  /** Hidden ceiling on overall ability, 1-99. */
  potential: number;
  clubId: number; // -1 = free agent
  contract: Contract;
  /** Sell-on obligation owed to a former club from the deal that brought him in;
   * that club takes `pct`% of the next fee this player is sold for. Replaced or
   * cleared on each subsequent transfer. */
  sellOn: { clubId: number; pct: number } | null;
  squadNumber: number;
  // Condition tracking
  fitness: number; // 0-100, physical freshness
  sharpness: number; // 0-100, match readiness
  morale: number; // 0-100, short-term mood
  wellbeing: number; // 0-100, longer-term mental health
  injuryDays: number; // 0 = healthy
  injuryName: string | null;
  suspendedMatches: number;
  form: number[]; // last match ratings (most recent last, max 5)
  transferListed: boolean;
  stats: SeasonStats[];
  /** Set when the player decides to retire at season end. */
  retiring: boolean;
  /** Live contract-negotiation state; null when not in talks. */
  contractTalk: ContractTalk | null;
  /** Earliest day renewal talks may reopen after he walked away; absent = open now. */
  renewalCooldownDay?: number;
}

export type ManagerStyle = 'attacking' | 'defensive' | 'balanced' | 'pressing' | 'counter';
export type ManagerTemper = 'aggressive' | 'patient' | 'shrewd' | 'impulsive' | 'loyal';

export interface AiManager {
  id: number;
  name: string;
  nationId: number;
  style: ManagerStyle; // preferred play style
  temper: ManagerTemper; // negotiation / squad-building attitude
  /** 0-1: how willing they are to buy/sell. */
  activity: number;
  /** 0-1: preference for signing young players. */
  youthBias: number;
}

export type FormationId = '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-5-1';

export type Mentality = 'very-defensive' | 'defensive' | 'balanced' | 'attacking' | 'very-attacking';
export type PressingLevel = 'low' | 'medium' | 'high';
export type TempoLevel = 'slow' | 'normal' | 'fast';

export interface Tactics {
  formation: FormationId;
  mentality: Mentality;
  pressing: PressingLevel;
  tempo: TempoLevel;
}

export interface Lineup {
  /** Player ids in formation slot order (index 0 = GK). */
  starters: number[];
  bench: number[];
}

export interface ClubSeasonRecord {
  season: number;
  leagueId: number;
  leagueName: string;
  finalPosition: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  promoted: boolean;
  relegated: boolean;
  champions: boolean;
}

/**
 * Per-category season money movements. Amounts are signed: income categories
 * ('gate', 'tv', 'prize', 'commercial', 'playerSales') are recorded positive,
 * expense categories ('wages', 'transferFees', 'operations', 'bonuses') are
 * recorded negative. This makes `balance_end - balance_start = sum(ledger
 * values)` for a season — the ledger always reconciles against the balance
 * delta. `bonuses` covers signing bonuses and per-match appearance/goal
 * bonuses paid to players.
 */
export type LedgerCategory =
  | 'gate' | 'tv' | 'prize' | 'commercial' | 'playerSales'   // income (+)
  | 'wages' | 'transferFees' | 'operations' | 'bonuses';      // expenses (−)

export type SeasonLedger = Record<LedgerCategory, number>;

/**
 * A monthly cash-flow checkpoint for the Finances screen's trend view.
 * `income`/`expense` are THAT month's sums only (not cumulative) — expense
 * keeps the ledger's negative sign convention, so `income + expense` is the
 * month's net. `balance` is the club's balance as of this snapshot. Entries
 * are season-scoped: reset to `[]` at rollover alongside `ledger`.
 */
export interface FinanceSnapshot {
  day: number;
  balance: number;
  income: number;
  expense: number;
}

export interface Club {
  id: number;
  name: string;
  shortName: string;
  nationId: number;
  leagueId: number;
  /** 1-100 baseline prestige; drives finances, player attraction. */
  reputation: number;
  /** The board's transfer allocation for the season (an envelope, not the bank balance). */
  budget: number; // transfer budget
  /** The board's weekly wage allocation (a cap, not the bank balance). */
  wageBudget: number; // weekly wage cap
  /** The club's actual bank balance. `budget`/`wageBudget` are board allocations drawn from it, not the balance itself. */
  balance: number;
  /** Current-season money movements by category. Reset at rollover. */
  ledger: SeasonLedger;
  /** Monthly balance/income/expense checkpoints for the current season. Reset at rollover. */
  financeHistory: FinanceSnapshot[];
  managerId: number; // AI manager id; ignored for the user club
  tactics: Tactics;
  lineup: Lineup;
  colors: [string, string];
  history: ClubSeasonRecord[];
}

export interface LeagueEntry {
  clubId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface League {
  id: number;
  name: string;
  nationId: number;
  tier: number; // 1 = top flight
  clubIds: number[];
  table: LeagueEntry[];
  /** Reputation baseline for clubs in this league. */
  reputation: number;
  promotionSpots: number;
  relegationSpots: number;
}

export interface Nation {
  id: number;
  name: string;
  adjective: string;
}

// ---- Matches & fixtures ----

export interface Fixture {
  id: number;
  leagueId: number;
  round: number;
  day: number; // absolute day index
  homeClubId: number;
  awayClubId: number;
  played: boolean;
  homeGoals: number;
  awayGoals: number;
}

export type MatchEventType =
  | 'kickoff' | 'goal' | 'miss' | 'save' | 'yellow' | 'red'
  | 'injury' | 'sub' | 'chance' | 'halftime' | 'fulltime' | 'tactic' | 'commentary';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  /** 0 = home, 1 = away, -1 = neutral. */
  side: 0 | 1 | -1;
  text: string;
  playerId?: number;
}

export interface MatchPlayerState {
  playerId: number;
  rating: number;
  goals: number;
  assists: number;
  yellow: boolean;
  sentOff: boolean;
  injured: boolean;
  fatigue: number; // accumulates during the match
  onPitch: boolean;
  slot: number; // formation slot index, -1 if bench
}

export interface MatchSide {
  clubId: number;
  tactics: Tactics;
  players: MatchPlayerState[]; // starters + bench
  subsUsed: number;
  goals: number;
  shots: number;
  onTarget: number;
  possessionTicks: number;
}

export interface LiveMatch {
  fixtureId: number;
  minute: number;
  home: MatchSide;
  away: MatchSide;
  events: MatchEvent[];
  finished: boolean;
  /** RNG state seed for resuming deterministic sim. */
  seed: number;
}

// ---- Transfers ----

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'withdrawn' | 'completed';

/** The fee stage of a deal: what the buyer offers the selling club. */
export interface DealTerms {
  fee: number;
  sellOnPct: number; // 0 = none; the seller takes this % of the player's next fee
  swapPlayerId: number | null; // a player from the buying club included in the deal
}

/** The contract stage of a deal (transfer or renewal): what the player is offered. */
export interface ContractTerms {
  wage: number;
  years: number; // 1–5
  signingBonus: number; // one-time, paid on completion
  appearanceFee: number;
  goalBonus: number;
  releaseClause: number | null;
}

/**
 * Live contract-negotiation state for a player (transfer or renewal); null when
 * he isn't negotiating. `counter` is the player's latest counter-offer for the
 * UI to present; `patience` is the rounds he'll still entertain before walking.
 * Cleared to null on accept/reject; start a fresh negotiation by clearing it.
 */
export interface ContractTalk {
  patience: number;
  counter: ContractTerms | null;
}

export interface TransferOffer {
  id: number;
  playerId: number;
  fromClubId: number; // buying club
  toClubId: number; // selling club
  terms: DealTerms;
  status: OfferStatus;
  /** The selling side's counter, when it responds with one. */
  counterTerms: DealTerms | null;
  /** Negotiation rounds elapsed (instant back-and-forth). */
  rounds: number;
  /** Rounds the selling side will still entertain before walking away. */
  patience: number;
  /** Day the offer was made / last updated. */
  day: number;
  /** True when the user must respond (incoming) or has acted (outgoing). */
  userInvolved: boolean;
  /** After a fee is agreed for a user purchase: wage demanded by the player. */
  wageDemand: number | null;
  stage: 'fee' | 'contract' | 'done';
}

export interface TransferRecord {
  season: number;
  day: number;
  playerId: number;
  playerName: string;
  fromClubId: number; // selling club (player's previous club) — opposite convention from TransferOffer
  toClubId: number; // buying club (player's new club) — opposite convention from TransferOffer
  fee: number;
}

// ---- News ----

export type NewsCategory = 'transfer' | 'match' | 'squad' | 'league' | 'board' | 'window';

export interface NewsItem {
  id: number;
  day: number;
  category: NewsCategory;
  title: string;
  body: string;
  read: boolean;
}

// ---- Game state ----

export interface GameState {
  schemaVersion: number;
  saveName: string;
  seed: number;
  /** Monotonic counter for entity ids. */
  nextId: number;
  day: number; // absolute day index, day 0 = Jul 1 of startYear
  startYear: number;
  season: number; // 1-based season counter
  userClubId: number;
  nations: Nation[];
  leagues: League[];
  clubs: Record<number, Club>;
  players: Record<number, Player>;
  managers: Record<number, AiManager>;
  fixtures: Fixture[];
  offers: TransferOffer[];
  transferHistory: TransferRecord[];
  news: NewsItem[];
  liveMatch: LiveMatch | null;
  trainingIntensity: 'light' | 'normal' | 'heavy';
  /** Set when the season is over and awaiting rollover. */
  phase: 'preseason' | 'season' | 'postseason';
}

export const SCHEMA_VERSION = 6;
