import type { Player } from '@soccer-manager/engine/types';
import { overall, fullName, marketValue } from '@soccer-manager/engine/player';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K; dir: SortDir }

export type PlayerSortKey = 'name' | 'age' | 'ovr' | 'value' | 'wage';
export const PLAYER_SORT_DEFAULT_DIR: Record<PlayerSortKey, SortDir> = {
  name: 'asc', age: 'asc', ovr: 'desc', value: 'desc', wage: 'desc',
};

export function comparePlayers(a: Player, b: Player, sort: SortState<PlayerSortKey>, day: number): number {
  const cmp = sort.key === 'name' ? fullName(a).localeCompare(fullName(b))
    : sort.key === 'age' ? a.age - b.age
    : sort.key === 'value' ? marketValue(a, day) - marketValue(b, day)
    : sort.key === 'wage' ? a.contract.wage - b.contract.wage
    : overall(a) - overall(b);
  return sort.dir === 'asc' ? cmp : -cmp;
}

export function toggleSort<K extends string>(current: SortState<K>, key: K, defaultDir: SortDir): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: defaultDir };
}

export function SortTh<K extends string>({ sortKey, label, current, defaultDir, onSort }: {
  sortKey: K;
  label: string;
  current: SortState<K>;
  defaultDir: SortDir;
  onSort: (next: SortState<K>) => void;
}) {
  const active = current.key === sortKey;
  return (
    <th className={`sortable ${active ? 'sorted' : ''}`} onClick={() => onSort(toggleSort(current, sortKey, defaultDir))}>
      {label}{active && (current.dir === 'asc' ? ' ▲' : ' ▼')}
    </th>
  );
}
