import { afterEach, describe, expect, it, vi } from 'vitest'

type RunningListener = (distros: readonly string[]) => void
type StoppedListener = (stopped: string[], running: string[]) => void
const listeners = vi.hoisted(() => {
  const running: RunningListener[] = []
  const stopped: StoppedListener[] = []
  return { running, stopped }
})
vi.mock('../wsl-running-distro-cache', () => ({
  onConfirmedRunningWslDistros: (listener: (distros: readonly string[]) => void) => {
    listeners.running.push(listener)
    return () => {}
  },
  onRunningWslDistrosStopped: (listener: (stopped: string[], running: string[]) => void) => {
    listeners.stopped.push(listener)
    return () => {}
  }
}))

import {
  followWslAutomountRoots,
  knownWslAutomountRoots,
  onWslAutomountRootsChanged,
  parseWslAutomountRoot,
  resetWslAutomountRootsForTests
} from './wsl-automount-root'

afterEach(() => {
  resetWslAutomountRootsForTests()
  listeners.running.length = 0
  listeners.stopped.length = 0
})

describe('parseWslAutomountRoot', () => {
  it.each([
    ['/mnt/c/', '/mnt/'],
    ['/c/', '/'],
    ['/windows/c', '/windows/'],
    ['not a path', null],
    [null, null]
  ])('%s → %s', (value, expected) => {
    expect(parseWslAutomountRoot(value)).toBe(expected)
  })
})

describe('followWslAutomountRoots', () => {
  it("reads a project distro's root once it runs, and again after it restarts", async () => {
    const read = vi.fn(async () => '/')
    const changed = vi.fn()
    onWslAutomountRootsChanged(changed)
    followWslAutomountRoots(() => ['Ubuntu'], read)
    listeners.running[0](['Ubuntu', 'Debian'])
    await vi.waitFor(() => expect(knownWslAutomountRoots()).toEqual(['/mnt/', '/']))
    // Only the project distros, and only once while it runs.
    listeners.running[0](['Ubuntu'])
    expect(read).toHaveBeenCalledExactlyOnceWith('Ubuntu')
    expect(changed).toHaveBeenCalledOnce()
    listeners.stopped[0](['Ubuntu'], [])
    expect(knownWslAutomountRoots()).toEqual(['/mnt/'])
    listeners.running[0](['Ubuntu'])
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('keeps the default root when a distro cannot be read', async () => {
    const read = vi.fn(async () => null)
    followWslAutomountRoots(() => ['Ubuntu'], read)
    listeners.running[0](['Ubuntu'])
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    expect(knownWslAutomountRoots()).toEqual(['/mnt/'])
  })
})
