import { describe, it, expect } from 'vitest'
import { reorderById } from '../../src/renderer/src/lib/reorder'

const item = (id: string) => ({ id })

describe('reorderById', () => {
  it('returns null when fromId === toId (no-op)', () => {
    const list = [item('a'), item('b')]
    expect(reorderById(list, 'a', 'a', 'before')).toBeNull()
  })

  it('returns null when either id is missing', () => {
    const list = [item('a'), item('b')]
    expect(reorderById(list, 'a', 'missing', 'before')).toBeNull()
    expect(reorderById(list, 'missing', 'a', 'after')).toBeNull()
  })

  it('moves an item before another (drag-up case)', () => {
    const list = ['a', 'b', 'c', 'd'].map(item)
    const next = reorderById(list, 'd', 'b', 'before')
    expect(next?.map(i => i.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an item after another (drag-down case)', () => {
    const list = ['a', 'b', 'c', 'd'].map(item)
    const next = reorderById(list, 'a', 'c', 'after')
    expect(next?.map(i => i.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  // Off-by-one edge: when moving forward (fromIdx < toIdx), the splice that
  // removes the item shifts toIdx left by one. The implementation accounts
  // for that — these tests pin it down so a future "simplification" can't
  // break it silently.
  it('moves forward + before: target index is corrected after splice', () => {
    const list = ['a', 'b', 'c'].map(item)
    const next = reorderById(list, 'a', 'c', 'before')
    expect(next?.map(i => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves backward + after: target index is not corrected', () => {
    const list = ['a', 'b', 'c'].map(item)
    const next = reorderById(list, 'c', 'a', 'after')
    expect(next?.map(i => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('does not mutate the input list', () => {
    const list = ['a', 'b', 'c'].map(item)
    const snapshot = list.map(i => i.id)
    reorderById(list, 'a', 'c', 'after')
    expect(list.map(i => i.id)).toEqual(snapshot)
  })
})
