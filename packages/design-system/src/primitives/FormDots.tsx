/** Recent-form indicator: one coloured dot per recent match rating. */
export function FormDots({ form }: { form: number[] }) {
  if (!form.length) return <span className="muted">—</span>;
  return (
    <span className="form-dots">
      {form.map((r, i) => (
        <span
          key={i}
          className="form-dot"
          style={{ background: r >= 7.5 ? 'var(--green)' : r >= 6.2 ? 'var(--amber)' : 'var(--red)' }}
          title={r.toFixed(1)}
        />
      ))}
    </span>
  );
}
