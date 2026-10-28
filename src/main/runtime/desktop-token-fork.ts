import type { TokenDeviceEntry } from './device-entry'
import type { DeviceRegistry } from './device-registry'
import { MAX_FORKS_PER_TOKEN_ROW } from './device-key-fork'

export class DesktopTokenForkError extends Error {
  constructor(
    readonly code:
      | 'device_not_found'
      | 'not_a_shared_desktop_token'
      | 'delegated_device'
      | 'too_many_forks'
  ) {
    super(code)
  }
}

/**
 * A desktop that enrolled through a server's startup offer gets its own token row, so desktops
 * sharing one server stay distinct (R39). Forks count toward the same cap as device-key forks.
 */
export function forkDesktopToken(
  registry: Pick<DeviceRegistry, 'listDevices' | 'addDevice'>,
  legacyDeviceId: string,
  label: string,
  now = Date.now()
): TokenDeviceEntry {
  const devices = registry.listDevices()
  const legacy = devices.find((device) => device.deviceId === legacyDeviceId)
  if (!legacy) {
    throw new DesktopTokenForkError('device_not_found')
  }
  if (legacy.parentDeviceId !== undefined) {
    throw new DesktopTokenForkError('delegated_device')
  }
  if (
    legacy.scope !== 'runtime' ||
    legacy.token === undefined ||
    legacy.credentialKind === 'device-key' ||
    legacy.forkedFrom !== undefined
  ) {
    throw new DesktopTokenForkError('not_a_shared_desktop_token')
  }
  // A released fork's row is gone, so it frees its slot.
  if (
    devices.filter((device) => device.forkedFrom === legacyDeviceId).length >=
    MAX_FORKS_PER_TOKEN_ROW
  ) {
    throw new DesktopTokenForkError('too_many_forks')
  }
  // Seen now: a zero would read as an unused offer that rotation may delete.
  return registry.addDevice(label, 'runtime', legacy.pairingReach, legacy.grants, {
    forkedFrom: legacyDeviceId,
    lastSeenAt: now
  })
}
