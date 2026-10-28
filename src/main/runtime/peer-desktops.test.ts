import { describe, expect, it } from 'vitest'
import type { DeviceEntry } from './device-entry'
import { listPeerDesktops } from './peer-desktops'

function device(overrides: Partial<DeviceEntry> & Pick<DeviceEntry, 'deviceId'>): DeviceEntry {
  return { name: overrides.deviceId, scope: 'runtime', pairedAt: 1, lastSeenAt: 5, ...overrides }
}

describe('listPeerDesktops', () => {
  it('lists other desktops, with presence, and nothing else', () => {
    const devices = [
      device({ deviceId: 'me', forkedFrom: 'me-token' }),
      device({ deviceId: 'me-token' }),
      device({ deviceId: 'dev', name: 'Orca Dev' }),
      device({ deviceId: 'beta', name: 'Orca Beta', lastSeenAt: 9 }),
      device({ deviceId: 'phone', scope: 'mobile' }),
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

  it("leaves out a row forked from the caller's own", () => {
    const devices = [device({ deviceId: 'old' }), device({ deviceId: 'new', forkedFrom: 'old' })]
    expect(listPeerDesktops(devices, 'old', () => false)).toEqual({ peers: [] })
  })
})
