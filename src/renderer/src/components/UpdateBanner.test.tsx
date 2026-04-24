import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UpdateBanner } from './UpdateBanner'
import type { UpdaterStatus } from '../../../../shared/types'

const mockInstall = vi.hoisted(() => vi.fn())
const mockOn = vi.fn()

vi.mock('../ipc/bridge', () => ({ installUpdate: mockInstall }))

beforeEach(() => {
  vi.clearAllMocks()
  mockOn.mockReturnValue(vi.fn())
  vi.stubGlobal('electronAPI', { on: mockOn, invoke: vi.fn() })
})

function getStatusHandler(): (status: UpdaterStatus) => void {
  const call = mockOn.mock.calls.find(([ch]: [string]) => ch === 'updater:status')
  return call?.[1]
}

describe('UpdateBanner', () => {
  it('renders nothing by default', () => {
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when state is not ready', () => {
    const { container } = render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'downloading', percent: 50 }) })
    expect(container.firstChild).toBeNull()
  })

  it('shows banner with version when state is ready', () => {
    render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
  })

  it('calls installUpdate when Restart & Update is clicked', () => {
    render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(mockInstall).toHaveBeenCalledOnce()
  })

  it('dismisses the banner when × is clicked', () => {
    const { container } = render(<UpdateBanner />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container.firstChild).toBeNull()
  })
})
