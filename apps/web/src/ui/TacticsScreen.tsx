import { useGame, useGameStore } from '../store/gameStore';
import { FORMATION_IDS, MENTALITIES } from '@soccer-manager/engine/tactics';
import type { FormationId, Mentality, PressingLevel, TempoLevel } from '@soccer-manager/engine/types';
import { LineupEditor } from './LineupEditor';

export function TacticsScreen() {
  const game = useGame();
  const setTactics = useGameStore((s) => s.setTactics);
  const club = game.clubs[game.userClubId];

  return (
    <div>
      <h1>Tactics</h1>
      <div className="tactic-controls wide">
        <label>
          Formation
          <select value={club.tactics.formation} onChange={(e) => setTactics({ formation: e.target.value as FormationId })}>
            {FORMATION_IDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label>
          Mentality
          <select value={club.tactics.mentality} onChange={(e) => setTactics({ mentality: e.target.value as Mentality })}>
            {MENTALITIES.map((m) => <option key={m} value={m}>{m.replace('-', ' ')}</option>)}
          </select>
        </label>
        <label>
          Pressing
          <select value={club.tactics.pressing} onChange={(e) => setTactics({ pressing: e.target.value as PressingLevel })}>
            <option value="low">low (conserve energy)</option>
            <option value="medium">medium</option>
            <option value="high">high (win the ball, tiring)</option>
          </select>
        </label>
        <label>
          Tempo
          <select value={club.tactics.tempo} onChange={(e) => setTactics({ tempo: e.target.value as TempoLevel })}>
            <option value="slow">slow</option>
            <option value="normal">normal</option>
            <option value="fast">fast</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        Attacking mentalities create more chances but leave you open. High pressing strengthens midfield
        control but drains fitness. Changing formation re-picks your best XI.
      </p>
      <LineupEditor />
    </div>
  );
}
