import type { ReactNode } from 'react';
import type { Player, GameState } from '../engine/types';
import { overall, fullName } from '../engine/player';
import { marketValue } from '../engine/player';
import { formatMoney } from '../engine/transfers';
import { useGameStore } from '../store/gameStore';

export { formatMoney };

export function ovrClass(ovr: number): string {
  if (ovr >= 75) return 'ovr elite';
  if (ovr >= 65) return 'ovr good';
  if (ovr >= 55) return 'ovr decent';
  return 'ovr poor';
}

export function OvrBadge({ value }: { value: number }) {
  return <span className={ovrClass(value)}>{value}</span>;
}

export function PosBadge({ pos }: { pos: string }) {
  return <span className={`pos pos-${pos.toLowerCase()}`}>{pos}</span>;
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

export function ConditionBar({ value, label }: { value: number; label?: string }) {
  const color = value >= 75 ? 'var(--green)' : value >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="cond" title={label ? `${label}: ${Math.round(value)}%` : `${Math.round(value)}%`}>
      <div className="cond-fill" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

export function FormDots({ form }: { form: number[] }) {
  if (!form.length) return <span className="muted">—</span>;
  return (
    <span className="form-dots">
      {form.map((r, i) => (
        <span key={i} className="form-dot" style={{ background: r >= 7.5 ? 'var(--green)' : r >= 6.2 ? 'var(--amber)' : 'var(--red)' }} title={r.toFixed(1)} />
      ))}
    </span>
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
