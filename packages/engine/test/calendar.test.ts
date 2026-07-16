import { describe, expect, it } from 'vitest';
import {
  MONTH_NAMES,
  YEAR_LENGTH,
  dayOfSeasonYear,
  dayToDate,
  formatDay,
  isTransferWindowOpen,
  windowName,
} from '../src/calendar';

describe('dayToDate', () => {
  it('day 0 is July 1 of startYear', () => {
    const d = dayToDate(0, 2025);
    expect(d.year).toBe(2025);
    expect(d.month).toBe(6); // 0-indexed: Jul
    expect(d.dayOfMonth).toBe(1);
  });

  it('rolls over into the next month correctly (July has 31 days)', () => {
    const d = dayToDate(30, 2025); // July 1 + 30 days = July 31
    expect(d.month).toBe(6);
    expect(d.dayOfMonth).toBe(31);
    const next = dayToDate(31, 2025); // August 1
    expect(next.month).toBe(7);
    expect(next.dayOfMonth).toBe(1);
  });

  it('rolls over into the next year after a full YEAR_LENGTH of days', () => {
    const d = dayToDate(YEAR_LENGTH, 2025);
    expect(d.year).toBe(2026);
    expect(d.month).toBe(6);
    expect(d.dayOfMonth).toBe(1);
  });
});

describe('formatDay', () => {
  it('renders using MONTH_NAMES', () => {
    expect(formatDay(0, 2025)).toBe(`1 ${MONTH_NAMES[6]} 2025`);
  });

  it('renders a mid-year date correctly', () => {
    // day 184 of season year = Jan 1 (see isTransferWindowOpen boundary tests)
    expect(formatDay(184, 2025)).toBe(`1 ${MONTH_NAMES[0]} 2026`);
  });
});

describe('dayOfSeasonYear', () => {
  it('is identity for values within [0, YEAR_LENGTH)', () => {
    expect(dayOfSeasonYear(0)).toBe(0);
    expect(dayOfSeasonYear(364)).toBe(364);
  });

  it('wraps values >= YEAR_LENGTH', () => {
    expect(dayOfSeasonYear(YEAR_LENGTH)).toBe(0);
    expect(dayOfSeasonYear(YEAR_LENGTH + 1)).toBe(1);
    expect(dayOfSeasonYear(YEAR_LENGTH * 2 + 5)).toBe(5);
  });

  it('wraps negative inputs into [0, YEAR_LENGTH)', () => {
    expect(dayOfSeasonYear(-1)).toBe(YEAR_LENGTH - 1);
    expect(dayOfSeasonYear(-YEAR_LENGTH)).toBe(0);
    expect(dayOfSeasonYear(-YEAR_LENGTH - 1)).toBe(YEAR_LENGTH - 1);
  });
});

describe('isTransferWindowOpen', () => {
  it('summer window is open at boundaries seasonDay 0 and 61', () => {
    expect(isTransferWindowOpen(0)).toBe(true);
    expect(isTransferWindowOpen(61)).toBe(true);
  });

  it('is closed just outside the summer window (seasonDay 62) and just before winter (seasonDay 183)', () => {
    expect(isTransferWindowOpen(62)).toBe(false);
    expect(isTransferWindowOpen(183)).toBe(false);
  });

  it('winter window is open at boundaries seasonDay 184 and 214', () => {
    expect(isTransferWindowOpen(184)).toBe(true);
    expect(isTransferWindowOpen(214)).toBe(true);
  });

  it('is closed just after the winter window (seasonDay 215)', () => {
    expect(isTransferWindowOpen(215)).toBe(false);
  });

  it('boundaries hold across year wraps (absolute day, not just season-year day)', () => {
    expect(isTransferWindowOpen(YEAR_LENGTH + 0)).toBe(true);
    expect(isTransferWindowOpen(YEAR_LENGTH + 61)).toBe(true);
    expect(isTransferWindowOpen(YEAR_LENGTH + 62)).toBe(false);
    expect(isTransferWindowOpen(YEAR_LENGTH + 184)).toBe(true);
    expect(isTransferWindowOpen(YEAR_LENGTH + 214)).toBe(true);
    expect(isTransferWindowOpen(YEAR_LENGTH + 215)).toBe(false);
  });
});

describe('windowName', () => {
  it("returns 'summer' at seasonDay 0 and 61", () => {
    expect(windowName(0)).toBe('summer');
    expect(windowName(61)).toBe('summer');
  });

  it('returns null just outside the summer window and just before winter', () => {
    expect(windowName(62)).toBeNull();
    expect(windowName(183)).toBeNull();
  });

  it("returns 'winter' at seasonDay 184 and 214", () => {
    expect(windowName(184)).toBe('winter');
    expect(windowName(214)).toBe('winter');
  });

  it('returns null just after the winter window', () => {
    expect(windowName(215)).toBeNull();
  });
});
