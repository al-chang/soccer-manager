import { useEffect } from 'react';
import { useGame, useGameStore, nextUserFixture } from '../store/gameStore';
import { formatDay } from '@soccer-manager/engine/calendar';

/** Milliseconds per simulated day — sets the pace of the scrolling animation. */
const DAY_MS = 450;

/**
 * FIFA-style "advancing" screen: a full-screen panel that ticks the date up
 * one day at a time, scrolling news in as it appears, until the simulation
 * hits an event worth stopping for. The store owns the actual day stepping
 * (advanceOneDay); this component just drives the timer and renders.
 */
export function AdvanceOverlay() {
  const game = useGame();
  const advancing = useGameStore((s) => s.advancing);
  const advanceOneDay = useGameStore((s) => s.advanceOneDay);
  const stopAdvance = useGameStore((s) => s.stopAdvance);

  useEffect(() => {
    if (!advancing) return;
    const id = setInterval(advanceOneDay, DAY_MS);
    return () => clearInterval(id);
  }, [advancing, advanceOneDay]);

  if (!advancing) return null;

  const next = nextUserFixture(game);
  const feed = game.news.slice(0, 8);

  return (
    <div className="advance-overlay">
      <div className="advance-panel">
        <div className="advance-heading muted">Advancing…</div>
        {/* key on the day so the tick animation replays each new day */}
        <div key={game.day} className="advance-date">{formatDay(game.day, game.startYear)}</div>
        {next ? (
          <div className="advance-next muted small">
            Next match: {game.clubs[next.homeClubId].shortName} vs {game.clubs[next.awayClubId].shortName}
            {' · '}{formatDay(next.day, game.startYear)}
          </div>
        ) : (
          <div className="advance-next muted small">Season complete — advancing to the new campaign</div>
        )}

        <div className="advance-feed">
          {feed.length === 0 && <div className="muted small center">No news yet…</div>}
          {feed.map((n) => (
            <div key={n.id} className="advance-news">
              <span className={`news-cat cat-${n.category}`}>{n.category}</span>
              <div className="advance-news-body">
                <b>{n.title}</b>
                <span className="muted small">{formatDay(n.day, game.startYear)}</span>
                <div className="muted small">{n.body}</div>
              </div>
            </div>
          ))}
        </div>

        <button className="btn primary" onClick={stopAdvance}>⏸ Stop here</button>
      </div>
    </div>
  );
}
