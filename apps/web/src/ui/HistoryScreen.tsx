import { useGame } from '../store/gameStore';
import { formatDay } from '@soccer-manager/engine/calendar';
import { formatMoney } from './common';
import { ordinal } from './HomeScreen';

export function HistoryScreen() {
  const game = useGame();
  const club = game.clubs[game.userClubId];
  const myTransfers = game.transferHistory
    .filter((t) => t.fromClubId === game.userClubId || t.toClubId === game.userClubId)
    .reverse();

  return (
    <div className="grid-2">
      <section className="card">
        <h1>Club history</h1>
        {club.history.length === 0 && <p className="muted">Your story is still being written — finish a season to start the record books.</p>}
        <table className="table">
          <thead><tr><th>Season</th><th>League</th><th>Pos</th><th>W-D-L</th><th>GF:GA</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            {[...club.history].reverse().map((h, i) => (
              <tr key={i}>
                <td>{h.season}</td>
                <td className="small">{h.leagueName}</td>
                <td>{h.finalPosition}{ordinal(h.finalPosition)}</td>
                <td>{h.won}-{h.drawn}-{h.lost}</td>
                <td>{h.goalsFor}:{h.goalsAgainst}</td>
                <td><b>{h.points}</b></td>
                <td>
                  {h.champions && '🏆'}
                  {h.promoted && '⬆️'}
                  {h.relegated && '⬇️'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Your transfer dealings</h2>
        {myTransfers.length === 0 && <p className="muted">No transfers in or out yet.</p>}
        <table className="table compact">
          <thead><tr><th>Date</th><th>Player</th><th>Direction</th><th>Fee</th></tr></thead>
          <tbody>
            {myTransfers.map((t, i) => {
              const isIn = t.toClubId === game.userClubId;
              const other = isIn
                ? (t.fromClubId >= 0 ? game.clubs[t.fromClubId]?.name : 'Free agency')
                : game.clubs[t.toClubId]?.name;
              return (
                <tr key={i}>
                  <td className="muted small">{formatDay(t.day, game.startYear)}</td>
                  <td>{t.playerName}</td>
                  <td>{isIn ? `⬅️ in from ${other}` : `➡️ out to ${other}`}</td>
                  <td>{t.fee > 0 ? formatMoney(t.fee) : 'Free'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
