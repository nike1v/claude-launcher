// Move `fromId` to land directly before/after `toId` in an id-keyed list,
// preserving relative order. Returns a new array; the caller decides what
// to do with it (set state, persist, etc.). Pulled out of projects/store
// and environments/store, which had identical bodies.
//
// Off-by-one: after the splice that removes fromId, every index >= fromIdx
// shifts left by one. The recomputed `insertAt` accounts for that.
export function reorderById<T extends { id: string }>(
  list: ReadonlyArray<T>,
  fromId: string,
  toId: string,
  position: 'before' | 'after'
): T[] | null {
  if (fromId === toId) return null
  const fromIdx = list.findIndex(x => x.id === fromId)
  const toIdx = list.findIndex(x => x.id === toId)
  if (fromIdx < 0 || toIdx < 0) return null
  const next = [...list]
  const [moved] = next.splice(fromIdx, 1)
  let insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx
  if (position === 'after') insertAt += 1
  next.splice(insertAt, 0, moved)
  return next
}
