import type * as ChildProcess from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFileSync } = vi.hoisted(() => ({
  execFileSync: vi.fn((_binary: string, _args: readonly string[], _options?: unknown) => 'out')
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  execFileSync
}))

import { gitExecFileSync } from './git-exec-file-sync'

const originalPlatform = process.platform

afterEach(() => {
  execFileSync.mockClear()
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

describe('gitExecFileSync', () => {
  it("runs a WSL-made worktree's Git in its distro, so `rev-parse --git-path` reads its links", () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    gitExecFileSync(['rev-parse', '--git-path', 'hooks'], {
      cwd: String.raw`C:\src\app`,
      wslDistro: 'Ubuntu'
    })
    const [binary, args] = execFileSync.mock.calls[0] ?? ['', []]
    expect(binary.toLowerCase()).toContain('wsl')
    expect(args).toEqual(expect.arrayContaining(['Ubuntu']))
  })
})
