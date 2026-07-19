import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';
import { POSITIONS, positionGroup } from '@soccer-manager/engine/tactics';
import { clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { YEAR_LENGTH } from '@soccer-manager/engine/calendar';
import type { Position, PositionGroup } from '@soccer-manager/engine/types';
import { OvrBadge, PosBadge, formatMoney, PlayerLink, ClubLink } from '../common';
import { SortTh, comparePlayers, PLAYER_SORT_DEFAULT_DIR, type SortState, type PlayerSortKey } from './sortHeader';

type PosFilter = Position | PositionGroup | 'ANY';
const RESULT_CAP = 60;

const GROUP_ORDER: PositionGroup[] = ['GK', 'DF', 'MF', 'FW'];
const GROUP_LABELS: Record<PositionGroup, string> = { GK: 'Goalkeeper', DF: 'Defense', MF: 'Midfield', FW: 'Forward' };
const POSITIONS_BY_GROUP: Record<PositionGroup, Position[]> = { GK: [], DF: [], MF: [], FW: [] };
for (const p of POSITIONS) POSITIONS_BY_GROUP[positionGroup(p)].push(p);

export function SearchTab() {
  const game = useGame();
  const [pos, setPos] = useState<PosFilter>('ANY');
  const [query, setQuery] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [maxWage, setMaxWage] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [listedOnly, setListedOnly] = useState(false);
  const [sort, setSort] = useState<SortState<PlayerSortKey>>({ key: 'ovr', dir: 'desc' });
  const userClub = game.clubs[game.userClubId];
  const wageRoom = userClub.wageBudget - totalWages(clubPlayers(game, userClub.id));

  const { shown, total } = useMemo(() => {
    const q = query.toLowerCase();
    const matches = Object.values(game.players)
      .filter((p) => p.clubId !== game.userClubId && p.clubId !== -1)
      .filter((p) => pos === 'ANY' || p.position === pos || positionGroup(p.position) === pos)
      .filter((p) => !q || fullName(p).toLowerCase().includes(q))
      .filter((p) => !maxValue || marketValue(p, game.day) <= Number(maxValue) * 1_000_000)
      .filter((p) => !maxAge || p.age <= Number(maxAge))
      .filter((p) => !maxWage || p.contract.wage <= Number(maxWage) * 1000)
      .filter((p) => !expiringOnly || p.contract.expiresDay <= game.day + YEAR_LENGTH)
      .filter((p) => !listedOnly || p.transferListed)
      .sort((a, b) => comparePlayers(a, b, sort, game.day));
    return { shown: matches.slice(0, RESULT_CAP), total: matches.length };
  }, [game, pos, query, maxValue, maxAge, maxWage, expiringOnly, listedOnly, sort]);

  const th = (key: PlayerSortKey, label: string) => (
    <SortTh sortKey={key} label={label} current={sort} defaultDir={PLAYER_SORT_DEFAULT_DIR[key]} onSort={setSort} />
  );

  return (
    <div>
      <div className="head-controls">
        <input placeholder="Search name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={pos} onChange={(e) => setPos(e.target.value as PosFilter)}>
          <option value="ANY">Any position</option>
          {GROUP_ORDER.map((g) => (
            <optgroup key={g} label={GROUP_LABELS[g]}>
              <option value={g}>{g} (any)</option>
              {POSITIONS_BY_GROUP[g].filter((p) => p !== g).map((p) => <option key={p} value={p}>{p}</option>)}
            </optgroup>
          ))}
        </select>
        <input type="number" placeholder="Max value (£M)" value={maxValue} onChange={(e) => setMaxValue(e.target.value)} />
        <input type="number" placeholder="Max age" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        <input type="number" placeholder="Max wage (£K/wk)" value={maxWage} onChange={(e) => setMaxWage(e.target.value)} />
        <label className="inline">
          <input type="checkbox" checked={expiringOnly} onChange={(e) => setExpiringOnly(e.target.checked)} />
          Contract expiring soon
        </label>
        <label className="inline">
          <input type="checkbox" checked={listedOnly} onChange={(e) => setListedOnly(e.target.checked)} />
          Transfer-listed only
        </label>
      </div>
      <div className="head-controls">
        <span className="muted small">Budget: {formatMoney(userClub.budget)}</span>
        <span className="muted small">
          Wage room: {wageRoom > 0
            ? <b>{formatMoney(wageRoom)}/wk</b>
            : <b className="bad-text">{formatMoney(-wageRoom)}/wk over cap</b>}
        </span>
        <span className="muted small">Showing {shown.length} of {total}</span>
      </div>
      <table className="table">
        <thead><tr><th>Pos</th>{th('name', 'Name')}{th('age', 'Age')}{th('ovr', 'Ovr')}<th>Club</th>{th('value', 'Value')}{th('wage', 'Wage')}<th></th></tr></thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.id}>
              <td><PosBadge pos={p.position} group={positionGroup(p.position)} /></td>
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
