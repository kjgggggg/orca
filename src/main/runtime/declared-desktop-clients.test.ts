import { describe, expect, it } from 'vitest'
import type { DeviceEntry } from './device-entry'
import { DeclaredDesktopClients } from './declared-desktop-clients'

function devices(entries: Partial<DeviceEntry>[]) {
  const rows = entries.map((entry, index) => ({
    deviceId: `d${index}`,
    name: `Desk ${index}`,
    scope: 'runtime' as const,
    pairedAt: 1,
    lastSeenAt: 1,
    ...entry
  }))
  return (deviceId: string) => rows.find((row) => row.deviceId === deviceId) ?? null
}

describe('DeclaredDesktopClients', () => {
  it('counts each other installation once, never the caller’s own sockets', () => {
    const clients = new DeclaredDesktopClients()
    clients.declare('c-stable', 'd0', 'stable')
    clients.declare('c-dev-1', 'd0', 'dev')
    clients.declare('c-dev-2', 'd0', 'dev')
    const getDevice = devices([{ name: 'Orca' }])
    expect(
      clients.peers({ connectionId: 'c-other', clientInstanceId: 'stable' }, getDevice)
    ).toEqual({ peers: [{ name: 'Orca' }] })
    // Without an id, the caller's own declared socket still identifies it.
    expect(clients.peers({ connectionId: 'c-stable' }, getDevice).peers).toHaveLength(1)
    clients.forget('c-dev-1')
    clients.forget('c-dev-2')
    expect(clients.peers({ connectionId: 'c-stable' }, getDevice).peers).toEqual([])
  })

  it('sanitizes names, hides startup-offer names, and skips rows that are no desktop', () => {
    const clients = new DeclaredDesktopClients()
    clients.declare('a', 'd0', 'one')
    clients.declare('b', 'd1', 'two')
    clients.declare('c', 'd2', 'three')
    clients.declare('d', 'gone', 'four')
    const getDevice = devices([
      { name: 'Orca\n‮Dev⁦' },
      { name: 'CLI 10/28/2026' },
      { name: 'Phone', scope: 'mobile' }
    ])
    expect(clients.peers({ connectionId: 'me', clientInstanceId: 'me' }, getDevice)).toEqual({
      peers: [{ name: 'OrcaDev' }, { name: 'another Orca' }]
    })
  })
})
