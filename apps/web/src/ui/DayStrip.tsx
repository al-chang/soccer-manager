import { useEffect } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { dayToDate, dayOfSeasonYear, MONTH_NAMES, YEAR_LENGTH } from '@soccer-manager/engine/calendar';
import type { GameState } from '@soccer-manager/engine/types';

/** Milliseconds per simulated day — sets the pace of the advance ticker. */
const DAY_MS = 450;

/** Days shown in the strip: today plus the week ahead. */
const STRIP_DAYS = 8;

interface DayChip {
  kind: 'match' | 'round' | 'window' | 'season';
  label: string;
}

/** Everything scheduled on an absolute day that's worth a chip in the strip. */
function chipsForDay(game: GameState, day: number): DayChip[] {
  const chips: DayChip[] = [];
  const fixtures = game.fixtures.filter((f) => f.day === day && !f.played);
  const userFx = fixtures.find((f) => f.homeClubId === game.userClubId || f.awayClubId === game.userClubId);
  if (userFx) {
    const home = userFx.homeClubId === game.userClubId;
    const opp = game.clubs[home ? userFx.awayClubId : userFx.homeClubId];
    chips.push({ kind: 'match', label: `⚽ ${home ? 'vs' : 'at'} ${opp.shortName}` });
  } else if (fixtures.length > 0) {
    chips.push({ kind: 'round', label: 'League round' });
  }
  const seasonDay = dayOfSeasonYear(day);
  if (seasonDay === 0) chips.push({ kind: 'window', label: 'Summer window opens' });
  if (seasonDay === 184) chips.push({ kind: 'window', label: 'Winter window opens' });
  if (seasonDay === 61 || seasonDay === 214) chips.push({ kind: 'window', label: 'Deadline day' });
  if (seasonDay === YEAR_LENGTH - 1) chips.push({ kind: 'season', label: 'New season' });
  return chips;
}

/**
 * Week-ahead calendar strip under the topbar: today plus the next seven days,
 * with chips for anything scheduled (matches, window dates, season rollover).
 * While `advancing`, it also drives the day-by-day simulation timer — the
 * store owns the actual stepping (advanceOneDay); days slide off the left as
 * they pass.
 */
export function DayStrip() {
  const game = useGame();
  const advancing = useGameStore((s) => s.advancing);
  const advanceOneDay = useGameStore((s) => s.advanceOneDay);

  useEffect(() => {
    if (!advancing) return;
    const id = setInterval(advanceOneDay, DAY_MS);
    return () => clearInterval(id);
  }, [advancing, advanceOneDay]);

  const days = Array.from({ length: STRIP_DAYS }, (_, i) => game.day + i);

  return (
    <div className={`day-strip ${advancing ? 'advancing' : ''}`} aria-label="Upcoming days">
      {days.map((d) => {
        const date = dayToDate(d, game.startYear);
        const chips = chipsForDay(game, d);
        const isToday = d === game.day;
        return (
          // Keyed by absolute day so passed days unmount and new ones animate in.
          <div key={d} className={`day-cell ${isToday ? 'today' : ''}`}>
            <div className="day-cell-date">
              <b>{date.dayOfMonth}</b>
              {/* Today carries the year — the strip is now the only date display. */}
              <span className="muted">{MONTH_NAMES[date.month]}{isToday ? ` ${date.year}` : ''}</span>
              {isToday && <span className="day-today-tag">Today</span>}
            </div>
            <div className="day-cell-events">
              {chips.map((c, i) => (
                <span key={i} className={`day-chip ${c.kind}`} title={c.label}>{c.label}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
