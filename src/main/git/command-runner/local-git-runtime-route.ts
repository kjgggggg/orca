/**
 * Every local Git call follows its project's runtime, not only the callers that remember to pass
 * it: a `C:\` project whose runtime is WSL runs WSL Git unless it chose Git for Windows. Mixing the
 * two on one checkout is what lets one Git prune the other's worktrees (risk R36). A UNC cwd already
 * names its distro; a caller that must run the host's Git anyway says so with `hostGit: true`.
 */
type RoutableGitOptions = {
  cwd: string
  wslDistro?: string
  /** Runs the host's Git even in a WSL-runtime project; the call site says why. */
  hostGit?: true
}

/** The distro a local folder's project runs Git in, or undefined for the host's Git. */
export type LocalGitRuntimeRouter = (cwd: string) => string | undefined

let router: LocalGitRuntimeRouter | null = null

/** Main installs the store-backed router once the profile loads; null in tests and other hosts. */
export function setLocalGitRuntimeRouter(next: LocalGitRuntimeRouter | null): void {
  router = next
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/

export function routeLocalGitOptions<T extends RoutableGitOptions>(options: T): T {
  if (
    !router ||
    process.platform !== 'win32' ||
    options.wslDistro ||
    options.hostGit ||
    !WINDOWS_DRIVE_PATH.test(options.cwd)
  ) {
    return options
  }
  const wslDistro = router(options.cwd)
  return wslDistro ? { ...options, wslDistro } : options
}
