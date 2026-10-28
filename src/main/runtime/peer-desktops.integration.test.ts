import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { sendRemoteRuntimeRequest } from '../../shared/remote-runtime/remote-runtime-client'
import {
  ORCAD_PEER_DESKTOPS_METHOD,
  ORCAD_RELEASE_DESKTOP_METHOD,
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

  function call<T>(offer: PairingOffer, method: string) {
    return sendRemoteRuntimeRequest<T>(
      pairedRuntimeConnectionFromOffer(offer),
      method,
      undefined,
      5_000
    )
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
})
