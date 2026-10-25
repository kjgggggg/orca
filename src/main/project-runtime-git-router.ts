/**
 * The store-backed router behind local-git-runtime-route.ts: a folder inside a local project's
 * repo or one of its known worktrees runs Git where that project's runtime does. Rebuilt at most
 * every couple of seconds, so a runtime change applies to Git on its next call after that.
 */
import { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import type { Repo } from '../shared/repo-types'
import { getRepoIdFromWorktreeId, splitWorktreeIdForFilesystem } from '../shared/worktree/id'
import {
  setLocalGitRuntimeRouter,
  type LocalGitRuntimeRouter
} from './git/command-runner/local-git-runtime-route'
import { wslHostsGateOpen } from './wsl/wsl-host-gate'
import type { ProjectRuntimeResolutionStore } from './local-project-runtime-resolution'
import { getWorktreeCreatePrefetchGitOptions } from './project-runtime-git-options'

export type ProjectRuntimeGitRouterStore = ProjectRuntimeResolutionStore & {
  getRepos: () => Repo[]
  getAllWorktreeMeta: () => Record<string, unknown>
}

const ROUTES_TTL_MS = 2_000

type Route = { root: string; wslDistro: string | undefined }

export function createProjectRuntimeGitRouter(
  store: ProjectRuntimeGitRouterStore,
  now: () => number = Date.now
): LocalGitRuntimeRouter {
  let routes: Route[] = []
  let builtAt = Number.NEGATIVE_INFINITY
  return (cwd) => {
    if (now() - builtAt >= ROUTES_TTL_MS) {
      routes = buildRoutes(store)
      builtAt = now()
    }
    const folder = normalizeRuntimePathForComparison(cwd)
    // Longest first, so a worktree nested in another project's folder takes its own runtime.
    return routes.find(
      ({ root }) => folder === root || folder.startsWith(root.endsWith('/') ? root : `${root}/`)
    )?.wslDistro
  }
}

function buildRoutes(store: ProjectRuntimeGitRouterStore): Route[] {
  const distroByRepo = new Map<string, string | undefined>()
  const routes: Route[] = []
  const add = (repo: Repo, path: string): void => {
    if (!distroByRepo.has(repo.id)) {
      distroByRepo.set(repo.id, getWorktreeCreatePrefetchGitOptions(store, repo).wslDistro)
    }
    // Host-Git routes stay too, so a project nested in a WSL one keeps its own Git.
    routes.push({
      root: normalizeRuntimePathForComparison(path),
      wslDistro: distroByRepo.get(repo.id)
    })
  }
  const localRepos = new Map(
    store
      .getRepos()
      .filter((repo) => getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID)
      .map((repo) => [repo.id, repo])
  )
  for (const repo of localRepos.values()) {
    add(repo, repo.path)
  }
  for (const worktreeId of Object.keys(store.getAllWorktreeMeta())) {
    const repo = localRepos.get(getRepoIdFromWorktreeId(worktreeId))
    const parsed = repo ? splitWorktreeIdForFilesystem(worktreeId) : null
    if (repo && parsed) {
      add(repo, parsed.worktreePath)
    }
  }
  return routes.sort((left, right) => right.root.length - left.root.length)
}

/**
 * Ships with WSL hosts (D1c): until then a WSL-runtime `C:\` project keeps today's mix, because
 * routing all of its Git through WSL is ~300x slower there before it can switch to Git for Windows.
 */
export function installProjectRuntimeGitRouter(store: ProjectRuntimeGitRouterStore): void {
  setLocalGitRuntimeRouter(
    process.platform === 'win32' && wslHostsGateOpen() ? createProjectRuntimeGitRouter(store) : null
  )
}
