import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UpdatePill } from './UpdatePill'
import type { UpdaterStatus } from '../../../../shared/types'

const mockInstall = vi.hoisted(() => vi.fn())
const mockCheck = vi.hoisted(() => vi.fn())
const mockOn = vi.fn()

vi.mock('../../ipc/bridge', () => ({
  installUpdate: mockInstall,
  checkForUpdates: mockCheck
}))

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
  it('defaults to up-to-date with a check-for-updates action', () => {
    render(<UpdatePill />)
    expect(screen.getByText(/Up to date/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeTruthy()
  })

  it('shows checking state while a check is in flight', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'checking', currentVersion: '1.0.0' }) })
    expect(screen.getByText(/Checking for updates/i)).toBeTruthy()
    expect(screen.getByText(/1\.0\.0/)).toBeTruthy()
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

  it('calls checkForUpdates when Check is clicked from up-to-date', () => {
    render(<UpdatePill />)
    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    expect(mockCheck).toHaveBeenCalledOnce()
  })

  it('shows retry button on error', () => {
    render(<UpdatePill />)
    act(() => { getStatusHandler()({ state: 'error', message: 'oops' }) })
    expect(screen.getByText(/Update failed/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(mockCheck).toHaveBeenCalledOnce()
  })
})
