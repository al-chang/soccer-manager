/** Position chip (GK/DF/MF/FW), coloured per position. */
export function PosBadge({ pos }: { pos: string }) {
  return <span className={`pos pos-${pos.toLowerCase()}`}>{pos}</span>;
}
