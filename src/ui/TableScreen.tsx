import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { sortedTable } from '../engine/season';
import { ClubLink } from './common';

export function TableScreen() {
  const game = useGame();
  const userLeagueId = game.clubs[game.userClubId].leagueId;
  const [leagueId, setLeagueId] = useState(userLeagueId);
  const league = game.leagues.find((l) => l.id === leagueId)!;
  const table = sortedTable(league);

  return (
    <div>
      <h1>League table</h1>
      <div className="league-tabs">
        {game.leagues.map((l) => (
          <button key={l.id} className={`tab ${l.id === leagueId ? 'active' : ''}`} onClick={() => setLeagueId(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
        </thead>
        <tbody>
          {table.map((e, i) => {
            const pos = i + 1;
            const zone =
              league.tier === 2 && pos <= league.promotionSpots ? 'promo' :
              league.tier === 1 && pos > table.length - league.relegationSpots ? 'releg' : '';
            return (
              <tr key={e.clubId} className={`${e.clubId === game.userClubId ? 'highlight' : ''} ${zone}`}>
                <td>{pos}</td>
                <td><ClubLink game={game} clubId={e.clubId} /></td>
                <td>{e.played}</td><td>{e.won}</td><td>{e.drawn}</td><td>{e.lost}</td>
                <td>{e.goalsFor}</td><td>{e.goalsAgainst}</td><td>{e.goalsFor - e.goalsAgainst}</td>
                <td><b>{e.points}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        {league.tier === 1
          ? `Bottom ${league.relegationSpots} are relegated.`
          : `Top ${league.promotionSpots} are promoted.`}
      </p>
    </div>
  );
}
