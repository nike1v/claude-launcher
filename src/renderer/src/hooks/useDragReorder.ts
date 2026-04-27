import { useState, useCallback } from 'react'

// Drop position relative to a target row. Used to render a visible insertion
// line and to drive the eventual reorder call.
export type DropPosition = 'before' | 'after'

export interface DragReorder {
  draggingId: string | null
  dropTargetId: string | null
  dropPosition: DropPosition | null
  // Bind these handlers on every reorderable row. Pass the row's id (and
  // optionally a `groupKey` so a drag started in one bucket doesn't accept
  // drops in another — used to keep project drags within one environment).
  bindRow: (id: string, groupKey?: string) => {
    draggable: true
    onDragStart: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  // Visual hint helpers.
  isDragging: (id: string) => boolean
  isDropTarget: (id: string) => boolean
}

interface Options {
  // Called when the user finishes a valid drop — both ids guaranteed to be
  // in the same group when groupKey is in use.
  onReorder: (fromId: string, toId: string, position: DropPosition) => void
}

export function useDragReorder({ onReorder }: Options): DragReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingGroup, setDraggingGroup] = useState<string | undefined>(undefined)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)

  const reset = useCallback(() => {
    setDraggingId(null)
    setDraggingGroup(undefined)
    setDropTargetId(null)
    setDropPosition(null)
  }, [])

  const bindRow = useCallback((id: string, groupKey?: string) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => {
      setDraggingId(id)
      setDraggingGroup(groupKey)
      // Required for some browsers to actually start a drag.
      e.dataTransfer.effectAllowed = 'move'
      try { e.dataTransfer.setData('text/plain', id) } catch { /* ignore */ }
    },
    onDragOver: (e: React.DragEvent) => {
      if (!draggingId || draggingId === id) return
      if (groupKey !== draggingGroup) return // refuse cross-group drops
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const half = rect.top + rect.height / 2
      setDropTargetId(id)
      setDropPosition(e.clientY < half ? 'before' : 'after')
    },
    onDragLeave: (e: React.DragEvent) => {
      // Only clear when leaving for somewhere other than a child element.
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      if (dropTargetId === id) {
        setDropTargetId(null)
        setDropPosition(null)
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      if (draggingId && dropTargetId && draggingId !== dropTargetId && dropPosition) {
        onReorder(draggingId, dropTargetId, dropPosition)
      }
      reset()
    },
    onDragEnd: () => reset()
  }), [draggingId, draggingGroup, dropTargetId, dropPosition, onReorder, reset])

  return {
    draggingId,
    dropTargetId,
    dropPosition,
    bindRow,
    isDragging: (id: string) => draggingId === id,
    isDropTarget: (id: string) => dropTargetId === id
  }
}
