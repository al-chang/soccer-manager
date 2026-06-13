import { useState } from 'react';
import { useGameStore, useGame } from '../store/gameStore';
import { clubPlayers, squadStrength } from '@soccer-manager/engine/squad';
import { formatMoney } from '@soccer-manager/engine/transfers';
import { describeTactics } from '@soccer-manager/engine/tactics';

export function TeamSelect() {
  const game = useGame();
  const chooseTeam = useGameStore((s) => s.chooseTeam);
  const [leagueId, setLeagueId] = useState(game.leagues[0].id);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const league = game.leagues.find((l) => l.id === leagueId)!;
  const clubs = league.clubIds
    .map((id) => game.clubs[id])
    .sort((a, b) => b.reputation - a.reputation);

  return (
    <div className="team-select">
      <h1>Choose your club</h1>
      <p className="muted">Pick any club from any division. Stronger clubs mean bigger budgets and bigger expectations.</p>
      <div className="league-tabs">
        {game.leagues.map((l) => (
          <button key={l.id} className={`tab ${l.id === leagueId ? 'active' : ''}`} onClick={() => setLeagueId(l.id)}>
            {l.name}
          </button>
        ))}
      </div>
      <div className="club-grid">
        {clubs.map((club) => {
          const squad = clubPlayers(game, club.id);
          const manager = game.managers[club.managerId];
          return (
            <div key={club.id} className="club-card" style={{ borderTopColor: club.colors[0] }}>
              <h3>
                <span className="club-dot big" style={{ background: club.colors[0], borderColor: club.colors[1] }} />
                {club.name}
              </h3>
              <div className="club-meta">
                <span>Squad strength: <b>{Math.round(squadStrength(squad))}</b></span>
                <span>Reputation: <b>{club.reputation}</b></span>
                <span>Transfer budget: <b>{formatMoney(club.budget)}</b></span>
                <span>Wage budget: <b>{formatMoney(club.wageBudget)}/wk</b></span>
                <span className="muted small">Outgoing manager played {describeTactics(club.tactics)}; {manager?.name} moves on as you arrive.</span>
              </div>
              {confirmId === club.id ? (
                <div className="confirm-row">
                  <button className="btn primary" onClick={() => chooseTeam(club.id)}>Confirm</button>
                  <button className="btn" onClick={() => setConfirmId(null)}>Cancel</button>
                </div>
              ) : (
                <button className="btn" onClick={() => setConfirmId(club.id)}>Manage this club</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
