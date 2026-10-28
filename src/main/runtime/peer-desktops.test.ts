import { describe, expect, it } from 'vitest'
import type { DeviceEntry } from './device-entry'
import { listPeerDesktops } from './peer-desktops'

function device(overrides: Partial<DeviceEntry> & Pick<DeviceEntry, 'deviceId'>): DeviceEntry {
  return { name: overrides.deviceId, scope: 'runtime', pairedAt: 1, lastSeenAt: 5, ...overrides }
}

describe('listPeerDesktops', () => {
  it('lists other desktops, with presence, and nothing else', () => {
    const devices = [
      device({ deviceId: 'me' }),
      device({ deviceId: 'dev', name: 'Orca Dev' }),
      device({ deviceId: 'beta', name: 'Orca Beta', lastSeenAt: 9 }),
      // A phone row is left out by its scope, even one that looks like a desktop otherwise.
      device({ deviceId: 'phone', name: 'Orca Phone', scope: 'mobile', lastSeenAt: 99 }),
      device({ deviceId: 'relayed', parentDeviceId: 'dev' }),
      device({ deviceId: 'browser', ephemeral: true }),
      device({ deviceId: 'unscanned', lastSeenAt: 0 })
    ]
    expect(listPeerDesktops(devices, 'me', (deviceId) => deviceId === 'dev')).toEqual({
      peers: [
        { name: 'Orca Dev', connected: true, lastSeenAt: 5 },
        { name: 'Orca Beta', connected: false, lastSeenAt: 9 }
      ]
    })
  })

  it('counts sibling forks of one token row as different desktops', () => {
    // Two installations paired through one code: their forks share the token row's fingerprint.
    const devices = [
      device({ deviceId: 'token', lastSeenAt: 3 }),
      device({
        deviceId: 'a',
        forkedFrom: 'token',
        callerFingerprint: 'f',
        devicePublicKeyB64: 'ka'
      }),
      device({
        deviceId: 'b',
        forkedFrom: 'token',
        callerFingerprint: 'f',
        devicePublicKeyB64: 'kb'
      })
    ]
    expect(listPeerDesktops(devices, 'a', () => false).peers.map((peer) => peer.name)).toEqual([
      'token',
      'b'
    ])
    expect(listPeerDesktops(devices, 'b', () => false).peers.map((peer) => peer.name)).toEqual([
      'token',
      'a'
    ])
  })

  it('leaves out an older enrollment of the same installation, by its device key', () => {
    // Re-added with a new token: a new row, the same device key.
    const devices = [
      device({ deviceId: 'before-readd', devicePublicKeyB64: 'k', lastSeenAt: 9 }),
      device({ deviceId: 'me', devicePublicKeyB64: 'k', callerFingerprint: 'new' }),
      device({ deviceId: 'dev', devicePublicKeyB64: 'other' })
    ]
    expect(listPeerDesktops(devices, 'me', () => false).peers.map((peer) => peer.name)).toEqual([
      'dev'
    ])
  })
})
