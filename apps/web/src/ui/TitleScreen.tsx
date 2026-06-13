import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { ThemeToggle } from './ThemeToggle';

/** Shown only when no saved career exists (boot resumes saves directly). */
export function TitleScreen() {
  const newGame = useGameStore((s) => s.newGame);
  const loading = useGameStore((s) => s.loading);
  const [name, setName] = useState('My Career');

  if (loading) {
    return <div className="title-screen"><h1>⚽ Touchline</h1><p className="muted">Loading…</p></div>;
  }

  return (
    <div className="title-screen">
      <div className="title-theme"><ThemeToggle /></div>
      <h1>⚽ Touchline</h1>
      <p className="tagline">A football management simulator that lives entirely in your browser.</p>
      <div className="title-card">
        <label>
          Career name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
        </label>
        <button className="btn primary big" onClick={() => newGame(name)}>Start New Career</button>
      </div>
      <p className="muted small">Everything is generated and saved locally — no account, no server.</p>
    </div>
  );
}
