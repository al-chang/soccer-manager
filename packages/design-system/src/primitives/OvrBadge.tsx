import { ovrClass } from './ovrClass';

/** Coloured overall-rating chip. */
export function OvrBadge({ value }: { value: number }) {
  return <span className={ovrClass(value)}>{value}</span>;
}
