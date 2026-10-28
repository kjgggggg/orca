import { z } from 'zod'

// Why: a WSL host's server is one per Linux login, so other Orca desktops may share it.
export const ORCAD_PEER_DESKTOPS_METHOD = 'host.peerDesktops'
// A desktop enrolled through the server's startup offer splits off its own token row.
export const ORCAD_FORK_DESKTOP_METHOD = 'host.forkDesktop'
// A desktop that leaves a shared server revokes its own device, so peers stop counting it.
export const ORCAD_RELEASE_DESKTOP_METHOD = 'host.releaseDesktop'

const PeerDesktopSchema = z.object({
  name: z.string(),
  /** A socket from that desktop is authenticated right now. */
  connected: z.boolean(),
  /** When that desktop last authenticated; 0 is never. */
  lastSeenAt: z.number()
})

/** Every other desktop paired with this server; the caller and phones are left out. */
export const OrcadPeerDesktopsResultSchema = z.object({ peers: z.array(PeerDesktopSchema) })

export type OrcadPeerDesktop = z.infer<typeof PeerDesktopSchema>
export type OrcadPeerDesktopsResult = z.infer<typeof OrcadPeerDesktopsResultSchema>

export const OrcadReleaseDesktopResultSchema = z.object({ released: z.boolean() })

export const OrcadForkDesktopParamsSchema = z.object({ label: z.string().min(1).max(128) }).strict()
export const OrcadForkDesktopResultSchema = z.object({
  deviceId: z.string().min(1),
  token: z.string().min(1)
})
export type OrcadForkDesktopResult = z.infer<typeof OrcadForkDesktopResultSchema>
