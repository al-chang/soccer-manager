import { useGame, useGameStore } from '../store/gameStore';
import { clubPlayers, squadStrength } from '../engine/squad';
import { overall } from '../engine/player';
import { describeTactics } from '../engine/tactics';
import { leaguePosition } from '../engine/season';
import { OvrBadge, PosBadge, PlayerLink, formatMoney, playerValue } from './common';
import { ordinal } from './HomeScreen';

export function ClubScreen() {
  const game = useGame();
  const id = useGameStore((s) => s.selectedClubId);
  const club = id !== null ? game.clubs[id] : null;
  if (!club) return <p className="muted">Club not found.</p>;

  const league = game.leagues.find((l) => l.id === club.leagueId)!;
  const manager = game.managers[club.managerId];
  const squad = clubPlayers(game, club.id).sort((a, b) => overall(b) - overall(a));
  const pos = leaguePosition(league, club.id);
  const isUser = club.id === game.userClubId;

  return (
    <div className="grid-2">
      <section className="card">
        <h1>
          <span className="club-dot big" style={{ background: club.colors[0], borderColor: club.colors[1] }} />
          {club.name}
        </h1>
        <div className="club-meta">
          <span>{league.name} — currently {pos}{ordinal(pos)}</span>
          <span>Reputation: <b>{club.reputation}</b></span>
          <span>Squad strength: <b>{Math.round(squadStrength(squad))}</b></span>
          {!isUser && manager && (
            <>
              <span>Manager: <b>{manager.name}</b></span>
              <span className="muted">Style: {manager.style} · in negotiations: {manager.temper}</span>
              <span className="muted small">Sets up {describeTactics(club.tactics)}</span>
            </>
          )}
        </div>
        <h2>Season history</h2>
        <table className="table compact">
          <thead><tr><th>Season</th><th>League</th><th>Pos</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            {[...club.history].reverse().map((h, i) => (
              <tr key={i}>
                <td>{h.season}</td>
                <td className="small">{h.leagueName}</td>
                <td>{h.finalPosition}</td>
                <td>{h.points}</td>
                <td className="small">
                  {h.champions && '🏆 Champions'}
                  {h.promoted && ' ⬆️ Promoted'}
                  {h.relegated && ' ⬇️ Relegated'}
                </td>
              </tr>
            ))}
            {club.history.length === 0 && <tr><td colSpan={5} className="muted">First season in progress.</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Squad</h2>
        <table className="table compact">
          <thead><tr><th>Pos</th><th>Name</th><th>Age</th><th>Ovr</th><th>Value</th></tr></thead>
          <tbody>
            {squad.map((p) => (
              <tr key={p.id}>
                <td><PosBadge pos={p.position} /></td>
                <td><PlayerLink player={p} /></td>
                <td>{p.age}</td>
                <td><OvrBadge value={overall(p)} /></td>
                <td>{playerValue(game, p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isUser && <p className="muted small">Transfer budget: ~{formatMoney(club.budget)}</p>}
      </section>
    </div>
  );
}
