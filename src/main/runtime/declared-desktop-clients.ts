import type { OrcadPeerDesktopsResult } from '../../shared/orcad-peer-desktops-contract'
import { sanitizeDeviceLabel } from '../../shared/device-key-proof'
import type { DeviceEntry } from './device-entry'

const UNNAMED_DESKTOP = 'another Orca'

type Declaration = { clientInstanceId: string; deviceId: string }

/**
 * R39: which desktop installation each authenticated control socket belongs to. A desktop declares
 * on its control socket after auth (and after every reconnect); the tag goes with that socket.
 * Desktops sharing one token row stay distinct, and a desktop's own other sockets never count.
 */
export class DeclaredDesktopClients {
  private readonly byConnection = new Map<string, Declaration>()

  declare(connectionId: string, deviceId: string, clientInstanceId: string): void {
    this.byConnection.set(connectionId, { clientInstanceId, deviceId })
  }

  forget(connectionId: string): void {
    this.byConnection.delete(connectionId)
  }

  peers(
    caller: { connectionId: string; clientInstanceId?: string },
    getDevice: (deviceId: string) => DeviceEntry | null
  ): OrcadPeerDesktopsResult {
    const callerInstance =
      caller.clientInstanceId ?? this.byConnection.get(caller.connectionId)?.clientInstanceId
    const names = new Map<string, string>()
    for (const [connectionId, declaration] of this.byConnection) {
      if (
        connectionId === caller.connectionId ||
        declaration.clientInstanceId === callerInstance ||
        names.has(declaration.clientInstanceId)
      ) {
        continue
      }
      const device = getDevice(declaration.deviceId)
      // A revoked, phone or browser-session row is no desktop.
      if (device?.scope !== 'runtime' || device.ephemeral || device.parentDeviceId !== undefined) {
        continue
      }
      names.set(declaration.clientInstanceId, displayName(device.name))
    }
    return { peers: [...names.values()].map((name) => ({ name })) }
  }
}

// Startup offers are named "CLI <date>", which says nothing to a person.
function displayName(raw: string): string {
  const name = sanitizeDeviceLabel(raw, UNNAMED_DESKTOP)
  return /^CLI \d/.test(name) ? UNNAMED_DESKTOP : name
}
