import { useEffect, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { useGame, useGameStore } from '../store/gameStore';
import { FORMATIONS, MENTALITIES } from '../engine/tactics';
import { overall, fullName } from '../engine/player';
import { formatDay } from '../engine/calendar';
import type { LiveMatch, MatchSide, Mentality, PressingLevel, TempoLevel } from '../engine/types';
import { PitchView, PlayerChip, parseSlotDropId, type PitchToken } from './PitchView';
import { DraggablePlayerRow } from './PlayerRow';
import { PlayerModal } from './PlayerModal';
import { OvrBadge, PosBadge } from './common';
import { LineupEditor } from './LineupEditor';

type Speed = 'paused' | 'normal' | 'fast';

export function MatchScreen() {
  const game = useGame();
  const pendingFixtureId = useGameStore((s) => s.pendingFixtureId);
  const match = game.liveMatch;

  if (!match && pendingFixtureId != null) return <PreMatch fixtureId={pendingFixtureId} />;
  if (match) return <LiveView match={match} />;
  return <p className="muted">No match in progress.</p>;
}

function PreMatch({ fixtureId }: { fixtureId: number }) {
  const game = useGame();
  const kickOff = useGameStore((s) => s.kickOff);
  const fixture = game.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) return <p className="muted">Fixture not found.</p>;
  const home = game.clubs[fixture.homeClubId];
  const away = game.clubs[fixture.awayClubId];
  const league = game.leagues.find((l) => l.id === fixture.leagueId)!;
  const userClub = game.clubs[game.userClubId];

  return (
    <div className="prematch">
      <h1>Match day</h1>
      <div className="scoreboard big">
        <span className="team-name">{home.name}</span>
        <span className="score">vs</span>
        <span className="team-name">{away.name}</span>
      </div>
      <p className="muted center">{league.name} · Round {fixture.round} · {formatDay(fixture.day, game.startYear)}</p>
      <div className="prematch-bar">
        <span className="muted">{userClub.tactics.formation}, {userClub.tactics.mentality.replace('-', ' ')} — set your team below, then:</span>
        <button className="btn primary big" onClick={kickOff}>Kick off ▶</button>
      </div>
      <LineupEditor />
      <p className="muted small center">Unavailable players left in your XI are replaced automatically at kickoff.</p>
    </div>
  );
}

function LiveView({ match }: { match: LiveMatch }) {
  const game = useGame();
  const tickMatch = useGameStore((s) => s.tickMatch);
  const concludeMatch = useGameStore((s) => s.concludeMatch);
  const setUserMatchTactics = useGameStore((s) => s.setUserMatchTactics);
  const substitute = useGameStore((s) => s.substitute);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [modalId, setModalId] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const justDragged = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const home = game.clubs[match.home.clubId];
  const away = game.clubs[match.away.clubId];
  const isHome = match.home.clubId === game.userClubId;
  const userSide = isHome ? match.home : match.away;

  useEffect(() => {
    if (match.finished || speed === 'paused') return;
    const interval = setInterval(() => tickMatch(1), speed === 'normal' ? 350 : 80);
    return () => clearInterval(interval);
  }, [speed, match.finished, tickMatch]);

  const totalTicks = match.home.possessionTicks + match.away.possessionTicks;
  const homePoss = totalTicks ? Math.round((match.home.possessionTicks / totalTicks) * 100) : 50;

  // Pitch tokens for the user's side: chip shows live match rating.
  const slots = FORMATIONS[userSide.tactics.formation];
  const tokens: (PitchToken | null)[] = slots.map((pos, slot) => {
    const mp = userSide.players.find((m) => m.onPitch && !m.sentOff && m.slot === slot);
    if (!mp) return null;
    const p = game.players[mp.playerId];
    return {
      playerId: p.id,
      label: p.lastName,
      chipText: mp.rating.toFixed(1),
      ovr: overall(p),
      position: p.position,
      warn: mp.fatigue > 45 || p.position !== pos,
      status: `${mp.goals > 0 ? '⚽' : ''}${mp.yellow ? '🟨' : ''}`,
      draggable: false,
    };
  });

  const bench = userSide.players.filter((m) => !m.onPitch && !m.sentOff && !m.injured && m.fatigue === 0 && m.slot === -1);
  const subsLeft = 5 - userSide.subsUsed;

  const openModal = (id: number) => {
    if (justDragged.current) return;
    setModalId(id);
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId((e.active.data.current?.playerId as number | undefined) ?? null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const draggedId = e.active.data.current?.playerId as number | undefined;
    if (draggedId === undefined || !e.over || match.finished || subsLeft <= 0) return;
    const slot = parseSlotDropId(String(e.over.id));
    if (slot === null) return;
    const out = userSide.players.find((m) => m.onPitch && !m.sentOff && m.slot === slot);
    const isBench = bench.some((m) => m.playerId === draggedId);
    if (!out || !isBench) return;
    substitute(out.playerId, draggedId);
  };

  const activePlayer = activeDragId !== null ? game.players[activeDragId] : null;

  return (
    <div className="match-live">
      <div className="scoreboard big">
        <span className="team-name" style={{ color: home.colors[0] }}>{home.name}</span>
        <span className="score">{match.home.goals} – {match.away.goals}</span>
        <span className="team-name" style={{ color: away.colors[0] }}>{away.name}</span>
      </div>
      <div className="match-clock">
        {match.finished ? 'Full time' : `${match.minute}'`}
        {!match.finished && (
          <span className="speed-controls">
            <button className={`btn small ${speed === 'paused' ? 'active' : ''}`} onClick={() => setSpeed('paused')}>⏸</button>
            <button className={`btn small ${speed === 'normal' ? 'active' : ''}`} onClick={() => setSpeed('normal')}>▶</button>
            <button className={`btn small ${speed === 'fast' ? 'active' : ''}`} onClick={() => setSpeed('fast')}>⏩</button>
            <button className="btn small" onClick={() => tickMatch(120)}>Sim to end</button>
          </span>
        )}
        {match.finished && <button className="btn primary" onClick={concludeMatch}>Continue ▶</button>}
      </div>

      <div className="match-stats">
        <span>{match.home.shots} ({match.home.onTarget}) shots</span>
        <div className="poss-bar"><div style={{ width: `${homePoss}%`, background: home.colors[0] }} /><div style={{ width: `${100 - homePoss}%`, background: away.colors[0] }} /></div>
        <span>{match.away.shots} ({match.away.onTarget}) shots</span>
      </div>
      <p className="muted small center">Possession {homePoss}% – {100 - homePoss}%</p>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="match-grid three">
          <section className="card events-card">
            <h2>Commentary</h2>
            <ul className="event-feed">
              {[...match.events].reverse().map((e, i) => (
                <li key={i} className={`event-${e.type}`}>
                  <span className="event-min">{e.minute}'</span> {e.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="card pitch-card">
            <h2>Your team <span className="muted small">(chips show match rating)</span></h2>
            <PitchView
              formation={userSide.tactics.formation}
              tokens={tokens}
              dnd={!match.finished && subsLeft > 0}
              onTokenClick={openModal}
            />
            <h3>Bench — drag onto a player to substitute ({subsLeft} left)</h3>
            <ul className="player-rows">
              {bench.map((m) => {
                const p = game.players[m.playerId];
                return (
                  <DraggablePlayerRow
                    key={m.playerId}
                    playerId={m.playerId}
                    draggable={!match.finished && subsLeft > 0}
                    droppable={false}
                    onClick={() => openModal(m.playerId)}
                  >
                    <PosBadge pos={p.position} />
                    <span className="player-row-name">{fullName(p)}</span>
                    <OvrBadge value={overall(p)} />
                  </DraggablePlayerRow>
                );
              })}
              {bench.length === 0 && <li className="muted small">No substitutes available.</li>}
            </ul>
          </section>

          <section className="card">
            <h2>Touchline</h2>
            <div className="tactic-controls">
              <label>
                Mentality
                <select value={userSide.tactics.mentality} onChange={(e) => setUserMatchTactics({ mentality: e.target.value as Mentality })}>
                  {MENTALITIES.map((m) => <option key={m} value={m}>{m.replace('-', ' ')}</option>)}
                </select>
              </label>
              <label>
                Pressing
                <select value={userSide.tactics.pressing} onChange={(e) => setUserMatchTactics({ pressing: e.target.value as PressingLevel })}>
                  <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
                </select>
              </label>
              <label>
                Tempo
                <select value={userSide.tactics.tempo} onChange={(e) => setUserMatchTactics({ tempo: e.target.value as TempoLevel })}>
                  <option value="slow">slow</option><option value="normal">normal</option><option value="fast">fast</option>
                </select>
              </label>
            </div>

            <h3>Player ratings</h3>
            <SideRatings side={userSide} />
          </section>
        </div>
        <DragOverlay dropAnimation={null}>
          {activePlayer && (
            <PlayerChip
              chipText={String(activePlayer.squadNumber || '?')}
              ovr={overall(activePlayer)}
              position={activePlayer.position}
              overlay
            />
          )}
        </DragOverlay>
      </DndContext>
      {modalId !== null && <PlayerModal playerId={modalId} onClose={() => setModalId(null)} allowNavigate={false} />}
    </div>
  );
}

function SideRatings({ side }: { side: MatchSide }) {
  const game = useGame();
  const involved = side.players.filter((m) => m.onPitch || m.fatigue > 0 || m.sentOff);
  return (
    <table className="table compact">
      <thead><tr><th>Player</th><th>Rating</th><th>Fatigue</th><th></th></tr></thead>
      <tbody>
        {involved.map((m) => {
          const p = game.players[m.playerId];
          return (
            <tr key={m.playerId} className={m.onPitch ? '' : 'muted'}>
              <td>{fullName(p)}</td>
              <td><b>{m.rating.toFixed(1)}</b>{m.goals > 0 && ` ⚽×${m.goals}`}{m.assists > 0 && ` 🅰×${m.assists}`}</td>
              <td>{Math.round(m.fatigue)}</td>
              <td className="small">
                {m.yellow && '🟨'}{m.sentOff && '🟥'}{m.injured && '🤕'}{!m.onPitch && !m.sentOff && !m.injured && 'off'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
