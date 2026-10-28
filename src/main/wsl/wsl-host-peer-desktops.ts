/** R39: a WSL host's server lives in the Linux login's ~/.orca, so another Orca on this computer may share it. */
import { z } from 'zod'
import { ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/orcad-runtime-capabilities'
import {
  ORCAD_PEER_DESKTOPS_METHOD,
  OrcadPeerDesktopsResultSchema
} from '../../shared/orcad-peer-desktops-contract'

// A desktop seen this recently may still own terminals there; an install gone longer no longer holds the server.
export const WSL_HOST_PEER_DESKTOP_RECENT_MS = 30 * 24 * 60 * 60 * 1000

export type WslHostPeerDesktops =
  | { kind: 'none' }
  | { kind: 'shared'; names: string[] }
  /** An older server can't say: Remove keeps today's teardown. */
  | { kind: 'unsupported' }

const StatusCapabilitiesSchema = z.looseObject({ capabilities: z.array(z.string()).optional() })

/** Throws when the server can't answer, so the caller refuses the teardown. */
export async function readWslHostPeerDesktops(
  call: (method: string, params: unknown) => Promise<unknown>,
  now = Date.now()
): Promise<WslHostPeerDesktops> {
  const status = StatusCapabilitiesSchema.parse(await call('status.get', undefined))
  if (!status.capabilities?.includes(ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY)) {
    return { kind: 'unsupported' }
  }
  const { peers } = OrcadPeerDesktopsResultSchema.parse(
    await call(ORCAD_PEER_DESKTOPS_METHOD, undefined)
  )
  const sharing = peers.filter(
    (peer) => peer.connected || now - peer.lastSeenAt < WSL_HOST_PEER_DESKTOP_RECENT_MS
  )
  return sharing.length > 0
    ? { kind: 'shared', names: sharing.map((peer) => peer.name) }
    : { kind: 'none' }
}
