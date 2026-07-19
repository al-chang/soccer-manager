import { useState, type ReactNode } from 'react';
import type { Player, GameState } from '@soccer-manager/engine/types';
import { overall, fullName } from '@soccer-manager/engine/player';
import { marketValue } from '@soccer-manager/engine/player';
import { formatMoney } from '@soccer-manager/engine/transfers';
import { YEAR_LENGTH } from '@soccer-manager/engine/calendar';
import { useGameStore } from '../store/gameStore';

// Pure presentational primitives live in the design system. Re-exported here so
// existing `from './common'` import sites keep working unchanged.
export { ovrClass, OvrBadge, PosBadge, ConditionBar, FormDots } from '@soccer-manager/design-system';

export { formatMoney };

/**
 * `formatMoney`, but safe for negative amounts — `formatMoney` only abbreviates
 * magnitudes cleanly for values >= 0 (a negative balance would render as an
 * un-abbreviated `£-1234567`). Formats the magnitude and re-applies the sign.
 */
export function formatMoneySigned(n: number): string {
  return n < 0 ? `-${formatMoney(-n)}` : formatMoney(n);
}

/** "2.5m" / "800k" / "£1,200,000" → pounds; null when the text isn't a money amount. */
export function parseMoney(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[£,\s]/g, '');
  const m = /^(\d+(?:\.\d+)?)(m|k)?$/.exec(t);
  if (!m) return null;
  const mult = m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1;
  return Math.round(Number(m[1]) * mult);
}

/** The compact editable form of an amount, matching what `parseMoney` accepts. */
function editableMoney(n: number): string {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}m`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}k`;
  return String(n);
}

/**
 * A money amount you can type: shows the formatted value (£2.5M) at rest and a
 * compact editable form (2.5m) while focused. Accepts "800k" / "2.5m" / plain
 * pounds; commits on Enter or blur, Escape reverts.
 */
export function MoneyInput({ value, onCommit, ariaLabel }: {
  value: number;
  onCommit: (v: number) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    // The seed string is a rounded form of `value` — committing it untouched
    // would silently change the amount (1,234,567 -> "1.23m" -> 1,230,000).
    const v = text === editableMoney(value) ? null : parseMoney(text);
    if (v !== null && v !== value) onCommit(v);
    setText(null);
  };
  return (
    <input
      className="money-input"
      type="text"
      inputMode="decimal"
      value={text ?? formatMoney(value)}
      onFocus={(e) => { setText(editableMoney(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { commit(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') setText(null);
      }}
      aria-label={ariaLabel}
    />
  );
}

export function PlayerLink({ player, children }: { player: Player; children?: ReactNode }) {
  const viewPlayer = useGameStore((s) => s.viewPlayer);
  return (
    <button className="link" onClick={() => viewPlayer(player.id)}>
      {children ?? fullName(player)}
    </button>
  );
}

export function ClubLink({ game, clubId }: { game: GameState; clubId: number }) {
  const viewClub = useGameStore((s) => s.viewClub);
  if (clubId < 0) return <span className="muted">Free agent</span>;
  const club = game.clubs[clubId];
  return (
    <button className="link" onClick={() => viewClub(clubId)}>
      <span className="club-dot" style={{ background: club.colors[0] }} /> {club.name}
    </button>
  );
}

export function playerValue(game: GameState, p: Player): string {
  return formatMoney(marketValue(p, game.day));
}

export function statusFlags(p: Player): string {
  const flags: string[] = [];
  if (p.injuryDays > 0) flags.push(`🤕 ${p.injuryName ?? 'Injured'} (${p.injuryDays}d)`);
  if (p.suspendedMatches > 0) flags.push(`🟥 Suspended (${p.suspendedMatches})`);
  if (p.transferListed) flags.push('📋 Listed');
  return flags.join(' ');
}

/** A contracted player within ~a season of expiry — flag him to renew before he
 * can leave on a free. */
export function contractExpiringSoon(p: Player, day: number): boolean {
  return p.clubId >= 0 && p.contract.expiresDay - day <= YEAR_LENGTH;
}

export function avgRating(p: Player, season: number): string {
  const s = p.stats.filter((st) => st.season === season);
  const apps = s.reduce((a, b) => a + b.apps, 0);
  if (!apps) return '—';
  return (s.reduce((a, b) => a + b.ratingSum, 0) / apps).toFixed(2);
}

export function seasonLine(p: Player, season: number): { apps: number; goals: number; assists: number } {
  const s = p.stats.filter((st) => st.season === season);
  return {
    apps: s.reduce((a, b) => a + b.apps, 0),
    goals: s.reduce((a, b) => a + b.goals, 0),
    assists: s.reduce((a, b) => a + b.assists, 0),
  };
}

export function sortByOvr(players: Player[]): Player[] {
  return [...players].sort((a, b) => overall(b) - overall(a));
}
