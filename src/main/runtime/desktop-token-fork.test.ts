import { describe, expect, it } from 'vitest'
import type { DeviceEntry, TokenDeviceEntry } from './device-entry'
import {
  DesktopTokenForkError,
  forkDesktopToken,
  sanitizeDesktopForkLabel
} from './desktop-token-fork'
import { MAX_FORKS_PER_TOKEN_ROW } from './device-key-fork'

function registry(devices: DeviceEntry[]) {
  return {
    listDevices: () => devices,
    addDevice: (
      name: string,
      scope: DeviceEntry['scope'] = 'mobile',
      _reach?: unknown,
      _grants?: unknown,
      fork?: { forkedFrom: string; lastSeenAt: number }
    ): TokenDeviceEntry => {
      const entry: TokenDeviceEntry = {
        deviceId: `fork-${devices.length}`,
        token: `token-${devices.length}`,
        name,
        scope,
        pairedAt: 1,
        lastSeenAt: 0,
        ...fork
      }
      devices.push(entry)
      return entry
    }
  }
}

const STARTUP: DeviceEntry = {
  deviceId: 'startup',
  token: 'shared',
  name: 'CLI',
  scope: 'runtime',
  pairedAt: 1,
  lastSeenAt: 5
}

describe('forkDesktopToken', () => {
  it('gives the caller its own seen row, forked from the shared startup token', () => {
    const devices = [STARTUP]
    const fork = forkDesktopToken(registry(devices), 'startup', 'Orca Dev', 7)
    expect(fork).toMatchObject({
      name: 'Orca Dev',
      scope: 'runtime',
      forkedFrom: 'startup',
      lastSeenAt: 7
    })
  })

  it('refuses anything but a shared desktop token', () => {
    for (const [device, code] of [
      [{ ...STARTUP, scope: 'mobile' }, 'not_a_shared_desktop_token'],
      [{ ...STARTUP, forkedFrom: 'other' }, 'not_a_shared_desktop_token'],
      [{ ...STARTUP, credentialKind: 'device-key' }, 'not_a_shared_desktop_token'],
      [{ ...STARTUP, parentDeviceId: 'desk' }, 'delegated_device']
    ] as const) {
      expect(() => forkDesktopToken(registry([device]), 'startup', 'Orca')).toThrow(
        new DesktopTokenForkError(code)
      )
    }
    expect(() => forkDesktopToken(registry([]), 'startup', 'Orca')).toThrow('device_not_found')
  })

  it('caps forks per token row, and a removed fork frees its slot', () => {
    const devices: DeviceEntry[] = [STARTUP]
    const reg = registry(devices)
    for (let i = 0; i < MAX_FORKS_PER_TOKEN_ROW; i += 1) {
      forkDesktopToken(reg, 'startup', `Orca ${i}`)
    }
    expect(() => forkDesktopToken(reg, 'startup', 'One more')).toThrow('too_many_forks')
    devices.splice(
      devices.findIndex((device) => device.forkedFrom === 'startup'),
      1
    )
    expect(forkDesktopToken(reg, 'startup', 'One more').name).toBe('One more')
  })
})

describe('sanitizeDesktopForkLabel', () => {
  it('keeps a plain name and strips control, zero-width and bidi characters', () => {
    expect(sanitizeDesktopForkLabel('Orca Dev')).toBe('Orca Dev')
    expect(sanitizeDesktopForkLabel('  Orca‮​ Dev\n\t ')).toBe('Orca Dev')
    expect(sanitizeDesktopForkLabel('x'.repeat(200))).toHaveLength(64)
    expect(sanitizeDesktopForkLabel('\u0007​')).toBe('')
  })

  it('refuses a label with nothing left to show', () => {
    expect(() => forkDesktopToken(registry([{ ...STARTUP }]), 'startup', '\u0000⁦')).toThrow(
      'invalid_label'
    )
  })
})
