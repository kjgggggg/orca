import { describe, expect, it, vi } from 'vitest'
import { ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY } from '../../shared/orcad-runtime-capabilities'
import { ORCAD_PEER_DESKTOPS_METHOD } from '../../shared/orcad-peer-desktops-contract'
import { readWslHostPeerDesktops, WSL_HOST_PEER_DESKTOP_RECENT_MS } from './wsl-host-peer-desktops'

const NOW = 10 * WSL_HOST_PEER_DESKTOP_RECENT_MS

function server(peers: unknown, capabilities = [ORCAD_PEER_DESKTOPS_RUNTIME_CAPABILITY]) {
  return vi.fn(async (method: string) => {
    if (method === 'status.get') {
      return { runtimeId: 'r', capabilities }
    }
    if (method === ORCAD_PEER_DESKTOPS_METHOD) {
      return { peers }
    }
    throw new Error(`unexpected ${method}`)
  })
}

describe('readWslHostPeerDesktops', () => {
  it('names another desktop connected now or seen recently', async () => {
    await expect(
      readWslHostPeerDesktops(
        server([
          { name: 'Orca Dev', connected: true, lastSeenAt: 1 },
          { name: 'Orca Beta', connected: false, lastSeenAt: NOW - 1000 }
        ]),
        NOW
      )
    ).resolves.toEqual({ kind: 'shared', names: ['Orca Dev', 'Orca Beta'] })
  })

  it('lets go of a desktop gone longer than the window', async () => {
    await expect(
      readWslHostPeerDesktops(
        server([
          { name: 'Old', connected: false, lastSeenAt: NOW - WSL_HOST_PEER_DESKTOP_RECENT_MS }
        ]),
        NOW
      )
    ).resolves.toEqual({ kind: 'none' })
  })

  it('reports an older server without asking it a method it lacks', async () => {
    const call = server([], [])
    await expect(readWslHostPeerDesktops(call, NOW)).resolves.toEqual({ kind: 'unsupported' })
    expect(call).not.toHaveBeenCalledWith(ORCAD_PEER_DESKTOPS_METHOD, undefined)
  })

  it('throws on an answer it cannot read, so the teardown is refused', async () => {
    await expect(readWslHostPeerDesktops(server('nope'), NOW)).rejects.toThrow()
    const failing = vi.fn(async () => {
      throw new Error('timeout')
    })
    await expect(readWslHostPeerDesktops(failing, NOW)).rejects.toThrow('timeout')
  })
})
