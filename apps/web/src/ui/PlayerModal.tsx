import { useGame, useGameStore } from '../store/gameStore';
import { overall, fullName, marketValue, ATTRIBUTE_KEYS } from '@soccer-manager/engine/player';
import { formatDay } from '@soccer-manager/engine/calendar';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { OvrBadge, PosBadge, ConditionBar, FormDots, formatMoney, statusFlags, seasonLine, avgRating, contractExpiringSoon } from './common';

const ATTR_LABELS: Record<string, string> = {
  pace: 'Pace', strength: 'Strength', stamina: 'Stamina', passing: 'Passing', shooting: 'Shooting',
  dribbling: 'Dribbling', defending: 'Defending', goalkeeping: 'Goalkeeping', vision: 'Vision',
  composure: 'Composure', workRate: 'Work rate',
};

interface PlayerModalProps {
  playerId: number;
  onClose: () => void;
  /** Hide the "full profile" navigation (e.g. mid-match). */
  allowNavigate?: boolean;
}

/** Quick-look popup with a player's stats; reused by tactics and match screens. */
export function PlayerModal({ playerId, onClose, allowNavigate = true }: PlayerModalProps) {
  const game = useGame();
  const viewPlayer = useGameStore((s) => s.viewPlayer);
  const p = game.players[playerId];
  if (!p) return null;

  const ovr = overall(p);
  const line = seasonLine(p, game.season);
  const flags = statusFlags(p);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="player-head">
            <h2>{fullName(p)}</h2>
            <OvrBadge value={ovr} />
          </div>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>
        <div className="club-meta">
          <span>
            <PosBadge pos={p.position} group={positionGroup(p.position)} /> · Age {p.age} · {game.nations[p.nationId].name}
            {p.clubId >= 0 && <> · {game.clubs[p.clubId].name}</>}
          </span>
          <span>Value: <b>{formatMoney(marketValue(p, game.day))}</b> · Wage: <b>{formatMoney(p.contract.wage)}/wk</b>
            {p.clubId >= 0 && <> until <span className={contractExpiringSoon(p, game.day) ? 'warn' : ''}>{formatDay(p.contract.expiresDay, game.startYear)}</span></>}
          </span>
          {flags && <span className="warn">{flags}</span>}
        </div>

        <div className="cond-grid">
          <label>Fitness <ConditionBar value={p.fitness} /></label>
          <label>Sharpness <ConditionBar value={p.sharpness} /></label>
          <label>Morale <ConditionBar value={p.morale} /></label>
          <label>Wellbeing <ConditionBar value={p.wellbeing} /></label>
        </div>

        <div className="modal-statline muted small">
          This season: {line.apps} apps, {line.goals} goals, {line.assists} assists, avg {avgRating(p, game.season)}
          {' '}· Form: <FormDots form={p.form} />
        </div>

        <div className="attr-grid">
          {ATTRIBUTE_KEYS.filter((k) => p.position === 'GK' || k !== 'goalkeeping').map((k) => (
            <div key={k} className="attr">
              <span>{ATTR_LABELS[k]}</span>
              <b className={p.attributes[k] >= 70 ? 'good-text' : p.attributes[k] <= 45 ? 'bad-text' : ''}>{p.attributes[k]}</b>
            </div>
          ))}
        </div>

        {allowNavigate && (
          <div className="action-row" style={{ marginTop: 12, marginBottom: 0 }}>
            <button className="btn" onClick={() => { onClose(); viewPlayer(p.id); }}>Open full profile</button>
          </div>
        )}
      </div>
    </div>
  );
}
