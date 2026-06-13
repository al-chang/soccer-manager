import { useGame } from '../store/gameStore';
import { formatDay } from '@soccer-manager/engine/calendar';
import { ClubLink } from './common';

export function FixturesScreen() {
  const game = useGame();
  const club = game.clubs[game.userClubId];
  const fixtures = game.fixtures
    .filter((f) => f.homeClubId === club.id || f.awayClubId === club.id)
    .sort((a, b) => a.day - b.day);

  return (
    <div>
      <h1>Fixtures & results</h1>
      <table className="table">
        <thead><tr><th>Date</th><th>Rd</th><th>Home</th><th>Score</th><th>Away</th><th></th></tr></thead>
        <tbody>
          {fixtures.map((f) => {
            const isHome = f.homeClubId === club.id;
            const us = isHome ? f.homeGoals : f.awayGoals;
            const them = isHome ? f.awayGoals : f.homeGoals;
            const res = !f.played ? '' : us > them ? 'w' : us === them ? 'd' : 'l';
            return (
              <tr key={f.id} className={f.played ? '' : 'upcoming'}>
                <td className="muted small">{formatDay(f.day, game.startYear)}</td>
                <td className="muted">{f.round}</td>
                <td className={f.homeClubId === club.id ? 'name-cell' : ''}><ClubLink game={game} clubId={f.homeClubId} /></td>
                <td>{f.played ? <b>{f.homeGoals} – {f.awayGoals}</b> : <span className="muted">v</span>}</td>
                <td className={f.awayClubId === club.id ? 'name-cell' : ''}><ClubLink game={game} clubId={f.awayClubId} /></td>
                <td>{res && <span className={`result-chip ${res}`}>{res.toUpperCase()}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
