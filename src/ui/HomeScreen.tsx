import { useGame, useGameStore } from '../store/gameStore';
import { nextUserFixture } from '../engine/sim';
import { sortedTable, leaguePosition } from '../engine/season';
import { formatDay } from '../engine/calendar';
import { clubPlayers } from '../engine/squad';
import { formatMoney } from '../engine/transfers';
import { ClubLink } from './common';

export function HomeScreen() {
  const game = useGame();
  const setScreen = useGameStore((s) => s.setScreen);
  const club = game.clubs[game.userClubId];
  const league = game.leagues.find((l) => l.id === club.leagueId)!;
  const next = nextUserFixture(game);
  const table = sortedTable(league);
  const pos = leaguePosition(league, club.id);

  const recent = game.fixtures
    .filter((f) => f.played && (f.homeClubId === club.id || f.awayClubId === club.id))
    .sort((a, b) => b.day - a.day)
    .slice(0, 5);

  const squad = clubPlayers(game, club.id);
  const injured = squad.filter((p) => p.injuryDays > 0);
  const unhappy = squad.filter((p) => p.wellbeing < 40);
  const latestNews = game.news.slice(0, 4);

  // Mini-table window around the user's position.
  const start = Math.max(0, Math.min(pos - 3, table.length - 5));
  const mini = table.slice(start, start + 5);

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Next match</h2>
        {next ? (
          <div className="next-match">
            <div className="next-match-teams">
              <ClubLink game={game} clubId={next.homeClubId} />
              <span className="vs">vs</span>
              <ClubLink game={game} clubId={next.awayClubId} />
            </div>
            <div className="muted">{formatDay(next.day, game.startYear)} · Round {next.round} · {league.name}</div>
          </div>
        ) : (
          <p className="muted">No fixtures scheduled — the season is over. Continue to advance to the new season.</p>
        )}
        <h2>Recent results</h2>
        {recent.length === 0 && <p className="muted">No matches played yet.</p>}
        <ul className="result-list">
          {recent.map((f) => {
            const isHome = f.homeClubId === club.id;
            const us = isHome ? f.homeGoals : f.awayGoals;
            const them = isHome ? f.awayGoals : f.homeGoals;
            const res = us > them ? 'W' : us === them ? 'D' : 'L';
            const opp = game.clubs[isHome ? f.awayClubId : f.homeClubId];
            return (
              <li key={f.id}>
                <span className={`result-chip ${res.toLowerCase()}`}>{res}</span>
                {isHome ? 'vs' : 'at'} {opp.name} — {f.homeGoals}:{f.awayGoals}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2>{league.name} <span className="muted">— {pos}{ordinal(pos)}</span></h2>
        <table className="table compact">
          <thead><tr><th>#</th><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            {mini.map((e) => {
              const i = table.indexOf(e);
              const c = game.clubs[e.clubId];
              return (
                <tr key={e.clubId} className={e.clubId === club.id ? 'highlight' : ''}>
                  <td>{i + 1}</td>
                  <td><ClubLink game={game} clubId={c.id} /></td>
                  <td>{e.played}</td>
                  <td>{e.goalsFor - e.goalsAgainst}</td>
                  <td><b>{e.points}</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="btn small" onClick={() => setScreen('table')}>Full table</button>

        <h2>Club status</h2>
        <div className="club-meta">
          <span>Transfer budget: <b>{formatMoney(club.budget)}</b></span>
          <span>Squad size: <b>{squad.length}</b></span>
          {injured.length > 0 && <span className="warn">🤕 {injured.length} injured</span>}
          {unhappy.length > 0 && <span className="warn">😟 {unhappy.length} unhappy player{unhappy.length > 1 ? 's' : ''}</span>}
        </div>
      </section>

      <section className="card span-2">
        <h2>Latest news</h2>
        {latestNews.length === 0 && <p className="muted">Nothing yet.</p>}
        <ul className="news-list">
          {latestNews.map((n) => (
            <li key={n.id} className={n.read ? '' : 'unread'}>
              <b>{n.title}</b> <span className="muted small">{formatDay(n.day, game.startYear)}</span>
              <div className="muted">{n.body}</div>
            </li>
          ))}
        </ul>
        <button className="btn small" onClick={() => setScreen('inbox')}>Open inbox</button>
      </section>
    </div>
  );
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
