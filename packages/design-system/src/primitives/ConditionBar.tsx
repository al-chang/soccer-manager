/** Horizontal 0-100 condition meter (fitness/sharpness/morale/wellbeing). */
export function ConditionBar({ value, label }: { value: number; label?: string }) {
  const color = value >= 75 ? 'var(--green)' : value >= 50 ? 'var(--amber)' : 'var(--red)';
  return (
    <div className="cond" title={label ? `${label}: ${Math.round(value)}%` : `${Math.round(value)}%`}>
      <div className="cond-fill" style={{ width: `${value}%`, background: color }} />
    </div>
  );
}
