import { useState } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { overall, fullName, marketValue, wageDemand, ATTRIBUTE_KEYS } from '@soccer-manager/engine/player';
import type { Player } from '@soccer-manager/engine/types';
import { formatDay, isTransferWindowOpen } from '@soccer-manager/engine/calendar';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { OvrBadge, PosBadge, ConditionBar, FormDots, formatMoney, statusFlags, ClubLink, contractExpiringSoon } from './common';
import { BidModal, RenewalModal, Slider } from './transfers/NegotiationModal';

const ATTR_LABELS: Record<string, string> = {
  pace: 'Pace', strength: 'Strength', stamina: 'Stamina', passing: 'Passing', shooting: 'Shooting',
  dribbling: 'Dribbling', defending: 'Defending', goalkeeping: 'Goalkeeping', vision: 'Vision',
  composure: 'Composure', workRate: 'Work rate',
};

export function PlayerScreen() {
  const game = useGame();
  const id = useGameStore((s) => s.selectedPlayerId);
  const setTransferListed = useGameStore((s) => s.setTransferListed);
  const [msg, setMsg] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);

  const p = id !== null ? game.players[id] : null;
  if (!p) return <p className="muted">Player not found (he may have retired).</p>;

  const ovr = overall(p);
  const value = marketValue(p, game.day);
  const isMine = p.clubId === game.userClubId;
  const isFree = p.clubId === -1;
  const userClub = game.clubs[game.userClubId];
  const windowOpen = isTransferWindowOpen(game.day);
  const freeDemand = wageDemand(ovr, p.age, userClub.reputation);
  const expiringSoon = contractExpiringSoon(p, game.day);
  const onCooldown = p.renewalCooldownDay !== undefined && game.day < p.renewalCooldownDay;

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
          <span>Wage: <b>{formatMoney(p.contract.wage)}/wk</b>{!isFree && <> until <span className={expiringSoon ? 'warn' : ''}>{formatDay(p.contract.expiresDay, game.startYear)}</span></>}</span>
          {p.potential > ovr && p.age <= 23 && <span className="muted">Scouts see room to grow.</span>}
          {isMine && expiringSoon && <span className="warn">⚠ Contract expiring — renew or risk losing him on a free.</span>}
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
              <button className="btn" disabled={onCooldown} onClick={() => setRenewing(true)}>
                Offer new contract
              </button>
              {onCooldown && p.renewalCooldownDay !== undefined && (
                <span className="muted small">Won't reopen talks until {formatDay(p.renewalCooldownDay, game.startYear)}.</span>
              )}
            </div>
          </>
        )}

        {!isMine && !isFree && <BidActions key={p.id} player={p} windowOpen={windowOpen} />}

        {isFree && <FreeAgentForm key={p.id} player={p} demand={freeDemand} onResult={act} />}
      </section>
      {renewing && <RenewalModal playerId={p.id} onClose={() => setRenewing(false)} />}
    </div>
  );
}

function BidActions({ player, windowOpen }: { player: Player; windowOpen: boolean }) {
  const game = useGame();
  const [bidding, setBidding] = useState(false);
  const liveBid = game.offers.some((o) => o.playerId === player.id && o.fromClubId === game.userClubId &&
    (o.status === 'pending' || o.status === 'countered' || (o.status === 'accepted' && o.stage === 'contract')));

  return (
    <div className="action-row">
      <button className="btn primary" disabled={!windowOpen || liveBid} onClick={() => setBidding(true)}>
        Make a bid
      </button>
      {liveBid && <span className="muted small">Bid active — track it under Transfers → Offers.</span>}
      {!windowOpen && <span className="muted small">Window closed</span>}
      {bidding && <BidModal playerId={player.id} onClose={() => setBidding(false)} />}
    </div>
  );
}

function FreeAgentForm({ player, demand, onResult }: {
  player: Player;
  demand: number;
  onResult: (result: string | null, successMsg: string) => void;
}) {
  const signFreeAgent = useGameStore((s) => s.signFreeAgent);
  const [wage, setWage] = useState(demand);
  const wageMax = Math.max(Math.round(demand * 2), 5_000);

  return (
    <div className="bid-form">
      <Slider label={`Wage (wants ~${formatMoney(demand)}/wk)`} value={wage} min={0} max={wageMax}
        step={Math.max(100, Math.round(wageMax / 200 / 100) * 100)} onChange={setWage} money suffix="/wk" />
      <div className="action-row">
        <button className="btn primary" disabled={wage <= 0}
          onClick={() => onResult(signFreeAgent(player.id, wage), 'Signed on a free!')}>
          Sign free agent
        </button>
      </div>
    </div>
  );
}
