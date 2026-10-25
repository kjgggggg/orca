import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { routeLocalGitOptions, setLocalGitRuntimeRouter } from './local-git-runtime-route'

const originalPlatform = process.platform

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  setLocalGitRuntimeRouter((cwd) => (cwd.startsWith('C:\\wsl-project') ? 'Ubuntu' : undefined))
})

afterEach(() => {
  setLocalGitRuntimeRouter(null)
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

describe('routeLocalGitOptions', () => {
  it("runs a WSL-runtime project's Git in its distro when the caller passed only a folder", () => {
    expect(routeLocalGitOptions({ cwd: String.raw`C:\wsl-project\src` })).toEqual({
      cwd: String.raw`C:\wsl-project\src`,
      wslDistro: 'Ubuntu'
    })
  })

  it.each([
    ['a host-Git project', { cwd: String.raw`C:\windows-project` }],
    ['an explicit distro', { cwd: String.raw`C:\wsl-project`, wslDistro: 'Debian' }],
    ['a deliberate host-Git call', { cwd: String.raw`C:\wsl-project`, hostGit: true as const }],
    ['a UNC folder, which names its own distro', { cwd: String.raw`\\wsl.localhost\Ubuntu\x` }]
  ])('leaves %s as it is', (_name, options) => {
    expect(routeLocalGitOptions(options)).toBe(options)
  })

  it('does nothing off Windows or without a router', () => {
    const options = { cwd: String.raw`C:\wsl-project` }
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
    expect(routeLocalGitOptions(options)).toBe(options)
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    setLocalGitRuntimeRouter(null)
    expect(routeLocalGitOptions(options)).toBe(options)
  })
})
