import { describe, expect, it } from 'vitest';
import { overall } from '../src/player';
import { makePlayer, makeState } from './helpers';

describe('smoke', () => {
  it('resolves relative engine imports and computes an overall rating', () => {
    const p = makePlayer({ position: 'ST', attributes: { shooting: 80 } });
    expect(overall(p)).toBeGreaterThan(0);
  });

  it('generates a full world via the shared helper', () => {
    const state = makeState(1);
    expect(Object.keys(state.clubs).length).toBeGreaterThan(0);
    expect(state.userClubId).toBeGreaterThanOrEqual(0);
  });
});
