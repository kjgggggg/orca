import { describe, expect, it, vi } from 'vitest'
import { encodePairingOffer, parsePairingCode } from '../../shared/pairing'
import type { ServeReadiness } from '../server/serve-readiness'
import type { WslOrcadLaunch } from './wsl-orcad-deploy'
import { resolveWslOrcadPairing } from './wsl-orcad-pairing-identity'

const STARTUP = encodePairingOffer({
  v: 2,
  endpoint: 'ws://127.0.0.1:6768',
  deviceToken: 'shared',
  publicKeyB64: `${'A'.repeat(43)}=`
})

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: resolution reads only readiness.pairing and port/distro from a launch.
const LAUNCH = {
  outcome: 'ready',
  distro: 'Ubuntu',
  port: 6768,
  readiness: { pairing: { available: true, url: STARTUP } }
} as unknown as Extract<WslOrcadLaunch, { outcome: 'ready' }>

describe('resolveWslOrcadPairing', () => {
  it('splits a first enrollment off the shared startup offer (R39)', async () => {
    const forkDesktop = vi.fn(async (code: string, _readiness: Pick<ServeReadiness, 'pairing'>) =>
      encodePairingOffer({ ...parsePairingCode(code)!, deviceToken: 'own' })
    )
    const code = await resolveWslOrcadPairing(
      LAUNCH,
      42000,
      null,
      async () => ({ verdict: 'verified' }),
      undefined,
      forkDesktop
    )
    expect(forkDesktop).toHaveBeenCalledWith(expect.any(String), LAUNCH.readiness)
    // Through this desktop's bridge, with its own token.
    expect(parsePairingCode(code)?.endpoint).toContain('127.0.0.1:42000')
    expect(parsePairingCode(code)?.deviceToken).toBe('own')
  })
})
