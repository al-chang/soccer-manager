import { useState } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { overall, fullName, marketValue, wageDemand, ATTRIBUTE_KEYS } from '@soccer-manager/engine/player';
import { formatDay, isTransferWindowOpen } from '@soccer-manager/engine/calendar';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { OvrBadge, PosBadge, ConditionBar, FormDots, formatMoney, statusFlags, ClubLink } from './common';

const ATTR_LABELS: Record<string, string> = {
  pace: 'Pace', strength: 'Strength', stamina: 'Stamina', passing: 'Passing', shooting: 'Shooting',
  dribbling: 'Dribbling', defending: 'Defending', goalkeeping: 'Goalkeeping', vision: 'Vision',
  composure: 'Composure', workRate: 'Work rate',
};

export function PlayerScreen() {
  const game = useGame();
  const id = useGameStore((s) => s.selectedPlayerId);
  const bidForPlayer = useGameStore((s) => s.bidForPlayer);
  const setTransferListed = useGameStore((s) => s.setTransferListed);
  const renewContract = useGameStore((s) => s.renewContract);
  const signFreeAgent = useGameStore((s) => s.signFreeAgent);
  const [bid, setBid] = useState('');
  const [wage, setWage] = useState('');
  const [years, setYears] = useState(3);
  const [msg, setMsg] = useState<string | null>(null);

  const p = id !== null ? game.players[id] : null;
  if (!p) return <p className="muted">Player not found (he may have retired).</p>;

  const ovr = overall(p);
  const value = marketValue(p, game.day);
  const isMine = p.clubId === game.userClubId;
  const isFree = p.clubId === -1;
  const userClub = game.clubs[game.userClubId];
  const windowOpen = isTransferWindowOpen(game.day);
  const freeDemand = wageDemand(ovr, p.age, userClub.reputation);

  const act = (result: string | null, successMsg: string) => {
    setMsg(result ?? successMsg);
  };

  return (
    <div className="grid-2">
      <section className="card">
        <div className="player-head">
          <h1>{fullName(p)}</h1>
          <OvrBadge value={ovr} />
        </div>
        <div className="club-meta">
          <span><PosBadge pos={p.position} group={positionGroup(p.position)} /> · Age {p.age} · {game.nations[p.nationId].name}</span>
          <span>Club: <ClubLink game={game} clubId={p.clubId} /></span>
          <span>Value: <b>{formatMoney(value)}</b></span>
          <span>Wage: <b>{formatMoney(p.contract.wage)}/wk</b>{!isFree && <> until {formatDay(p.contract.expiresDay, game.startYear)}</>}</span>
          {p.potential > ovr && p.age <= 23 && <span className="muted">Scouts see room to grow.</span>}
          {statusFlags(p) && <span className="warn">{statusFlags(p)}</span>}
        </div>

        <h2>Condition</h2>
        <div className="cond-grid">
          <label>Fitness <ConditionBar value={p.fitness} /></label>
          <label>Sharpness <ConditionBar value={p.sharpness} /></label>
          <label>Morale <ConditionBar value={p.morale} /></label>
          <label>Wellbeing <ConditionBar value={p.wellbeing} /></label>
        </div>
        <p className="muted small">Form: <FormDots form={p.form} /></p>

        <h2>Attributes</h2>
        <div className="attr-grid">
          {ATTRIBUTE_KEYS.filter((k) => p.position === 'GK' || k !== 'goalkeeping').map((k) => (
            <div key={k} className="attr">
              <span>{ATTR_LABELS[k]}</span>
              <b className={p.attributes[k] >= 70 ? 'good-text' : p.attributes[k] <= 45 ? 'bad-text' : ''}>{p.attributes[k]}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Season-by-season</h2>
        <table className="table compact">
          <thead><tr><th>Season</th><th>Club</th><th>Apps</th><th>G</th><th>A</th><th>Avg</th><th>MOTM</th></tr></thead>
          <tbody>
            {[...p.stats].sort((a, b) => b.season - a.season).map((s, i) => (
              <tr key={i}>
                <td>{s.season}</td>
                <td>{s.clubId >= 0 ? game.clubs[s.clubId]?.name ?? '—' : '—'}</td>
                <td>{s.apps}</td><td>{s.goals}</td><td>{s.assists}</td>
                <td>{s.apps ? (s.ratingSum / s.apps).toFixed(2) : '—'}</td>
                <td>{s.motm}</td>
              </tr>
            ))}
            {p.stats.length === 0 && <tr><td colSpan={7} className="muted">No appearances yet.</td></tr>}
          </tbody>
        </table>

        <h2>Actions</h2>
        {msg && <p className="action-msg">{msg}</p>}

        {isMine && (
          <>
            <div className="action-row">
              <button className="btn" onClick={() => { const wasListed = p.transferListed; setTransferListed(p.id, !wasListed); setMsg(wasListed ? 'Removed from the transfer list.' : 'Added to the transfer list. Expect offers — and a morale hit.'); }}>
                {p.transferListed ? 'Remove from transfer list' : 'Transfer list'}
              </button>
            </div>
            <div className="action-row">
              <input type="number" placeholder={`Wage (wants ~${formatMoney(wageDemand(ovr, p.age, userClub.reputation))})`} value={wage} onChange={(e) => setWage(e.target.value)} />
              <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} yr</option>)}
              </select>
              <button className="btn" disabled={!wage} onClick={() => act(renewContract(p.id, Number(wage), years), 'Contract signed!')}>
                Offer new contract
              </button>
            </div>
          </>
        )}

        {!isMine && !isFree && (
          <div className="action-row">
            <input type="number" placeholder={`Bid (valued ${formatMoney(value)})`} value={bid} onChange={(e) => setBid(e.target.value)} />
            <button className="btn primary" disabled={!bid || !windowOpen} onClick={() => act(bidForPlayer(p.id, Number(bid)), 'Bid submitted — expect a reply within a day or two.')}>
              Submit bid
            </button>
            {!windowOpen && <span className="muted small">Window closed</span>}
          </div>
        )}

        {isFree && (
          <div className="action-row">
            <input type="number" placeholder={`Wage (wants ~${formatMoney(freeDemand)})`} value={wage} onChange={(e) => setWage(e.target.value)} />
            <button className="btn primary" disabled={!wage} onClick={() => act(signFreeAgent(p.id, Number(wage)), 'Signed on a free!')}>
              Sign free agent
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
