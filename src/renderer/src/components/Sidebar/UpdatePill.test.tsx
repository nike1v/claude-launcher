import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UpdatePill } from './UpdatePill'
import type { UpdaterStatus } from '../../../../shared/types'

const mockInstall = vi.hoisted(() => vi.fn())
const mockOn = vi.fn()

vi.mock('../../ipc/bridge', () => ({ installUpdate: mockInstall }))

beforeEach(() => {
  vi.clearAllMocks()
  mockOn.mockReturnValue(vi.fn())
  vi.stubGlobal('electronAPI', { on: mockOn, invoke: vi.fn() })
})

function getStatusHandler(): (status: UpdaterStatus) => void {
  const call = mockOn.mock.calls.find(([ch]: [string]) => ch === 'updater:status')
  return call?.[1]
}

describe('UpdatePill', () => {
  it('renders nothing by default', () => {
    const { container } = render(<UpdatePill />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for transient states', () => {
    const { container } = render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'checking' }) })
    expect(container.firstChild).toBeNull()
    act(() => { getStatusHandler()({ state: 'up-to-date' }) })
    expect(container.firstChild).toBeNull()
  })

  it('shows downloading progress with percent', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'downloading', version: '1.2.3', percent: 47.6 }) })
    expect(screen.getByText(/Downloading update/i)).toBeTruthy()
    expect(screen.getByText('48%')).toBeTruthy()
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy()
  })

  it('shows update-available state', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'available', version: '1.2.3' }) })
    expect(screen.getByText(/Update available/i)).toBeTruthy()
    expect(screen.getByText(/1\.2\.3/)).toBeTruthy()
  })

  it('shows ready state with install button', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    expect(screen.getByText(/Update ready/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /restart/i })).toBeTruthy()
  })

  it('calls installUpdate when Restart & Update is clicked', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'ready', version: '1.2.3' }) })
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(mockInstall).toHaveBeenCalledOnce()
  })
})
