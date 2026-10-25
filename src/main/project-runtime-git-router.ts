/**
 * The store-backed router behind local-git-runtime-route.ts: a folder inside a local project's
 * repo or one of its worktrees runs Git where that project's runtime does.
 *
 * Never stale in the dangerous direction (host Git on a WSL project's checkout): the table is
 * dropped on every store write that can change it, before the writer's next statement, and a
 * folder the table doesn't know is traced through its `.git` link to the repo it belongs to.
 */
import { win32 } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import { resolveProjectExecutionRuntime } from '../shared/project-execution-runtime'
import type { GlobalSettings } from '../shared/global-settings-types'
import type { Project } from '../shared/project-types'
import { isFolderRepo } from '../shared/repo-kind'
import type { Repo } from '../shared/repo-types'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../shared/worktree/id'
import {
  setLocalGitRuntimeRouter,
  type LocalGitRuntimeRouter
} from './git/command-runner/local-git-runtime-route'
import { wslHostsGateOpen } from './wsl/wsl-host-gate'

export type ProjectRuntimeGitRouterStore = {
  getRepos: () => Repo[]
  getProjects: () => Project[]
  getSettings: () => Partial<Pick<GlobalSettings, 'localWindowsRuntimeDefault'>>
  getAllWorktreeMeta: () => Record<string, unknown>
}

/** The `.git` entry at or above a folder: a main checkout's directory or a worktree's link file. */
export type DotGitReader = (folder: string) => { root: string; gitdir: string | null } | null

type Route = { root: string; wslDistro: string | undefined }

export type ProjectRuntimeGitRouter = LocalGitRuntimeRouter & {
  /** Drops the table; the next lookup rebuilds it from the store. */
  invalidate: () => void
}

export function createProjectRuntimeGitRouter(
  store: ProjectRuntimeGitRouterStore,
  readDotGit: DotGitReader = readNearestDotGit
): ProjectRuntimeGitRouter {
  let routes: Route[] | null = null
  const table = (): Route[] => (routes ??= buildRoutes(store))
  const lookup = (folder: string): Route | undefined =>
    table().find(
      ({ root }) => folder === root || folder.startsWith(root.endsWith('/') ? root : `${root}/`)
    )
  const route = (cwd: string): string | undefined => {
    const folder = normalizeRuntimePathForComparison(cwd)
    const wasBuilt = routes !== null
    let known = lookup(folder)
    if (!known && wasBuilt) {
      // A miss rebuilds once, in case a write reached the store without a change event.
      routes = null
      known = lookup(folder)
    }
    if (known) {
      return known.wslDistro
    }
    // A worktree created a moment ago has no metadata yet: follow its link to its repo.
    const repoPath = linkedRepoPath(cwd, readDotGit)
    return repoPath ? lookup(normalizeRuntimePathForComparison(repoPath))?.wslDistro : undefined
  }
  return Object.assign(route, {
    invalidate: () => {
      routes = null
    }
  })
}

/** The main checkout a linked worktree's `.git` file points into; null for anything else. */
function linkedRepoPath(cwd: string, readDotGit: DotGitReader): string | null {
  const found = readDotGit(cwd)
  const match = found?.gitdir ? /^(.*)[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(found.gitdir) : null
  if (!found || !match) {
    return null
  }
  const commonDir = win32.resolve(found.root, match[1])
  return win32.basename(commonDir).toLowerCase() === '.git' ? win32.dirname(commonDir) : null
}

/** Windows paths only: the router routes drive-path folders. */
function readNearestDotGit(folder: string): { root: string; gitdir: string | null } | null {
  for (let current = folder; ; current = win32.dirname(current)) {
    const entry = win32.join(current, '.git')
    try {
      if (statSync(entry).isDirectory()) {
        return { root: current, gitdir: null }
      }
      const link = /^gitdir:\s*(.+)$/m.exec(readFileSync(entry, 'utf8'))
      return { root: current, gitdir: link ? link[1].trim() : null }
    } catch {
      // No `.git` here; keep walking up.
    }
    if (win32.dirname(current) === current) {
      return null
    }
  }
}

function buildRoutes(store: ProjectRuntimeGitRouterStore): Route[] {
  const projects = store.getProjects()
  const globalDefault = store.getSettings().localWindowsRuntimeDefault
  const localRepos = new Map(
    store
      .getRepos()
      .filter((repo) => getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID)
      .map((repo) => [repo.id, repo])
  )
  const distroByRepo = new Map(
    [...localRepos.values()].map((repo) => [repo.id, wslGitDistro(repo, projects, globalDefault)])
  )
  // Host-Git routes stay too, so a project nested in a WSL one keeps its own Git.
  const routes: Route[] = [...localRepos.values()].map((repo) => ({
    root: normalizeRuntimePathForComparison(repo.path),
    wslDistro: distroByRepo.get(repo.id)
  }))
  for (const worktreeId of Object.keys(store.getAllWorktreeMeta())) {
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    const parsed = localRepos.has(repoId) ? splitWorktreeIdForFilesystem(worktreeId) : null
    if (parsed) {
      routes.push({
        root: normalizeRuntimePathForComparison(parsed.worktreePath),
        wslDistro: distroByRepo.get(repoId)
      })
    }
  }
  // Longest first, so a worktree nested in another project's folder takes its own runtime.
  return routes.sort((left, right) => right.root.length - left.root.length)
}

/**
 * From the saved preference alone, not WSL's discovery caches: a missing distro makes the call
 * fail in WSL, which is safe, where falling back to host Git on a WSL checkout is not.
 */
function wslGitDistro(
  repo: Repo,
  projects: readonly Project[],
  globalWindowsRuntimeDefault: unknown
): string | undefined {
  if (isFolderRepo(repo)) {
    return undefined
  }
  const project = projects.find((entry) => entry.sourceRepoIds.includes(repo.id))
  const resolution = resolveProjectExecutionRuntime({
    appPlatform: 'win32',
    projectId: project?.id ?? repo.id,
    projectRuntimePreference: project?.localWindowsRuntimePreference,
    globalWindowsRuntimeDefault
  })
  return resolution.status === 'resolved' &&
    resolution.runtime.kind === 'wsl' &&
    resolution.runtime.git !== 'windows-host'
    ? resolution.runtime.distro
    : undefined
}

const ROUTE_DOMAINS: ReadonlySet<string> = new Set([
  'repos',
  'projects',
  'settings',
  'worktreeMeta',
  'worktreeMetaByIdentity',
  'worktreeIdentityAliases'
])

/**
 * Ships with WSL hosts (D1c): until then a WSL-runtime `C:\` project keeps today's mix, because
 * routing all of its Git through WSL is ~300x slower there before it can switch to Git for Windows.
 */
export function installProjectRuntimeGitRouter(
  store: ProjectRuntimeGitRouterStore & {
    onStateWritten: (listener: (dirtyDomains: readonly string[] | undefined) => void) => () => void
  }
): void {
  if (process.platform !== 'win32' || !wslHostsGateOpen()) {
    setLocalGitRuntimeRouter(null)
    return
  }
  const router = createProjectRuntimeGitRouter(store)
  // Synchronous with the write, so no Git call can run between a change and the table's drop.
  store.onStateWritten((domains) => {
    if (!domains || domains.some((domain) => ROUTE_DOMAINS.has(domain))) {
      router.invalidate()
    }
  })
  setLocalGitRuntimeRouter(router)
}
