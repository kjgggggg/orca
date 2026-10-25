import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../shared/project-types'
import type { Repo } from '../shared/repo-types'
import { createProjectRuntimeGitRouter } from './project-runtime-git-router'

const originalPlatform = process.platform

function repo(id: string, path: string): Repo {
  return { id, path, displayName: id, badgeColor: '', addedAt: 0, kind: 'git' }
}

function project(id: string, preference?: Project['localWindowsRuntimePreference']): Project {
  return {
    id,
    displayName: id,
    badgeColor: '',
    sourceRepoIds: [id],
    createdAt: 0,
    updatedAt: 0,
    ...(preference ? { localWindowsRuntimePreference: preference } : {})
  }
}

beforeEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
})

describe('createProjectRuntimeGitRouter', () => {
  const repos = [
    repo('wsl', String.raw`C:\src\app`),
    repo('nested', String.raw`C:\src\app\vendor\lib`),
    repo('converted', String.raw`C:\src\fast`),
    { ...repo('remote', String.raw`C:\src\remote`), executionHostId: 'ssh:box' as const }
  ]
  const projects = [
    project('wsl'),
    project('nested', { kind: 'windows-host' }),
    project('converted', { kind: 'wsl', distro: 'Ubuntu', git: 'windows-host' }),
    project('remote')
  ]
  let now = 0
  const store = {
    getRepos: () => repos,
    getProjects: () => projects,
    getSettings: () => ({ localWindowsRuntimeDefault: { kind: 'wsl' as const, distro: 'Ubuntu' } }),
    getAllWorktreeMeta: () => ({ [String.raw`wsl::D:\trees\app-fix`]: {} })
  }
  const route = createProjectRuntimeGitRouter(store, () => now)

  it("routes a project's folders and its known worktrees by its runtime", () => {
    expect(route(String.raw`C:\src\app`)).toBe('Ubuntu')
    expect(route(String.raw`c:/SRC/app/src`)).toBe('Ubuntu')
    expect(route(String.raw`D:\trees\app-fix\pkg`)).toBe('Ubuntu')
  })

  it('keeps host Git for a converted project, a nested Windows project and unknown folders', () => {
    expect(route(String.raw`C:\src\fast`)).toBeUndefined()
    expect(route(String.raw`C:\src\app\vendor\lib\x`)).toBeUndefined()
    expect(route(String.raw`C:\src\remote`)).toBeUndefined()
    expect(route(String.raw`C:\elsewhere`)).toBeUndefined()
  })

  it('picks up a runtime change once its routes expire', () => {
    projects[0] = project('wsl', { kind: 'wsl', distro: 'Ubuntu', git: 'windows-host' })
    expect(route(String.raw`C:\src\app`)).toBe('Ubuntu')
    now += 2_000
    expect(route(String.raw`C:\src\app`)).toBeUndefined()
  })
})
