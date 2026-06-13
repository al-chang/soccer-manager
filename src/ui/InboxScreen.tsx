import { useEffect } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { formatDay } from '../engine/calendar';

const CATEGORY_ICONS: Record<string, string> = {
  transfer: '💸', match: '⚽', squad: '👥', league: '🏆', board: '🏛️', window: '🪟',
};

export function InboxScreen() {
  const game = useGame();
  const markNewsRead = useGameStore((s) => s.markNewsRead);

  useEffect(() => {
    // Mark read when leaving the screen so unread styling shows on entry.
    return () => markNewsRead();
  }, [markNewsRead]);

  return (
    <div>
      <h1>Inbox</h1>
      {game.news.length === 0 && <p className="muted">No news yet. Continue to advance the world.</p>}
      <ul className="news-list full">
        {game.news.map((n) => (
          <li key={n.id} className={n.read ? '' : 'unread'}>
            <div className="news-head">
              <span>{CATEGORY_ICONS[n.category] ?? '📰'}</span>
              <b>{n.title}</b>
              <span className="muted small">{formatDay(n.day, game.startYear)}</span>
            </div>
            <div className="muted">{n.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
