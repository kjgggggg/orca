import { describe, expect, it } from 'vitest'
import type { Project } from '../shared/project-types'
import type { Repo } from '../shared/repo-types'
import {
  createProjectRuntimeGitRouter,
  type DotGitReader,
  type ProjectRuntimeGitRouterStore
} from './project-runtime-git-router'

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

function world() {
  const state = {
    repos: [
      repo('wsl', String.raw`C:\src\app`),
      repo('nested', String.raw`C:\src\app\vendor\lib`),
      repo('converted', String.raw`C:\src\fast`),
      { ...repo('remote', String.raw`C:\src\remote`), executionHostId: 'ssh:box' as const }
    ],
    projects: [
      project('wsl'),
      project('nested', { kind: 'windows-host' }),
      project('converted', { kind: 'wsl', distro: 'Ubuntu', git: 'windows-host' }),
      project('remote')
    ],
    worktreeMeta: new Map<string, unknown>([[String.raw`wsl::D:\trees\app-fix`, {}]])
  }
  const store: ProjectRuntimeGitRouterStore = {
    getRepos: () => state.repos,
    getProjects: () => state.projects,
    getSettings: () => ({ localWindowsRuntimeDefault: { kind: 'wsl', distro: 'Ubuntu' } }),
    getAllWorktreeMeta: () => Object.fromEntries(state.worktreeMeta)
  }
  const links = new Map<string, string>()
  const readDotGit: DotGitReader = (folder) => {
    const root = [...links.keys()].find((path) => folder.startsWith(path))
    return root ? { root, gitdir: links.get(root) ?? null } : null
  }
  return { state, router: createProjectRuntimeGitRouter(store, readDotGit), links }
}

describe('createProjectRuntimeGitRouter', () => {
  it("routes a project's folders and its known worktrees by its runtime", () => {
    const { router } = world()
    expect(router(String.raw`C:\src\app`)).toBe('Ubuntu')
    expect(router(String.raw`c:/SRC/app/src`)).toBe('Ubuntu')
    expect(router(String.raw`D:\trees\app-fix\pkg`)).toBe('Ubuntu')
  })

  it('keeps host Git for a converted project, a nested Windows project and unknown folders', () => {
    const { router } = world()
    expect(router(String.raw`C:\src\fast`)).toBeUndefined()
    expect(router(String.raw`C:\src\app\vendor\lib\x`)).toBeUndefined()
    expect(router(String.raw`C:\src\remote`)).toBeUndefined()
    expect(router(String.raw`C:\elsewhere`)).toBeUndefined()
  })

  it('takes a runtime switch on the very next call once the write drops the table', () => {
    const { state, router } = world()
    expect(router(String.raw`C:\src\app`)).toBe('Ubuntu')
    state.projects = state.projects.map((entry) =>
      entry.id === 'wsl'
        ? {
            ...entry,
            localWindowsRuntimePreference: { kind: 'wsl', distro: 'Ubuntu', git: 'windows-host' }
          }
        : entry
    )
    router.invalidate()
    expect(router(String.raw`C:\src\app`)).toBeUndefined()
    state.projects = state.projects.map((entry) =>
      entry.id === 'converted'
        ? { ...entry, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Debian' } }
        : entry
    )
    router.invalidate()
    expect(router(String.raw`C:\src\fast`)).toBe('Debian')
  })

  it('routes a worktree created a moment ago, before its metadata exists, by its .git link', () => {
    const { router, links } = world()
    links.set(String.raw`E:\new\feature`, 'C:/src/app/.git/worktrees/feature')
    expect(router(String.raw`E:\new\feature\src`)).toBe('Ubuntu')
    links.set(String.raw`E:\new\fast-wt`, 'C:/src/fast/.git/worktrees/fast-wt')
    expect(router(String.raw`E:\new\fast-wt`)).toBeUndefined()
  })

  it('rebuilds once on a miss, in case a write came without a change event', () => {
    const { state, router } = world()
    expect(router(String.raw`F:\added`)).toBeUndefined()
    state.repos = [...state.repos, repo('added', String.raw`F:\added`)]
    state.projects = [...state.projects, project('added')]
    expect(router(String.raw`F:\added\src`)).toBe('Ubuntu')
  })

  it('routes by the saved preference even when the distro is missing, so Git fails in WSL', () => {
    const { state, router } = world()
    state.projects = state.projects.map((entry) =>
      entry.id === 'wsl'
        ? { ...entry, localWindowsRuntimePreference: { kind: 'wsl', distro: 'Gone' } }
        : entry
    )
    router.invalidate()
    expect(router(String.raw`C:\src\app`)).toBe('Gone')
  })
})
