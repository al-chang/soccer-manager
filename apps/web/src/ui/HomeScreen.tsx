import { useGame, useGameStore } from '../store/gameStore';
import { nextUserFixture } from '@soccer-manager/engine/sim';
import { sortedTable, leaguePosition } from '@soccer-manager/engine/season';
import { formatDay } from '@soccer-manager/engine/calendar';
import { clubPlayers } from '@soccer-manager/engine/squad';
import { formatMoney } from '@soccer-manager/engine/transfers';
import { ClubLink } from './common';
import type { GameState } from '@soccer-manager/engine/types';

type Res = 'W' | 'D' | 'L';

/** A club's last-five results, oldest → newest (left-to-right reading order). */
function clubForm(game: GameState, clubId: number): Res[] {
  return game.fixtures
    .filter((f) => f.played && (f.homeClubId === clubId || f.awayClubId === clubId))
    .sort((a, b) => b.day - a.day)
    .slice(0, 5)
    .map((f) => {
      const home = f.homeClubId === clubId;
      const us = home ? f.homeGoals : f.awayGoals;
      const them = home ? f.awayGoals : f.homeGoals;
      return us > them ? 'W' : us === them ? 'D' : 'L';
    })
    .reverse();
}

function FormRow({ form }: { form: Res[] }) {
  if (form.length === 0) return <span className="form-row muted small">No recent form</span>;
  return (
    <span className="form-row" aria-label={`Recent form, oldest first: ${form.join(' ')}`}>
      {form.map((r, i) => (
        <span key={i} className={`result-chip mini ${r.toLowerCase()}`} aria-hidden="true">{r}</span>
      ))}
    </span>
  );
}

function FixtureTeam({ game, clubId, side }: { game: GameState; clubId: number; side: 'home' | 'away' }) {
  const c = game.clubs[clubId];
  return (
    <div className={`mh-team ${side}`}>
      <span className="mh-crest" style={{ background: c.colors[0], borderColor: c.colors[1] }} />
      <span className="mh-team-text">
        <span className="mh-team-name">{c.name}</span>
        <FormRow form={clubForm(game, clubId)} />
      </span>
    </div>
  );
}

export function HomeScreen() {
  const game = useGame();
  const setScreen = useGameStore((s) => s.setScreen);
  const advance = useGameStore((s) => s.advance);
  const advancing = useGameStore((s) => s.advancing);
  const pendingFixtureId = useGameStore((s) => s.pendingFixtureId);

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

  const inMatch = game.liveMatch !== null || pendingFixtureId !== null;
  const isUserHome = next?.homeClubId === club.id;

  const cta = (
    <button
      className="btn primary big"
      onClick={inMatch ? () => setScreen('match') : advance}
      disabled={!inMatch && advancing}
    >
      {inMatch ? '⚽ Go to match' : advancing ? 'Simulating…' : 'Continue ▶'}
    </button>
  );

  return (
    <div className="home-grid">
      <section className="match-hero span-2">
        <div className="mh-head">
          <span className="mh-kicker">{inMatch ? 'Match day' : next ? 'Next match' : 'Season complete'}</span>
          {next && (
            <span className="mh-meta">
              {formatDay(next.day, game.startYear)} · Round {next.round} · {league.name}
            </span>
          )}
        </div>

        {next ? (
          <>
            <div className="mh-fixture">
              <FixtureTeam game={game} clubId={next.homeClubId} side="home" />
              <div className="mh-vs">
                <span className="mh-vs-label">vs</span>
                <span className={`venue-pill ${isUserHome ? 'home' : 'away'}`}>{isUserHome ? 'Home' : 'Away'}</span>
              </div>
              <FixtureTeam game={game} clubId={next.awayClubId} side="away" />
            </div>
            <div className="mh-foot">
              <span className="muted small">You sit {pos}{ordinal(pos)} in {league.name}</span>
              {cta}
            </div>
          </>
        ) : (
          <div className="mh-empty">
            <p className="muted">The season is over. Continue to wrap things up and roll into the new campaign.</p>
            {cta}
          </div>
        )}
      </section>

      <div className="stat-strip span-2">
        <div className="stat-tile">
          <span className="stat-label">Transfer budget</span>
          <span className="stat-value">{formatMoney(club.budget)}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Squad size</span>
          <span className="stat-value">{squad.length}</span>
        </div>
        <button
          className={`stat-tile ${injured.length > 0 ? 'alert' : ''}`}
          onClick={() => setScreen('squad')}
          disabled={injured.length === 0}
        >
          <span className="stat-label">Injured</span>
          <span className="stat-value">{injured.length}</span>
        </button>
        <button
          className={`stat-tile ${unhappy.length > 0 ? 'alert' : ''}`}
          onClick={() => setScreen('squad')}
          disabled={unhappy.length === 0}
        >
          <span className="stat-label">Unhappy</span>
          <span className="stat-value">{unhappy.length}</span>
        </button>
      </div>

      <section className="card">
        <h2>Recent results</h2>
        {recent.length === 0 ? (
          <p className="muted">No matches played yet — your season starts with the fixture above.</p>
        ) : (
          <ul className="result-list">
            {recent.map((f) => {
              const isHome = f.homeClubId === club.id;
              const us = isHome ? f.homeGoals : f.awayGoals;
              const them = isHome ? f.awayGoals : f.homeGoals;
              const res: Res = us > them ? 'W' : us === them ? 'D' : 'L';
              const oppId = isHome ? f.awayClubId : f.homeClubId;
              return (
                <li key={f.id} className="result-row">
                  <span className={`result-chip ${res.toLowerCase()}`}>{res}</span>
                  <span className="result-venue" title={isHome ? 'Home' : 'Away'}>{isHome ? 'H' : 'A'}</span>
                  <span className="result-opp"><ClubLink game={game} clubId={oppId} /></span>
                  <span className="result-score">{us}<span className="muted">–</span>{them}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{league.name} <span className="muted">· {pos}{ordinal(pos)}</span></h2>
          <button className="btn small" onClick={() => setScreen('table')}>Full table</button>
        </div>
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
      </section>

      <section className="card span-2">
        <div className="card-head">
          <h2>Latest news</h2>
          <button className="btn small" onClick={() => setScreen('inbox')}>Open inbox</button>
        </div>
        {latestNews.length === 0 ? (
          <p className="muted">No news yet — it'll appear here as the season unfolds.</p>
        ) : (
          <ul className="news-list">
            {latestNews.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <div className="news-head">
                  <b>{n.title}</b> <span className="muted small">{formatDay(n.day, game.startYear)}</span>
                </div>
                <div className="news-body muted">{n.body}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
