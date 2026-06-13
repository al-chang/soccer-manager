import { useEffect, useRef } from 'react';
import { useGameStore, type Screen } from './gameStore';

// Screens that can appear in the URL. 'match' is intentionally excluded — a
// match is a forced full-screen takeover driven by the sim, not a place the
// Back button should land, so it never gets its own history entry.
const URL_SCREENS: Screen[] = [
  'title', 'team-select', 'home', 'squad', 'player', 'tactics',
  'transfers', 'fixtures', 'table', 'inbox', 'club', 'history',
];

/** The hash that represents a given navigation state. */
function targetHash(screen: Screen, playerId: number | null, clubId: number | null): string {
  if (screen === 'player') return playerId != null ? `#player/${playerId}` : '#player';
  if (screen === 'club') return clubId != null ? `#club/${clubId}` : '#club';
  return `#${screen}`;
}

/** Apply a hash (from Back/Forward) back onto the store. */
function applyHash(hash: string): void {
  const store = useGameStore.getState();
  if (!store.game) return;
  const [name, idStr] = hash.replace(/^#/, '').split('/');
  const id = idStr ? Number(idStr) : null;
  if (name === 'player' && id != null && store.game.players[id]) return store.viewPlayer(id);
  if (name === 'club' && id != null && store.game.clubs[id]) return store.viewClub(id);
  if ((URL_SCREENS as string[]).includes(name)) return store.setScreen(name as Screen);
  store.setScreen('home');
}

/**
 * Keeps the browser history in sync with the store's navigation state so the
 * Back/Forward buttons move between in-app views instead of leaving the page.
 *
 * Store → URL: each navigation pushes a history entry (pre-game title/select
 * screens replace instead, so they don't clutter the Back stack).
 * URL → store: popstate re-applies the hash. Because popstate updates the hash
 * before we read it, the store→URL effect then sees the hashes already match
 * and skips pushing — so there's no feedback loop.
 */
export function useHistorySync(): void {
  const screen = useGameStore((s) => s.screen);
  const playerId = useGameStore((s) => s.selectedPlayerId);
  const clubId = useGameStore((s) => s.selectedClubId);
  const prevScreen = useRef<Screen | null>(null);

  useEffect(() => {
    if (screen === 'match') return; // matches stay out of history
    const target = targetHash(screen, playerId, clubId);
    if (decodeURIComponent(window.location.hash || '') !== target) {
      const transient = prevScreen.current === null
        || prevScreen.current === 'title' || prevScreen.current === 'team-select';
      if (transient) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
    }
    prevScreen.current = screen;
  }, [screen, playerId, clubId]);

  useEffect(() => {
    const onPop = () => applyHash(window.location.hash);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
