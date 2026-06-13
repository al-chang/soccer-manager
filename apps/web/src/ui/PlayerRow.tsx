import type { ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

export const rowDropId = (playerId: number) => `row:${playerId}`;
export const parseRowDropId = (id: string): number | null =>
  id.startsWith('row:') ? Number(id.slice(4)) : null;

/**
 * A list row that is both a drag source and a drop target (for swaps).
 * Requires an enclosing DndContext.
 */
export function DraggablePlayerRow({ playerId, draggable, droppable, dim, onClick, children }: {
  playerId: number;
  draggable: boolean;
  droppable: boolean;
  dim?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: rowDropId(playerId),
    disabled: !droppable,
    data: { playerId },
  });
  const { setNodeRef: setDragRef, attributes, listeners, isDragging } = useDraggable({
    id: `player:${playerId}`,
    disabled: !draggable,
    data: { playerId },
  });

  return (
    <li
      ref={(node) => { setDropRef(node); setDragRef(node); }}
      {...attributes}
      {...listeners}
      className={`player-row ${dim ? 'dim' : ''} ${isOver ? 'drop-over' : ''} ${isDragging ? 'dragging' : ''}`}
      onClick={onClick}
    >
      {children}
    </li>
  );
}
