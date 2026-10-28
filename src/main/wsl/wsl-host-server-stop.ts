/** Stop terminals by handle, then managed-decommission orcad/daemon. Claim stopped only with zero-session census, exact serving-orcad identity and retired daemon evidence. */
import { z } from 'zod'
import { errorMessage } from '../../shared/error-message'
import type { OrcadDecommissionResult } from '../../shared/orcad-decommission'
import { ORCAD_MANAGED_REMOTE_PORT } from '../../shared/orcad-managed-runtime'
import type { OrcadTerminalCensus } from '../../shared/orcad-terminal-census'
import type { RuntimeTerminalListResult } from '../../shared/runtime-terminal-contracts'
import type { WslHostServerStop } from '../../shared/wsl-host-types'
import type { OrcadHostTransport } from '../ssh/orcad-host-transport'
import { readRemoteOrcadManagedStopTarget } from '../managed-server/lifecycle/orcad-managed-remote-stop'
import { managedOrcadSlot } from '../managed-server/lifecycle/orcad-managed-runtime-context'
import { resolveOrcadRemoteContext } from '../managed-server/install/orcad-remote-context'
import { decommissionRemoteOrcad } from '../managed-server/install/orcad-remote-decommission'
import type { WslOrcadHostTarget } from './wsl-orcad-host-target'
import { readWslHostPeerDesktops, type WslHostPeerDesktops } from './wsl-host-peer-desktops'
import { ORCAD_RELEASE_DESKTOP_METHOD } from '../../shared/orcad-peer-desktops-contract'

const CENSUS_ATTEMPTS = 20
const CENSUS_INTERVAL_MS = 250

/** A terminal Orca asked to close but that may still run, named so the user can find it. */
export type WslHostTerminalLeftover = { handle: string; worktreeId: string; reason: string }

export type WslHostServerStopSteps = {
  /** Which other desktops share this server; throws when it can't say. */
  peerDesktops: () => Promise<WslHostPeerDesktops>
  /** Revoke this desktop's own device on the server, so no leftover row of ours counts as a peer. */
  releaseOwnDevice: () => Promise<void>
  /** Closes every terminal orcad runs; returns the ones that refused instead of stopping. */
  endTerminals: () => Promise<WslHostTerminalLeftover[]>
  census: () => Promise<OrcadTerminalCensus>
  /** The runtime id of the orcad the bridge is serving; read before the bridge closes. */
  servingRuntimeId: () => Promise<string | null>
  /** After the bridge closed: liveness must not see this exit as a crash to recover. */
  closeBridge: () => Promise<void>
  decommission: (
    census: OrcadTerminalCensus,
    servingRuntimeId: string | null
  ) => Promise<OrcadDecommissionResult>
  sleep?: (ms: number) => Promise<void>
}

function describeLeftovers(leftovers: readonly WslHostTerminalLeftover[]): string {
  return leftovers
    .map((leftover) => `${leftover.handle} (${leftover.worktreeId}): ${leftover.reason}`)
    .join('; ')
}

async function releaseOwnDevice(steps: WslHostServerStopSteps): Promise<boolean> {
  try {
    await steps.releaseOwnDevice()
    return true
  } catch (error) {
    console.warn('[wsl-hosts] Could not release this Orca from the WSL host:', error)
    return false
  }
}

export async function stopWslHostServer(steps: WslHostServerStopSteps): Promise<WslHostServerStop> {
  const sleep = steps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const problems: string[] = []
  // Anything proven still running makes the stop `live`; only doubt leaves it `unverifiable`.
  let provenLive = false
  // Another Orca using this server keeps it: only this desktop lets go (R39).
  let peers: WslHostPeerDesktops
  try {
    peers = await steps.peerDesktops()
  } catch (error) {
    await steps.closeBridge()
    return {
      stopped: false,
      verdict: 'unverifiable',
      reason: `Orca couldn’t ask the WSL host whether another Orca on this computer still uses it: ${errorMessage(error)}`
    }
  }
  if (peers.kind === 'shared') {
    const released = await releaseOwnDevice(steps)
    await steps.closeBridge()
    return {
      stopped: true,
      keptForOtherDesktops: peers.names,
      ...(released ? {} : { ownDeviceKept: true as const })
    }
  }
  if (peers.kind === 'unsupported') {
    console.warn(
      '[wsl-hosts] This WSL host’s server predates the shared-host check; removing it ends its terminals for every Orca using it.'
    )
  }
  let leftovers: WslHostTerminalLeftover[] = []
  try {
    leftovers = await steps.endTerminals()
  } catch (error) {
    problems.push(`Orca couldn’t list the host’s terminals: ${errorMessage(error)}`)
  }
  // PTY close is not shell-exit proof; wait for zero-session census.
  let census = await steps.census()
  for (let attempt = 1; attempt < CENSUS_ATTEMPTS && census.liveSessions !== 0; attempt += 1) {
    await sleep(CENSUS_INTERVAL_MS)
    census = await steps.census()
  }
  const servingRuntimeId = await steps.servingRuntimeId().catch(() => null)
  // Last call over the bridge: a server this Remove may not stop (or a later Add restarts) must not
  // keep a recent row of ours, which a peer's Remove would read as a desktop still using it.
  if (leftovers.length === 0 && census.liveSessions === 0) {
    await releaseOwnDevice(steps)
  }
  await steps.closeBridge()
  if (leftovers.length > 0) {
    provenLive = true
    problems.push(`Terminals that refused to close: ${describeLeftovers(leftovers)}`)
  }
  if (census.liveSessions !== null && census.liveSessions > 0) {
    provenLive = true
  }
  if (census.liveSessions !== 0) {
    problems.push(
      census.liveSessions === null
        ? 'The terminal daemon did not answer a session count.'
        : `${census.liveSessions} terminal session${census.liveSessions === 1 ? '' : 's'} kept running.`
    )
  }
  // Decommission still verifies/refuses live sessions; retain its evidence.
  const result = await steps.decommission(census, servingRuntimeId)
  if (result.outcome === 'refused') {
    provenLive ||= result.verdict === 'live'
    problems.push(`Orca’s server kept running: ${result.reason}`)
  } else if (result.retirement !== 'retired') {
    provenLive ||= result.retirement === 'live'
    problems.push('Orca’s server stopped, but its terminal daemon is still running.')
  }
  return problems.length === 0
    ? { stopped: true }
    : {
        stopped: false,
        reason: problems.join(' '),
        verdict: provenLive ? 'live' : 'unverifiable'
      }
}

/** Use saved environment pairing and routed RPC for removal, never the bridge's raw pairing offer. */
export type WslHostRuntimeAccess = {
  isReady?: (environmentId: string) => boolean
  call: (environmentId: string, method: string, params: unknown) => Promise<unknown>
  census: (environmentId: string) => Promise<OrcadTerminalCensus>
}

// Only what removal reads from each live terminal.
const TerminalHandlesSchema = z.object({
  terminals: z.array(z.object({ handle: z.string().min(1), worktreeId: z.string() }))
}) satisfies z.ZodType<{
  terminals: Pick<RuntimeTerminalListResult['terminals'][number], 'handle' | 'worktreeId'>[]
}>

const RuntimeIdSchema = z.object({ runtimeId: z.string().min(1) })

/** Closing terminals, counting what is left and naming the serving orcad, all through its RPC. */
export function wslHostRuntimeStopSteps(
  access: WslHostRuntimeAccess,
  environmentId: string
): Pick<
  WslHostServerStopSteps,
  'peerDesktops' | 'releaseOwnDevice' | 'endTerminals' | 'census' | 'servingRuntimeId'
> {
  return {
    peerDesktops: () =>
      readWslHostPeerDesktops((method, params) => access.call(environmentId, method, params)),
    releaseOwnDevice: async () => {
      await access.call(environmentId, ORCAD_RELEASE_DESKTOP_METHOD, undefined)
    },
    endTerminals: async () => {
      const list = TerminalHandlesSchema.parse(
        await access.call(environmentId, 'terminal.list', { limit: 1000 })
      )
      const leftovers: WslHostTerminalLeftover[] = []
      // Close by handle so deleted-project terminals remain addressable; one refusal must not skip other terminals/server stop.
      for (const terminal of list.terminals) {
        try {
          await access.call(environmentId, 'terminal.close', { terminal: terminal.handle })
        } catch (error) {
          leftovers.push({ ...terminal, reason: errorMessage(error) })
        }
      }
      return leftovers
    },
    census: () => access.census(environmentId),
    servingRuntimeId: async () =>
      RuntimeIdSchema.parse(await access.call(environmentId, 'status.get', undefined)).runtimeId
  }
}

/** After bridge close, decommission via wsl.exe only if recorded active orcad matches the previously serving runtime; re-add may have adopted another instance. */
export function decommissionWslHostOrcad(
  target: WslOrcadHostTarget,
  transport: OrcadHostTransport
): WslHostServerStopSteps['decommission'] {
  return async (census, servingRuntimeId) => {
    const context = await resolveOrcadRemoteContext(target, transport)
    const slot = managedOrcadSlot(context, ORCAD_MANAGED_REMOTE_PORT)
    const active = context.activationRecord.active
    if (active) {
      const stopTarget = await readRemoteOrcadManagedStopTarget(slot, active)
      const recordedRuntimeId = stopTarget.state === 'ready' ? stopTarget.context.runtimeId : null
      if (!servingRuntimeId || recordedRuntimeId !== servingRuntimeId) {
        return {
          outcome: 'refused',
          verdict: 'unverifiable',
          code: 'orcad_wsl_host_serving_instance_unproven',
          reason:
            'the orcad this computer was connected to is not the one the distro records as active, so Orca could not prove it stopped.'
        }
      }
    }
    return decommissionRemoteOrcad({ ...slot, record: context.activationRecord, census })
  }
}
