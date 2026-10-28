import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer, parsePairingCode, type PairingOffer } from '../../shared/pairing'
import { ORCAD_FORK_DESKTOP_METHOD } from '../../shared/orcad-peer-desktops-contract'
import { ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/orcad-runtime-capabilities'
import type { ServeReadiness } from '../server/serve-readiness'

const rpc = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../../shared/remote-runtime/remote-runtime-client', () => ({
  sendRemoteRuntimeRequest: rpc.send
}))

import { forkWslOrcadDesktopPairing } from './wsl-orcad-desktop-fork'

const STARTUP: PairingOffer = {
  v: 2,
  endpoint: 'ws://127.0.0.1:6768',
  deviceToken: 'shared',
  publicKeyB64: `${'A'.repeat(43)}=`
}
const TUNNELED = encodePairingOffer({ ...STARTUP, endpoint: 'ws://127.0.0.1:42000' })
const READINESS: Pick<ServeReadiness, 'pairing'> = {
  pairing: {
    available: true,
    url: encodePairingOffer(STARTUP),
    endpoint: STARTUP.endpoint,
    deviceId: 'startup',
    webClientUrl: null,
    scope: 'runtime',
    qr: null
  }
}

function server(capabilities: string[], fork: unknown) {
  rpc.send.mockImplementation(async (_connection: unknown, method: string) =>
    method === 'status.get'
      ? { id: 's', ok: true, result: { capabilities }, _meta: {} }
      : method === ORCAD_FORK_DESKTOP_METHOD
        ? fork
        : { id: 'x', ok: false, error: { code: 'nope', message: 'nope' }, _meta: {} }
  )
}

describe('forkWslOrcadDesktopPairing', () => {
  beforeEach(() => {
    rpc.send.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('swaps the shared startup token for this desktop’s own, keeping the tunnel endpoint', async () => {
    server([ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY], {
      id: 'f',
      ok: true,
      result: { deviceId: 'own', token: 'own-token' },
      _meta: {}
    })
    const forked = parsePairingCode(await forkWslOrcadDesktopPairing(TUNNELED, READINESS, 'Orca'))
    expect(forked).toMatchObject({ endpoint: 'ws://127.0.0.1:42000', deviceToken: 'own-token' })
    expect(rpc.send).toHaveBeenCalledWith(
      expect.anything(),
      ORCAD_FORK_DESKTOP_METHOD,
      { label: 'Orca' },
      expect.any(Number)
    )
  })

  it('leaves an own pairing alone without asking the server anything', async () => {
    const own = encodePairingOffer({ ...STARTUP, deviceToken: 'own-token' })
    await expect(forkWslOrcadDesktopPairing(own, READINESS, 'Orca')).resolves.toBe(own)
    expect(rpc.send).not.toHaveBeenCalled()
  })

  it('keeps the shared pairing on an older server, or when the fork fails', async () => {
    server([], null)
    await expect(forkWslOrcadDesktopPairing(TUNNELED, READINESS, 'Orca')).resolves.toBe(TUNNELED)
    expect(rpc.send).not.toHaveBeenCalledWith(
      expect.anything(),
      ORCAD_FORK_DESKTOP_METHOD,
      expect.anything(),
      expect.anything()
    )
    server([ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY], {
      id: 'f',
      ok: false,
      error: { code: 'too_many_forks', message: 'too_many_forks' },
      _meta: {}
    })
    await expect(forkWslOrcadDesktopPairing(TUNNELED, READINESS, 'Orca')).resolves.toBe(TUNNELED)
  })
})
