import type { ReactNode } from 'react';
import { useGameStore, useGame } from '../store/gameStore';
import type { Screen } from '../store/gameStore';
import { windowName } from '@soccer-manager/engine/calendar';
import { formatMoney } from '@soccer-manager/engine/transfers';
import { unreadCount } from '@soccer-manager/engine/news';
import { pendingUserOffers } from '@soccer-manager/engine/sim';
import { DayStrip } from './DayStrip';
import { ThemeToggle } from './ThemeToggle';

const NAV: { screen: Screen; label: string }[] = [
  { screen: 'home', label: '🏠 Home' },
  { screen: 'squad', label: '👥 Squad' },
  { screen: 'tactics', label: '📋 Tactics' },
  { screen: 'transfers', label: '💸 Transfers' },
  { screen: 'fixtures', label: '📅 Fixtures' },
  { screen: 'table', label: '🏆 League' },
  { screen: 'inbox', label: '📨 Inbox' },
  { screen: 'history', label: '📜 History' },
];

export function Shell({ children }: { children: ReactNode }) {
  const game = useGame();
  const screen = useGameStore((s) => s.screen);
  const setScreen = useGameStore((s) => s.setScreen);
  const advance = useGameStore((s) => s.advance);
  const stopAdvance = useGameStore((s) => s.stopAdvance);
  const stopReason = useGameStore((s) => s.stopReason);
  const pendingFixtureId = useGameStore((s) => s.pendingFixtureId);
  const advancing = useGameStore((s) => s.advancing);

  const club = game.clubs[game.userClubId];
  const unread = unreadCount(game);
  const pendingOffers = pendingUserOffers(game);
  const win = windowName(game.day);
  const inMatch = game.liveMatch !== null || pendingFixtureId !== null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-club">
          <span className="club-dot big" style={{ background: club.colors[0], borderColor: club.colors[1] }} />
          <div>
            <b>{club.name}</b>
            <div className="muted small">Season {game.season}</div>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.screen}
              className={`nav-item ${screen === item.screen ? 'active' : ''}`}
              onClick={() => setScreen(item.screen)}
            >
              {item.label}
              {item.screen === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
              {item.screen === 'transfers' && pendingOffers > 0 && <span className="badge">{pendingOffers}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer muted small">
          <div>Budget: {formatMoney(club.budget)}</div>
          <div>{win ? `${win === 'summer' ? 'Summer' : 'Winter'} window open` : 'Window closed'}</div>
          <ThemeToggle />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <DayStrip />
          <div className="topbar-actions">
            {stopReason && <span className="stop-reason">{stopReason}</span>}
            <button
              className="btn primary"
              onClick={inMatch ? () => setScreen('match') : advancing ? stopAdvance : advance}
              disabled={inMatch && screen === 'match'}
            >
              {inMatch
                ? (screen === 'match' ? 'Match in progress' : '⚽ Go to match')
                : advancing ? '⏸ Pause' : 'Continue ▶'}
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
