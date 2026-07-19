import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { isTransferWindowOpen } from '@soccer-manager/engine/calendar';
import { OffersTab } from './transfers/OffersTab';
import { SearchTab } from './transfers/SearchTab';
import { FreeAgentsTab } from './transfers/FreeAgentsTab';
import { HistoryTab } from './transfers/HistoryTab';
import { TransferListTab } from './transfers/TransferListTab';

type Tab = 'search' | 'offers' | 'free' | 'history' | 'listed';

export function TransfersScreen() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('offers');
  const windowOpen = isTransferWindowOpen(game.day);

  const liveOffers = game.offers.filter((o) =>
    (o.userInvolved || o.fromClubId === game.userClubId || o.toClubId === game.userClubId) &&
    o.status !== 'completed' && o.status !== 'withdrawn' && o.status !== 'rejected');
  const listedCount = Object.values(game.players).filter((p) => p.transferListed).length;

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
        <button className={`tab ${tab === 'listed' ? 'active' : ''}`} onClick={() => setTab('listed')}>
          Transfer list {listedCount > 0 && <span className="badge">{listedCount}</span>}
        </button>
        <button className={`tab ${tab === 'free' ? 'active' : ''}`} onClick={() => setTab('free')}>Free agents</button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>History</button>
      </div>
      {tab === 'offers' && <OffersTab />}
      {tab === 'search' && <SearchTab />}
      {tab === 'listed' && <TransferListTab />}
      {tab === 'free' && <FreeAgentsTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
