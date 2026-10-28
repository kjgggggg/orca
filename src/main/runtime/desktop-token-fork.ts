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
      | 'invalid_label'
  ) {
    super(code)
  }
}

/**
 * A desktop that enrolled through a server's startup offer gets its own token row, so desktops
 * sharing one server stay distinct (R39). Forks count toward the same cap as device-key forks.
 */
const MAX_LABEL_CHARS = 64

// Zero-width, bidi-embedding/override and isolate marks, and the BOM: invisible or reordering.
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff]
]

function isHiddenChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    INVISIBLE_RANGES.some(([low, high]) => code >= low && code <= high)
  )
}

/** Display-only: control and invisible characters go, whitespace collapses, length is capped. */
export function sanitizeDesktopForkLabel(label: string): string {
  return Array.from(label, (char) => (isHiddenChar(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_CHARS)
    .trim()
}

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
  const name = sanitizeDesktopForkLabel(label)
  if (!name) {
    throw new DesktopTokenForkError('invalid_label')
  }
  // Exactly the caller's grants and reach; seen now, since a zero would read as an unused offer.
  return registry.addDevice(name, 'runtime', legacy.pairingReach, legacy.grants, {
    forkedFrom: legacyDeviceId,
    lastSeenAt: now
  })
}
