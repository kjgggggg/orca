import type { OrcadPeerDesktopsResult } from '../../shared/orcad-peer-desktops-contract'
import type { DeviceEntry } from './device-entry'

/** Other desktops paired with this server: never the caller, phones, unused offers or idle forked-from tokens. */
export function listPeerDesktops(
  devices: readonly DeviceEntry[],
  callerDeviceId: string,
  isConnected: (deviceId: string) => boolean
): OrcadPeerDesktopsResult {
  const callerKey = devices.find((device) => device.deviceId === callerDeviceId)?.devicePublicKeyB64
  return {
    peers: devices
      .filter(
        (device) =>
          device.scope === 'runtime' &&
          device.deviceId !== callerDeviceId &&
          // Only a device key proves one installation: rows forked from one token row (and so
          // sharing its fingerprint) can be different desktops that paired through one code.
          (callerKey === undefined || device.devicePublicKeyB64 !== callerKey) &&
          device.parentDeviceId === undefined &&
          // A shared token row its desktops forked from counts only while something still uses it.
          (!devices.some((fork) => fork.forkedFrom === device.deviceId) ||
            isConnected(device.deviceId)) &&
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
