import type { OrcadPeerDesktopsResult } from '../../shared/orcad-peer-desktops-contract'
import type { DeviceEntry } from './device-entry'

/** Other desktops paired with this server: never the caller, the row it forked from, phones or unused offers. */
export function listPeerDesktops(
  devices: readonly DeviceEntry[],
  callerDeviceId: string,
  isConnected: (deviceId: string) => boolean
): OrcadPeerDesktopsResult {
  const caller = devices.find((device) => device.deviceId === callerDeviceId)
  return {
    peers: devices
      .filter(
        (device) =>
          device.scope === 'runtime' &&
          device.deviceId !== callerDeviceId &&
          // Its own pre-migration token row is the same desktop, not another one.
          device.deviceId !== caller?.forkedFrom &&
          device.forkedFrom !== callerDeviceId &&
          device.parentDeviceId === undefined &&
          !device.ephemeral &&
          device.lastSeenAt > 0
      )
      .map((device) => ({
        name: device.name,
        connected: isConnected(device.deviceId),
        lastSeenAt: device.lastSeenAt
      }))
  }
}
