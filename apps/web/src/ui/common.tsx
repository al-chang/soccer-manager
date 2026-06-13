import type { ReactNode } from 'react';
import type { Player, GameState } from '../engine/types';
import { overall, fullName } from '../engine/player';
import { marketValue } from '../engine/player';
import { formatMoney } from '../engine/transfers';
import { useGameStore } from '../store/gameStore';

// Pure presentational primitives live in the design system. Re-exported here so
// existing `from './common'` import sites keep working unchanged.
export { ovrClass, OvrBadge, PosBadge, ConditionBar, FormDots } from '@soccer-manager/design-system';

export { formatMoney };

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
