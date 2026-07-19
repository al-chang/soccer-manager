import { useGame } from '../../store/gameStore';
import { formatDay } from '@soccer-manager/engine/calendar';
import { formatMoney } from '../common';

export function HistoryTab() {
  const game = useGame();
  const rows = [...game.transferHistory].reverse().slice(0, 80);
  return (
    <table className="table">
      <thead><tr><th>Date</th><th>Player</th><th>From</th><th>To</th><th>Fee</th></tr></thead>
      <tbody>
        {rows.map((t, i) => (
          <tr key={i}>
            <td className="muted small">{formatDay(t.day, game.startYear)}</td>
            <td>{t.playerName}</td>
            <td>{t.fromClubId >= 0 ? game.clubs[t.fromClubId]?.name : 'Free agent'}</td>
            <td>{game.clubs[t.toClubId]?.name ?? '—'}</td>
            <td>{t.fee > 0 ? formatMoney(t.fee) : 'Free'}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="muted">No transfers completed yet.</td></tr>}
      </tbody>
    </table>
  );
}
