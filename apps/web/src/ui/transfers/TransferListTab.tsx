import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { overall, marketValue } from '@soccer-manager/engine/player';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { OvrBadge, PosBadge, formatMoney, PlayerLink, ClubLink } from '../common';
import { SortTh, comparePlayers, PLAYER_SORT_DEFAULT_DIR, type SortState, type PlayerSortKey } from './sortHeader';

export function TransferListTab() {
  const game = useGame();
  const [sort, setSort] = useState<SortState<PlayerSortKey>>({ key: 'value', dir: 'desc' });

  const listed = useMemo(() => (
    Object.values(game.players)
      .filter((p) => p.transferListed)
      .sort((a, b) => comparePlayers(a, b, sort, game.day))
  ), [game, sort]);

  const th = (key: PlayerSortKey, label: string) => (
    <SortTh sortKey={key} label={label} current={sort} defaultDir={PLAYER_SORT_DEFAULT_DIR[key]} onSort={setSort} />
  );

  return (
    <div>
      <p className="muted small">Every player listed for transfer across the league, right now.</p>
      <table className="table">
        <thead><tr><th>Pos</th>{th('name', 'Name')}{th('age', 'Age')}{th('ovr', 'Ovr')}<th>Club</th>{th('value', 'Value')}{th('wage', 'Wage')}</tr></thead>
        <tbody>
          {listed.map((p) => (
            <tr key={p.id}>
              <td><PosBadge pos={p.position} group={positionGroup(p.position)} /></td>
              <td><PlayerLink player={p} /></td>
              <td>{p.age}</td>
              <td><OvrBadge value={overall(p)} /></td>
              <td><ClubLink game={game} clubId={p.clubId} /></td>
              <td>{formatMoney(marketValue(p, game.day))}</td>
              <td>{formatMoney(p.contract.wage)}</td>
            </tr>
          ))}
          {listed.length === 0 && <tr><td colSpan={7} className="muted">No players are transfer-listed right now.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
