import { useMemo, useState } from 'react';
import { useGame, useGameStore } from '../store/gameStore';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';
import { formatDay, isTransferWindowOpen } from '@soccer-manager/engine/calendar';
import type { Position, TransferOffer } from '@soccer-manager/engine/types';
import { OvrBadge, PosBadge, formatMoney, PlayerLink, ClubLink } from './common';

type Tab = 'search' | 'offers' | 'free' | 'history';

export function TransfersScreen() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('offers');
  const windowOpen = isTransferWindowOpen(game.day);

  const liveOffers = game.offers.filter((o) =>
    (o.userInvolved || o.fromClubId === game.userClubId || o.toClubId === game.userClubId) &&
    o.status !== 'completed' && o.status !== 'withdrawn' && o.status !== 'rejected');

  return (
    <div>
      <div className="screen-head">
        <h1>Transfers</h1>
        <span className={`window-pill ${windowOpen ? 'open' : ''}`}>{windowOpen ? 'Window open' : 'Window closed'}</span>
      </div>
      <div className="league-tabs">
        <button className={`tab ${tab === 'offers' ? 'active' : ''}`} onClick={() => setTab('offers')}>
          Negotiations {liveOffers.length > 0 && <span className="badge">{liveOffers.length}</span>}
        </button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Player search</button>
        <button className={`tab ${tab === 'free' ? 'active' : ''}`} onClick={() => setTab('free')}>Free agents</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
      </div>
      {tab === 'offers' && <OffersTab />}
      {tab === 'search' && <SearchTab />}
      {tab === 'free' && <FreeAgentsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

function OffersTab() {
  const game = useGame();
  const respondToOffer = useGameStore((s) => s.respondToOffer);
  const acceptCounter = useGameStore((s) => s.acceptCounter);
  const withdrawOffer = useGameStore((s) => s.withdrawOffer);
  const offerContract = useGameStore((s) => s.offerContract);
  const [counters, setCounters] = useState<Record<number, string>>({});
  const [wages, setWages] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const incoming = game.offers.filter((o) => o.toClubId === game.userClubId && o.status === 'pending');
  const outgoing = game.offers.filter((o) => o.fromClubId === game.userClubId &&
    (o.status === 'pending' || o.status === 'countered' || (o.status === 'accepted' && o.stage === 'contract')));

  const offerRow = (o: TransferOffer, incoming: boolean) => {
    const player = game.players[o.playerId];
    if (!player) return null;
    const other = game.clubs[incoming ? o.fromClubId : o.toClubId];
    return (
      <div key={o.id} className="offer-card">
        <div>
          <b><PlayerLink player={player} /></b> <OvrBadge value={overall(player)} />
          <span className="muted"> · {incoming ? `bid from ${other.name}` : `your bid to ${other?.name ?? 'free agency'}`}</span>
          <div className="muted small">Fee: <b>{formatMoney(o.fee)}</b> · valued {formatMoney(marketValue(player, game.day))}
            {o.status === 'countered' && o.counterFee !== null && <> · they want <b>{formatMoney(o.counterFee)}</b></>}
          </div>
        </div>
        <div className="offer-actions">
          {incoming && (
            <>
              <button className="btn primary" onClick={() => respondToOffer(o.id, 'accept')}>Accept</button>
              <button className="btn" onClick={() => respondToOffer(o.id, 'reject')}>Reject</button>
              <input type="number" placeholder="Counter fee" value={counters[o.id] ?? ''}
                onChange={(e) => setCounters({ ...counters, [o.id]: e.target.value })} />
              <button className="btn" disabled={!counters[o.id]}
                onClick={() => respondToOffer(o.id, 'accept', Number(counters[o.id]))}>Counter</button>
            </>
          )}
          {!incoming && o.status === 'countered' && (
            <>
              <button className="btn primary" onClick={() => acceptCounter(o.id)}>Accept counter</button>
              <button className="btn" onClick={() => withdrawOffer(o.id)}>Walk away</button>
            </>
          )}
          {!incoming && o.status === 'accepted' && o.stage === 'contract' && o.wageDemand !== null && (
            <>
              <span className="muted small">Fee agreed! He wants {formatMoney(o.wageDemand)}/wk:</span>
              <input type="number" placeholder="Weekly wage" value={wages[o.id] ?? ''}
                onChange={(e) => setWages({ ...wages, [o.id]: e.target.value })} />
              <button className="btn primary" disabled={!wages[o.id]}
                onClick={() => setMsg(offerContract(o.id, Number(wages[o.id])) ?? `${fullName(player)} signed!`)}>
                Offer contract
              </button>
              <button className="btn" onClick={() => withdrawOffer(o.id)}>Cancel deal</button>
            </>
          )}
          {!incoming && o.status === 'pending' && (
            <>
              <span className="muted small">Awaiting response…</span>
              <button className="btn" onClick={() => withdrawOffer(o.id)}>Withdraw</button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {msg && <p className="action-msg">{msg}</p>}
      <h2>Incoming bids</h2>
      {incoming.length === 0 && <p className="muted">No clubs are bidding for your players right now.</p>}
      {incoming.map((o) => offerRow(o, true))}
      <h2>Your negotiations</h2>
      {outgoing.length === 0 && <p className="muted">You have no active bids. Find targets in Player search.</p>}
      {outgoing.map((o) => offerRow(o, false))}
    </div>
  );
}

function SearchTab() {
  const game = useGame();
  const [pos, setPos] = useState<Position | 'ANY'>('ANY');
  const [query, setQuery] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const userClub = game.clubs[game.userClubId];

  const results = useMemo(() => {
    const q = query.toLowerCase();
    return Object.values(game.players)
      .filter((p) => p.clubId !== game.userClubId && p.clubId !== -1)
      .filter((p) => pos === 'ANY' || p.position === pos)
      .filter((p) => !q || fullName(p).toLowerCase().includes(q))
      .filter((p) => !maxValue || marketValue(p, game.day) <= Number(maxValue) * 1_000_000)
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, 60);
  }, [game, pos, query, maxValue]);

  return (
    <div>
      <div className="head-controls">
        <input placeholder="Search name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={pos} onChange={(e) => setPos(e.target.value as Position | 'ANY')}>
          <option value="ANY">Any position</option>
          <option value="GK">GK</option><option value="DF">DF</option>
          <option value="MF">MF</option><option value="FW">FW</option>
        </select>
        <input type="number" placeholder="Max value (£M)" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
        <span className="muted small">Budget: {formatMoney(userClub.budget)}</span>
      </div>
      <table className="table">
        <thead><tr><th>Pos</th><th>Name</th><th>Age</th><th>Ovr</th><th>Club</th><th>Value</th><th>Wage</th><th></th></tr></thead>
        <tbody>
          {results.map((p) => (
            <tr key={p.id}>
              <td><PosBadge pos={p.position} /></td>
              <td><PlayerLink player={p} /></td>
              <td>{p.age}</td>
              <td><OvrBadge value={overall(p)} /></td>
              <td><ClubLink game={game} clubId={p.clubId} /></td>
              <td>{formatMoney(marketValue(p, game.day))}</td>
              <td>{formatMoney(p.contract.wage)}</td>
              <td>{p.transferListed && <span className="muted small">📋 listed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Open a player to make a bid. AI clubs value players by ability, age, potential and contract length — and their managers' personalities set how hard they negotiate.</p>
    </div>
  );
}

function FreeAgentsTab() {
  const game = useGame();
  const free = Object.values(game.players)
    .filter((p) => p.clubId === -1 && !p.retiring)
    .sort((a, b) => overall(b) - overall(a));
  return (
    <table className="table">
      <thead><tr><th>Pos</th><th>Name</th><th>Age</th><th>Ovr</th><th>Nation</th></tr></thead>
      <tbody>
        {free.map((p) => (
          <tr key={p.id}>
            <td><PosBadge pos={p.position} /></td>
            <td><PlayerLink player={p} /></td>
            <td>{p.age}</td>
            <td><OvrBadge value={overall(p)} /></td>
            <td>{game.nations[p.nationId].name}</td>
          </tr>
        ))}
        {free.length === 0 && <tr><td colSpan={5} className="muted">No free agents available.</td></tr>}
      </tbody>
    </table>
  );
}

function HistoryTab() {
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
