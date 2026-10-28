import { resolveOrcadRemoteContext } from '../managed-server/install/orcad-remote-context'
import { OrcadHostUnsupportedError } from '../orcad/orcad-host-unavailable'
import type { OrcadHostTransport } from '../ssh/orcad-host-transport'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import type { WslDistroHolder } from './wsl-distro-holder'
import type { WslOrcadHostTarget } from './wsl-orcad-host-target'

/** WSL 1 runs no Linux kernel, so the pinned Node and its pty cannot run there. */
export function isWsl1KernelRelease(release: string): boolean {
  return /^\d+\.\d+\.\d+-\d+-Microsoft$/.test(release.trim())
}

/**
 * Refuses WSL 1, then acquires the holder alongside the read-only context probes: the kernel probe
 * already started the distro, so the holder spawns nothing extra, and it is held before the caller
 * may launch orcad (recovery included) or WSL could idle-stop its distro.
 */
export async function holdWslDistroWithContext(
  name: string,
  target: WslOrcadHostTarget,
  conn: OrcadHostTransport,
  holder: WslDistroHolder,
  signal: AbortSignal | undefined
) {
  const kernel = await execCommand(conn, 'uname -r', { signal })
  if (isWsl1KernelRelease(kernel)) {
    throw new OrcadHostUnsupportedError(
      `The WSL 1 distro ${name} isn’t supported by Orca’s server. ` +
        `Convert it with: wsl --set-version ${name} 2`
    )
  }
  const [held, context] = await Promise.all([
    holder.ensureHeld(name),
    resolveOrcadRemoteContext(target, conn, signal)
  ])
  return { held, context }
}
