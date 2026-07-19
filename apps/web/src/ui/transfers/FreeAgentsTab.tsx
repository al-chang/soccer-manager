import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { overall, marketValue } from '@soccer-manager/engine/player';
import { positionGroup } from '@soccer-manager/engine/tactics';
import { OvrBadge, PosBadge, formatMoney, PlayerLink } from '../common';
import { SortTh, comparePlayers, PLAYER_SORT_DEFAULT_DIR, type SortState, type PlayerSortKey } from './sortHeader';

export function FreeAgentsTab() {
  const game = useGame();
  const [sort, setSort] = useState<SortState<PlayerSortKey>>({ key: 'ovr', dir: 'desc' });

  const free = useMemo(() => (
    Object.values(game.players)
      .filter((p) => p.clubId === -1 && !p.retiring)
      .sort((a, b) => comparePlayers(a, b, sort, game.day))
  ), [game, sort]);

  const th = (key: PlayerSortKey, label: string) => (
    <SortTh sortKey={key} label={label} current={sort} defaultDir={PLAYER_SORT_DEFAULT_DIR[key]} onSort={setSort} />
  );

  return (
    <table className="table">
      <thead><tr><th>Pos</th>{th('name', 'Name')}{th('age', 'Age')}{th('ovr', 'Ovr')}<th>Nation</th>{th('value', 'Value')}{th('wage', 'Wage demand')}</tr></thead>
      <tbody>
        {free.map((p) => (
          <tr key={p.id}>
            <td><PosBadge pos={p.position} group={positionGroup(p.position)} /></td>
            <td><PlayerLink player={p} /></td>
            <td>{p.age}</td>
            <td><OvrBadge value={overall(p)} /></td>
            <td>{game.nations[p.nationId].name}</td>
            <td>{formatMoney(marketValue(p, game.day))}</td>
            <td>{formatMoney(p.contract.wage)}</td>
          </tr>
        ))}
        {free.length === 0 && <tr><td colSpan={7} className="muted">No free agents available.</td></tr>}
      </tbody>
    </table>
  );
}
