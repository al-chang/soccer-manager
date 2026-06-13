import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { FormationId, Position } from '../engine/types';
import { FORMATIONS } from '../engine/tactics';
import { PITCH_LAYOUT } from './pitchLayout';

/** A player chip rendered on the pitch. */
export interface PitchToken {
  playerId: number;
  /** Name shown under the chip. */
  label: string;
  /** Text inside the chip (squad number, match rating, …). */
  chipText: string;
  /** Overall rating, shown as a small corner badge. */
  ovr?: number;
  position: Position;
  /** Amber ring: out of position / tiring / unavailable. */
  warn?: boolean;
  /** Small status suffix shown after the label (🤕 🟨 …). */
  status?: string;
  draggable?: boolean;
}

/** Drop-target id helpers shared with DndContext owners. */
export const slotDropId = (slot: number) => `slot:${slot}`;
export const parseSlotDropId = (id: string): number | null =>
  id.startsWith('slot:') ? Number(id.slice(5)) : null;

function ovrTier(ovr: number): string {
  return ovr >= 75 ? 'elite' : ovr >= 65 ? 'good' : ovr >= 55 ? 'decent' : 'poor';
}

/** The circular player chip — also used inside DragOverlay while dragging. */
export function PlayerChip({ chipText, position, ovr, warn, overlay }: {
  chipText: string;
  position: Position;
  ovr?: number;
  warn?: boolean;
  overlay?: boolean;
}) {
  return (
    <span className={`pitch-chip pos-${position.toLowerCase()} ${warn ? 'warn-ring' : ''} ${overlay ? 'overlay' : ''}`}>
      {chipText}
      {ovr !== undefined && <span className={`pitch-ovr ${ovrTier(ovr)}`}>{ovr}</span>}
    </span>
  );
}

function PitchSlot({ slot, posLabel, token, dnd, onTokenClick }: {
  slot: number;
  posLabel: Position;
  token: PitchToken | null;
  dnd: boolean;
  onTokenClick?: (playerId: number) => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: slotDropId(slot),
    disabled: !dnd,
    data: { slot },
  });
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: token ? `player:${token.playerId}` : `empty:${slot}`,
    disabled: !dnd || !token?.draggable,
    data: token ? { playerId: token.playerId } : undefined,
  });

  return (
    <div ref={setDropRef} className={`pitch-slot ${token ? '' : 'empty'} ${isOver ? 'drop-over' : ''}`}>
      {token ? (
        <>
          <button
            ref={setDragRef}
            {...attributes}
            {...listeners}
            className={`pitch-chip pos-${token.position.toLowerCase()} ${token.warn ? 'warn-ring' : ''} ${isDragging ? 'dragging' : ''}`}
            onClick={onTokenClick ? () => onTokenClick(token.playerId) : undefined}
            title={token.ovr !== undefined ? `${token.label} (${token.ovr} ovr)` : token.label}
          >
            {token.chipText}
            {token.ovr !== undefined && <span className={`pitch-ovr ${ovrTier(token.ovr)}`}>{token.ovr}</span>}
          </button>
          <span className="pitch-label">
            {token.label}{token.status ? ` ${token.status}` : ''}
          </span>
        </>
      ) : (
        <span className="pitch-chip-empty">{posLabel}</span>
      )}
    </div>
  );
}

interface PitchViewProps {
  formation: FormationId;
  /** One entry per formation slot; null = empty slot. */
  tokens: (PitchToken | null)[];
  /** Enable dnd-kit drag/drop (requires an enclosing DndContext). */
  dnd?: boolean;
  onTokenClick?: (playerId: number) => void;
}

/**
 * Visual pitch with players at their formation positions. Reused by the
 * tactics screen (lineup editing) and the live match screen (subs). Drag
 * behavior is owned by the parent's DndContext via slot ids (`slot:<n>`).
 */
export function PitchView({ formation, tokens, dnd = false, onTokenClick }: PitchViewProps) {
  const layout = PITCH_LAYOUT[formation];
  const slots = FORMATIONS[formation];

  return (
    <div className="pitch">
      <div className="pitch-markings">
        <div className="pitch-circle" />
        <div className="pitch-halfway" />
        <div className="pitch-box top" />
        <div className="pitch-box bottom" />
      </div>
      {layout.map((pos, slot) => (
        <div key={slot} className="pitch-slot-anchor" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
          <PitchSlot
            slot={slot}
            posLabel={slots[slot]}
            token={tokens[slot] ?? null}
            dnd={dnd}
            onTokenClick={onTokenClick}
          />
        </div>
      ))}
    </div>
  );
}
