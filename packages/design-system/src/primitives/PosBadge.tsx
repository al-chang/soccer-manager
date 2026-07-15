/**
 * Position chip: shows `pos` verbatim (e.g. the detailed "LB") but colours
 * itself by `group` (one of the 4 pos-gk/df/mf/fw classes) so callers can pass
 * a detailed position without this engine-agnostic package knowing about the
 * detailed taxonomy. Falls back to `pos` itself when no group is given.
 */
export function PosBadge({ pos, group }: { pos: string; group?: string }) {
  return <span className={`pos pos-${(group ?? pos).toLowerCase()}`}>{pos}</span>;
}
