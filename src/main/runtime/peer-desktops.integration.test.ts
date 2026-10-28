import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { sendRemoteRuntimeRequest } from '../../shared/remote-runtime/remote-runtime-client'
import {
  ORCAD_FORK_DESKTOP_METHOD,
  ORCAD_PEER_DESKTOPS_METHOD,
  ORCAD_RELEASE_DESKTOP_METHOD,
  type OrcadForkDesktopResult,
  type OrcadPeerDesktopsResult
} from '../../shared/orcad-peer-desktops-contract'
import { ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/orcad-runtime-capabilities'
import type { RuntimeStatus } from '../../shared/runtime-types'
import { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import { authenticateMobileWsSession } from './runtime-rpc-mobile-ws-test-harness'
import { makeStore } from './runtime-rpc-worktree-store-fixtures'
import { partialRuntimeStore } from './runtime-store-partial-fixture'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

describe(ORCAD_PEER_DESKTOPS_METHOD, () => {
  const cleanups: (() => Promise<void> | void)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      await cleanup()
    }
  })

  async function startServer(): Promise<OrcaRuntimeRpcServer> {
    const server = new OrcaRuntimeRpcServer({
      runtime: new OrcaRuntimeService(partialRuntimeStore(makeStore())),
      userDataPath: mkdtempSync(join(tmpdir(), 'orca-peer-desktops-')),
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    cleanups.push(() => server.stop())
    return server
  }

  function pair(server: OrcaRuntimeRpcServer, name: string, scope: 'runtime' | 'mobile') {
    const offer = server.createPairingOffer({ address: '127.0.0.1', name, scope })
    if (!offer.available) {
      throw new Error('pairing unavailable')
    }
    return parsePairingCode(offer.pairingUrl)!
  }

  function call<T>(offer: PairingOffer, method: string, params?: unknown) {
    return sendRemoteRuntimeRequest<T>(
      pairedRuntimeConnectionFromOffer(offer),
      method,
      params,
      5_000
    )
  }

  /** What a WSL desktop does after enrolling through the startup offer. */
  async function fork(startup: PairingOffer, label: string): Promise<PairingOffer> {
    const forked = await call<OrcadForkDesktopResult>(startup, ORCAD_FORK_DESKTOP_METHOD, { label })
    if (!forked.ok) {
      throw new Error(forked.error.message)
    }
    return { ...startup, deviceToken: forked.result.token }
  }

  async function peerNames(offer: PairingOffer): Promise<string[]> {
    const answer = await call<OrcadPeerDesktopsResult>(offer, ORCAD_PEER_DESKTOPS_METHOD)
    if (!answer.ok) {
      throw new Error(answer.error.message)
    }
    return answer.result.peers.map((peer) => peer.name)
  }

  it('tells a desktop which other desktops share the server, and advertises that it can', async () => {
    const server = await startServer()
    // One pending offer per scope at a time, so each desktop pairs and is used before the next.
    const stable = pair(server, 'Orca', 'runtime')
    const status = await call<RuntimeStatus>(stable, 'status.get')
    expect(status.ok && status.result.capabilities).toContain(
      ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY
    )
    expect(await call<OrcadPeerDesktopsResult>(stable, ORCAD_PEER_DESKTOPS_METHOD)).toMatchObject({
      ok: true,
      result: { peers: [] }
    })

    const dev = pair(server, 'Orca Dev', 'runtime')
    await call(dev, 'status.get')
    // A phone and a desktop offer nobody has used yet share nothing.
    await call(pair(server, 'Phone', 'mobile'), 'status.get').catch(() => undefined)
    pair(server, 'Never used', 'runtime')
    const answer = await call<OrcadPeerDesktopsResult>(stable, ORCAD_PEER_DESKTOPS_METHOD)
    expect(answer.ok && answer.result.peers).toEqual([
      { name: 'Orca Dev', connected: false, lastSeenAt: expect.any(Number) }
    ])

    // Dev holds a socket open: it is connected now.
    const session = await authenticateMobileWsSession(encodePairingOffer(dev))
    cleanups.push(() => session.ws.close())
    const connected = await call<OrcadPeerDesktopsResult>(stable, ORCAD_PEER_DESKTOPS_METHOD)
    expect(connected.ok && connected.result.peers).toEqual([
      { name: 'Orca Dev', connected: true, lastSeenAt: expect.any(Number) }
    ])
  })

  it('lets a desktop release itself, so a peer no longer counts it', async () => {
    const server = await startServer()
    const stable = pair(server, 'Orca', 'runtime')
    await call(stable, 'status.get')
    const dev = pair(server, 'Orca Dev', 'runtime')
    await call(dev, 'status.get')

    expect(await call(stable, ORCAD_RELEASE_DESKTOP_METHOD)).toMatchObject({
      ok: true,
      result: { released: true }
    })
    const answer = await call<OrcadPeerDesktopsResult>(dev, ORCAD_PEER_DESKTOPS_METHOD)
    expect(answer.ok && answer.result.peers).toEqual([])
    // Revoked: the released desktop can no longer call this server.
    await expect(call(stable, 'status.get')).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('splits two desktops enrolled through one startup offer, and each sees the other', async () => {
    const server = await startServer()
    const startup = pair(server, 'CLI 10/28/2026', 'runtime')
    const stable = await fork(startup, 'Orca')
    const dev = await fork(startup, 'Orca Dev')
    expect(stable.deviceToken).not.toBe(dev.deviceToken)
    // The startup row they forked from is idle, so it doesn't count.
    expect(await peerNames(stable)).toEqual(['Orca Dev'])
    expect(await peerNames(dev)).toEqual(['Orca'])
  })

  it('lets a lone desktop that forked and released tear down, and re-add from the same offer', async () => {
    const server = await startServer()
    const startup = pair(server, 'CLI 10/28/2026', 'runtime')
    // More cycles than the fork cap: each release frees its slot.
    for (let cycle = 0; cycle < 40; cycle += 1) {
      const own = await fork(startup, 'Orca')
      expect(await peerNames(own)).toEqual([])
      expect(await call(own, ORCAD_RELEASE_DESKTOP_METHOD)).toMatchObject({
        ok: true,
        result: { released: true }
      })
    }
    // The readiness offer still works: a pending-stop retry's repair re-enrolls and forks again.
    const again = await fork(startup, 'Orca')
    expect(await call(again, 'status.get')).toMatchObject({ ok: true })
  })

  it('mints a desktop row only for the holder of the advertised startup offer, with its own grants', async () => {
    const server = await startServer()
    const startup = pair(server, 'CLI 10/28/2026', 'runtime')
    const own = await fork(startup, '  Orca\u202e Dev\n ')
    const registry = server.getDeviceRegistry()!
    const startupRow = registry.listDevices().find((d) => d.token === startup.deviceToken)!
    const ownRow = registry.listDevices().find((d) => d.token === own.deviceToken)!
    // Display-only label: control and bidi characters gone; exactly the startup row's grants and reach.
    expect(ownRow).toMatchObject({
      name: 'Orca Dev',
      scope: 'runtime',
      forkedFrom: startupRow.deviceId,
      pairingReach: startupRow.pairingReach
    })
    expect(ownRow.grants ?? []).toEqual(startupRow.grants ?? [])

    const refused = async (offer: PairingOffer, params: unknown) => {
      const answer = await call(offer, ORCAD_FORK_DESKTOP_METHOD, params)
      return answer.ok ? null : answer.error.message
    }
    // A forked row, a grant request and an empty label are all refused.
    expect(await refused(own, { label: 'Again' })).toContain('not_a_shared_desktop_token')
    expect(await refused(startup, { label: 'X', grants: ['desktop-control'] })).not.toBeNull()
    expect(await refused(startup, { label: '\u0007\u200b' })).toContain('invalid_label')
    // Once a newer desktop offer is advertised, the old one no longer forks.
    const newer = pair(server, 'CLI later', 'runtime')
    expect(newer.deviceToken).not.toBe(startup.deviceToken)
    expect(await refused(startup, { label: 'Late' })).toContain('not_a_shared_desktop_token')
    // A phone can't fork at all.
    const phone = pair(server, 'Phone', 'mobile')
    expect(await refused(phone, { label: 'Phone' }).catch(() => 'refused')).not.toBeNull()
  })
})
