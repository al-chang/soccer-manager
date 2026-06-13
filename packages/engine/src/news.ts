import type { GameState, NewsCategory } from './types';

/**
 * Add a news item. Items where `forUser` is false are dropped to keep the
 * inbox focused — flip this to store league-wide news later.
 */
export function addNews(state: GameState, category: NewsCategory, title: string, body: string, forUser = true): void {
  if (!forUser) return;
  state.news.unshift({
    id: state.nextId++,
    day: state.day,
    category,
    title,
    body,
    read: false,
  });
  if (state.news.length > 200) state.news.length = 200;
}

export function unreadCount(state: GameState): number {
  return state.news.filter((n) => !n.read).length;
}
