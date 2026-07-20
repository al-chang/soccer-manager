import { useState } from 'react';
import { useGame, useGameStore } from '../../store/gameStore';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';
import type { TransferOffer } from '@soccer-manager/engine/types';
import { OvrBadge, formatMoney, PlayerLink } from '../common';
import { NegotiationModal, Slider } from './NegotiationModal';

export function OffersTab() {
  const game = useGame();
  const respondToOffer = useGameStore((s) => s.respondToOffer);
  const [counters, setCounters] = useState<Record<number, number>>({});
  const [negotiating, setNegotiating] = useState<number | null>(null);

  const incoming = game.offers.filter((o) => o.toClubId === game.userClubId && o.status === 'pending');
  const outgoing = game.offers.filter((o) => o.fromClubId === game.userClubId &&
    (o.status === 'pending' || o.status === 'countered' || (o.status === 'accepted' && o.stage === 'contract') ||
      // Freshly dead deals linger a couple of days so the breakdown is seen.
      ((o.status === 'rejected' || o.status === 'withdrawn') && o.day >= game.day - 2)));

  const incomingRow = (o: TransferOffer) => {
    const player = game.players[o.playerId];
    if (!player) return null;
    const from = game.clubs[o.fromClubId];
    const swap = o.terms.swapPlayerId !== null ? game.players[o.terms.swapPlayerId] : null;
    const value = marketValue(player, game.day);
    const feeMax = Math.max(Math.round(value * 2), Math.round(o.terms.fee * 1.5), o.terms.fee + 100_000);
    const counter = counters[o.id] ?? Math.max(o.terms.fee, value);
    return (
      <div key={o.id} className="offer-card">
        <div>
          <b><PlayerLink player={player} /></b> <OvrBadge value={overall(player)} />
          <span className="muted"> · bid from {from.name}</span>
          <div className="muted small">
            Fee <b>{formatMoney(o.terms.fee)}</b> · valued {formatMoney(value)}
            {o.terms.sellOnPct > 0 && <> · {o.terms.sellOnPct}% sell-on</>}
            {swap && <> · + {fullName(swap)} ({overall(swap)})</>}
          </div>
        </div>
        <div className="offer-actions">
          <button className="btn primary" onClick={() => respondToOffer(o.id, 'accept')}>Accept</button>
          <button className="btn" onClick={() => respondToOffer(o.id, 'reject')}>Reject</button>
        </div>
        <div className="offer-counter">
          <Slider label="Counter fee" value={counter} min={o.terms.fee} max={feeMax}
            step={Math.max(1000, Math.round(feeMax / 200 / 1000) * 1000)}
            onChange={(v) => setCounters({ ...counters, [o.id]: v })} money />
          <button className="btn" disabled={counter <= o.terms.fee}
            onClick={() => respondToOffer(o.id, 'accept', counter)}>Counter at {formatMoney(counter)}</button>
        </div>
      </div>
    );
  };

  const outgoingRow = (o: TransferOffer) => {
    const player = game.players[o.playerId];
    if (!player) return null;
    const other = game.clubs[o.toClubId];
    const dead = o.status === 'rejected' || o.status === 'withdrawn';
    const label = dead ? 'Negotiations broke down'
      : o.stage === 'contract' ? (o.contractOffer ? "Awaiting his agent's answer" : 'Fee agreed — personal terms next')
      : o.status === 'countered' ? 'They countered'
      : 'Awaiting their response';
    // Actionable states get the primary button; waiting/dead ones just a view.
    const actionable = !dead && (o.status === 'countered' || (o.stage === 'contract' && !o.contractOffer));
    const buttonLabel = dead ? 'View'
      : o.stage === 'contract' ? (o.contractOffer ? 'View' : 'Agree terms')
      : o.status === 'countered' ? 'Respond' : 'View bid';
    return (
      <div key={o.id} className={`offer-card ${dead ? 'offer-dead' : ''}`}>
        <div>
          <b><PlayerLink player={player} /></b> <OvrBadge value={overall(player)} />
          <span className="muted"> · your bid to {other?.name ?? 'free agency'}</span>
          <div className="muted small">
            {o.stage === 'contract' ? 'Fee agreed' : 'Fee'} <b>{formatMoney(o.terms.fee)}</b> · valued {formatMoney(marketValue(player, game.day))}
            {o.status === 'countered' && o.counterTerms && <> · they want <b>{formatMoney(o.counterTerms.fee)}</b></>}
            {' · '}<span className={dead ? 'bad-text' : 'muted'}>{label}</span>
          </div>
        </div>
        <div className="offer-actions">
          <button className={`btn ${actionable ? 'primary' : ''}`} onClick={() => setNegotiating(o.id)}>
            {buttonLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <h2>Incoming bids</h2>
      {incoming.length === 0 && <p className="muted">No clubs are bidding for your players right now.</p>}
      {incoming.map(incomingRow)}
      <h2>Your negotiations</h2>
      {outgoing.length === 0 && <p className="muted">You have no active bids. Find targets in Player search.</p>}
      {outgoing.map(outgoingRow)}
      {negotiating !== null && (
        <NegotiationModal offerId={negotiating} onClose={() => setNegotiating(null)} />
      )}
    </div>
  );
}
