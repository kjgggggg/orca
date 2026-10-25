/**
 * Why a WSL UNC path (`\\wsl.localhost\<distro>\…`) couldn't be opened, when Windows refused it.
 * Git then reports no repository, which sends the user looking in the wrong place: some sessions
 * can list a distro's `\home` and `\mnt` but get EPERM inside `\mnt\<drive>`.
 */
import { readdir } from 'node:fs/promises'
import { parseWslUncPath } from '../../shared/wsl-paths'

/** The message to show instead of "not a git repository"; null when access wasn't the problem. */
export async function describeWslUncAccessDenied(
  path: string,
  list: (path: string) => Promise<unknown> = readdir
): Promise<string | null> {
  if (!parseWslUncPath(path)) {
    return null
  }
  try {
    await list(path)
    return null
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    return code === 'EPERM' || code === 'EACCES'
      ? `Windows denied access to this WSL path: ${path}`
      : null
  }
}
