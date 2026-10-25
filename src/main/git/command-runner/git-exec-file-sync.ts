import { execFileSync, type SpawnOptions } from 'node:child_process'
import { recordSubprocessSpawn } from '../../diagnostics/main-thread-churn-probe'
import { untranslatedGitOutputEnv } from './git-process-env'
import { resolveCommand } from './wsl-command-resolution'
import { routeLocalGitOptions } from './local-git-runtime-route'

// Bound synchronous Git: a dead network drive can freeze the main thread.
const GIT_EXEC_SYNC_TIMEOUT_MS = 15_000

/** Return trimmed stdout; prefer async execution to avoid blocking main. */
export function gitExecFileSync(
  args: string[],
  callerOptions: {
    cwd: string
    wslDistro?: string
    hostGit?: true
    encoding?: BufferEncoding
    stdio?: SpawnOptions['stdio']
    timeout?: number
  }
): string {
  const options = routeLocalGitOptions(callerOptions)
  const resolved = resolveCommand('git', args, options.cwd, options.wslDistro)
  const spawnStartedAt = performance.now()
  try {
    return execFileSync(resolved.binary, resolved.args, {
      cwd: resolved.cwd,
      encoding: options.encoding ?? 'utf-8',
      env: untranslatedGitOutputEnv(),
      stdio: options.stdio ?? ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout ?? GIT_EXEC_SYNC_TIMEOUT_MS,
      windowsHide: true
    }) as string
  } finally {
    recordSubprocessSpawn(resolved.binary, resolved.args, performance.now() - spawnStartedAt)
  }
}
