import { useState } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { overall, fullName } from '@soccer-manager/engine/player';
import { formatDay } from '@soccer-manager/engine/calendar';
import { POSITIONS, positionGroup } from '@soccer-manager/engine/tactics';
import type { Position } from '@soccer-manager/engine/types';
import { OvrBadge, PosBadge, ConditionBar, FormDots, playerValue, formatMoney, statusFlags, seasonLine, contractExpiringSoon } from './common';

type SortKey = 'pos' | 'ovr' | 'age' | 'fitness' | 'morale' | 'value' | 'wage';
const POS_ORDER: Record<Position, number> = Object.fromEntries(POSITIONS.map((p, i) => [p, i])) as Record<Position, number>;

export function SquadScreen() {
  const game = useGame();
  const viewPlayer = useGameStore((s) => s.viewPlayer);
  const setTrainingIntensity = useGameStore((s) => s.setTrainingIntensity);
  const [sort, setSort] = useState<SortKey>('pos');

  const club = game.clubs[game.userClubId];
  const squad = clubPlayers(game, club.id);

  const sorted = [...squad].sort((a, b) => {
    switch (sort) {
      case 'ovr': return overall(b) - overall(a);
      case 'age': return a.age - b.age;
      case 'fitness': return a.fitness - b.fitness;
      case 'morale': return (a.morale + a.wellbeing) - (b.morale + b.wellbeing);
      case 'wage': return b.contract.wage - a.contract.wage;
      case 'value': return overall(b) - overall(a); // value tracks ability closely
      default: return POS_ORDER[a.position] - POS_ORDER[b.position] || overall(b) - overall(a);
    }
  });

  const th = (k: SortKey, label: string) => (
    <th className={`sortable ${sort === k ? 'sorted' : ''}`} onClick={() => setSort(k)}>{label}</th>
  );

  return (
    <div>
      <div className="screen-head">
        <h1>Squad <span className="muted">({squad.length} players)</span></h1>
        <div className="head-controls">
          <span className="muted small">Wages: {formatMoney(totalWages(squad))}/{formatMoney(club.wageBudget)} wk</span>
          <label className="inline">
            Training:
            <select value={game.trainingIntensity} onChange={(e) => setTrainingIntensity(e.target.value as 'light' | 'normal' | 'heavy')}>
              <option value="light">Light (recover, rest)</option>
              <option value="normal">Normal</option>
              <option value="heavy">Heavy (develop, tiring)</option>
            </select>
          </label>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>{th('pos', 'Pos')}<th>Name</th>{th('age', 'Age')}{th('ovr', 'Ovr')}
            {th('fitness', 'Fitness')}<th>Sharp</th>{th('morale', 'Morale')}<th>Wellbeing</th>
            <th>Form</th><th>Apps</th><th>G</th><th>A</th>{th('wage', 'Wage')}<th>Contract</th>{th('value', 'Value')}<th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const line = seasonLine(p, game.season);
            const starter = club.lineup.starters.includes(p.id);
            return (
              <tr key={p.id} className={starter ? 'starter-row' : ''} onClick={() => viewPlayer(p.id)}>
                <td className="muted">{p.squadNumber}</td>
                <td><PosBadge pos={p.position} group={positionGroup(p.position)} /></td>
                <td className="name-cell">{fullName(p)}{starter && <span className="muted small"> XI</span>}</td>
                <td>{p.age}</td>
                <td><OvrBadge value={overall(p)} /></td>
                <td><ConditionBar value={p.fitness} label="Fitness" /></td>
                <td><ConditionBar value={p.sharpness} label="Sharpness" /></td>
                <td><ConditionBar value={p.morale} label="Morale" /></td>
                <td><ConditionBar value={p.wellbeing} label="Wellbeing" /></td>
                <td><FormDots form={p.form} /></td>
                <td>{line.apps}</td><td>{line.goals}</td><td>{line.assists}</td>
                <td>{formatMoney(p.contract.wage)}</td>
                <td className={`small ${contractExpiringSoon(p, game.day) ? 'warn' : 'muted'}`}>
                  {formatDay(p.contract.expiresDay, game.startYear)}{contractExpiringSoon(p, game.day) && ' ⚠'}
                </td>
                <td>{playerValue(game, p)}</td>
                <td className="small">{statusFlags(p)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
