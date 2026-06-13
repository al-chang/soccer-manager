import { useRef, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDroppable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { useGame, useGameStore } from '../store/gameStore';
import { FORMATIONS } from '../engine/tactics';
import { clubPlayers, isAvailable } from '../engine/squad';
import { overall, fullName, effectiveRating } from '../engine/player';
import type { Player } from '../engine/types';
import { PitchView, PlayerChip, parseSlotDropId, type PitchToken } from './PitchView';
import { DraggablePlayerRow, parseRowDropId } from './PlayerRow';
import { PlayerModal } from './PlayerModal';
import { OvrBadge, PosBadge } from './common';

const BENCH_AREA_ID = 'bench-area';

function BenchArea({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: BENCH_AREA_ID });
  return <ul ref={setNodeRef} className={`player-rows ${isOver ? 'drop-over' : ''}`}>{children}</ul>;
}

/**
 * Drag-and-drop lineup editor for the user's club: pitch with the starting
 * XI, plus bench and reserves lists. Drag between any of the three zones;
 * click a player for stats.
 */
export function LineupEditor() {
  const game = useGame();
  const setStarter = useGameStore((s) => s.setStarter);
  const swapBench = useGameStore((s) => s.swapBench);
  const addToBench = useGameStore((s) => s.addToBench);
  const autoPickLineup = useGameStore((s) => s.autoPickLineup);
  const [modalId, setModalId] = useState<number | null>(null);
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const justDragged = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const club = game.clubs[game.userClubId];
  const squad = clubPlayers(game, club.id);
  const slots = FORMATIONS[club.tactics.formation];
  const { starters, bench } = club.lineup;

  const tokens: (PitchToken | null)[] = slots.map((pos, slot) => {
    const pid = starters[slot];
    const p = pid !== undefined ? game.players[pid] : undefined;
    if (!p) return null;
    return {
      playerId: p.id,
      label: p.lastName,
      chipText: String(p.squadNumber || '?'),
      ovr: overall(p),
      position: p.position,
      warn: p.position !== pos || !isAvailable(p),
      status: !isAvailable(p) ? '🤕' : undefined,
      draggable: true,
    };
  });

  const openModal = (id: number) => {
    if (justDragged.current) return;
    setModalId(id);
  };

  const handleDragStart = (e: DragStartEvent) => {
    const pid = e.active.data.current?.playerId as number | undefined;
    setActiveDragId(pid ?? null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const draggedId = e.active.data.current?.playerId as number | undefined;
    if (draggedId === undefined || !e.over) return;
    const overId = String(e.over.id);
    const dragged = game.players[draggedId];
    if (!dragged || dragged.clubId !== club.id) return;

    const slot = parseSlotDropId(overId);
    if (slot !== null) {
      // Keepers stay in goal, outfielders stay out of it.
      if ((slots[slot] === 'GK') !== (dragged.position === 'GK')) return;
      if (starters[slot] === draggedId) return;
      setStarter(slot, draggedId);
      return;
    }

    const targetId = parseRowDropId(overId);
    if (targetId !== null && targetId !== draggedId) {
      const draggedSlot = starters.indexOf(draggedId);
      if (draggedSlot >= 0) {
        // Starter dropped on a list player: swap them.
        const target = game.players[targetId];
        if ((slots[draggedSlot] === 'GK') !== (target.position === 'GK')) return;
        setStarter(draggedSlot, targetId);
      } else {
        const targetSlot = starters.indexOf(targetId);
        if (targetSlot >= 0) {
          // List player dropped on a starter: take his place.
          if ((slots[targetSlot] === 'GK') !== (dragged.position === 'GK')) return;
          setStarter(targetSlot, draggedId);
        } else if (bench.includes(draggedId)) {
          swapBench(draggedId, targetId); // bench ↔ reserve / bench order
        } else if (bench.includes(targetId)) {
          swapBench(targetId, draggedId); // reserve dropped on bench player
        }
      }
      return;
    }

    if (overId === BENCH_AREA_ID && !bench.includes(draggedId) && starters.indexOf(draggedId) < 0) {
      addToBench(draggedId);
    }
  };

  const reserves = squad.filter((p) => !starters.includes(p.id) && !bench.includes(p.id))
    .sort((a, b) => overall(b) - overall(a));

  const row = (p: Player) => (
    <DraggablePlayerRow
      key={p.id}
      playerId={p.id}
      draggable
      droppable
      dim={!isAvailable(p)}
      onClick={() => openModal(p.id)}
    >
      <PosBadge pos={p.position} />
      <span className="player-row-name">{fullName(p)}</span>
      <OvrBadge value={Math.round(effectiveRating(p))} />
      {!isAvailable(p) && <span className="warn small">{p.injuryDays > 0 ? '🤕' : '🟥'}</span>}
    </DraggablePlayerRow>
  );

  const activePlayer = activeDragId !== null ? game.players[activeDragId] : null;

  return (
    <DndContext sensors={sensors} modifiers={[snapCenterToCursor]} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="lineup-editor">
        <div className="lineup-pitch-col">
          <PitchView
            formation={club.tactics.formation}
            tokens={tokens}
            dnd
            onTokenClick={openModal}
          />
          <p className="muted small center">
            Drag players between pitch, bench and reserves · click a player for details ·
            list badges show effective rating (ability adjusted for fitness, sharpness & form)
          </p>
        </div>
        <div className="lineup-lists">
          <div className="lineup-list-head">
            <h3>Bench ({bench.length}/7)</h3>
            <button className="btn small" onClick={autoPickLineup}>Auto-pick best XI</button>
          </div>
          <BenchArea>
            {bench.map((pid) => (game.players[pid] ? row(game.players[pid]) : null))}
            {bench.length === 0 && <li className="muted small">Drop players here for the bench.</li>}
          </BenchArea>
          <h3>Reserves ({reserves.length})</h3>
          <ul className="player-rows">
            {reserves.map((p) => row(p))}
            {reserves.length === 0 && <li className="muted small">Everyone is in the matchday squad.</li>}
          </ul>
        </div>
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
      {modalId !== null && <PlayerModal playerId={modalId} onClose={() => setModalId(null)} />}
    </DndContext>
  );
}
