/** R39: a WSL desktop enrolled through orcad's startup offer splits off its own token row, so two Orcas on one distro stay distinct. */
import { basename } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { encodePairingOffer, parsePairingCode } from '../../shared/pairing'
import {
  ORCAD_FORK_DESKTOP_METHOD,
  OrcadForkDesktopResultSchema
} from '../../shared/orcad-peer-desktops-contract'
import { ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/orcad-runtime-capabilities'
import { sendRemoteRuntimeRequest } from '../../shared/remote-runtime/remote-runtime-client'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { ServeReadiness } from '../server/serve-readiness'

const FORK_TIMEOUT_MS = 10_000

/** userData's folder names the install (Orca, Orca Dev), which is what a peer's toast shows. */
export function wslOrcadDesktopLabel(): string {
  return basename(getAppEnvironment().getPath('userData')) || 'Orca'
}

/** Returns this desktop's own pairing, or the given one where the server can't fork it. */
export async function forkWslOrcadDesktopPairing(
  pairingCode: string,
  readiness: Pick<ServeReadiness, 'pairing'>,
  label = wslOrcadDesktopLabel()
): Promise<string> {
  const offer = parsePairingCode(pairingCode)
  const startup =
    readiness.pairing?.available === true ? parsePairingCode(readiness.pairing.url) : null
  // Only the shared startup token needs splitting; an own row is already distinct.
  if (!offer || !startup || offer.deviceToken !== startup.deviceToken) {
    return pairingCode
  }
  const connection = pairedRuntimeConnectionFromOffer(offer)
  try {
    const status = await sendRemoteRuntimeRequest<RuntimeStatus>(
      connection,
      'status.get',
      undefined,
      FORK_TIMEOUT_MS
    )
    if (
      !status.ok ||
      !status.result.capabilities?.includes(ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY)
    ) {
      console.warn(
        '[wsl-hosts] This WSL host’s server predates per-desktop pairing; this Orca shares its startup pairing.'
      )
      return pairingCode
    }
    const forked = await sendRemoteRuntimeRequest<unknown>(
      connection,
      ORCAD_FORK_DESKTOP_METHOD,
      { label },
      FORK_TIMEOUT_MS
    )
    const result = forked.ok ? OrcadForkDesktopResultSchema.safeParse(forked.result) : null
    if (!result?.success) {
      throw new Error(forked.ok ? 'unreadable fork reply' : forked.error.message)
    }
    return encodePairingOffer({
      ...offer,
      deviceToken: result.data.token,
      pairedDeviceId: result.data.deviceId
    })
  } catch (error) {
    console.warn(
      '[wsl-hosts] Could not give this Orca its own pairing; sharing the startup one:',
      error
    )
    return pairingCode
  }
}
