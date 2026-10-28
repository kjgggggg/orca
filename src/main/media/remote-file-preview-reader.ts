import type { RemoteFilePreviewAddress } from '../../shared/remote-file-preview-address'
import type { RuntimeFileReadChunkResult } from '../../shared/runtime-file-contracts'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/runtime-environment-transport-routing'
import { getCanonicalUserDataPath } from '../persistence'

const STAT_TIMEOUT_MS = 15_000
const READ_CHUNK_TIMEOUT_MS = 60_000

export const REMOTE_PREVIEW_UPDATE_REQUIRED_MESSAGE =
  'Previewing this file requires a newer Orca on the paired machine. Update it and try again.'

/** The pairing that minted a grant is gone; the grant can never answer again. */
export class RemotePreviewPairingChangedError extends Error {}

export type RemotePreviewFileSnapshot = { size: number; mtime: number; ctime?: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function callRemote(
  address: RemoteFilePreviewAddress,
  method: 'files.stat' | 'files.readChunk',
  params: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<unknown> {
  const response = await callRuntimeEnvironment(
    getCanonicalUserDataPath(),
    address.environmentId,
    method,
    params,
    timeoutMs,
    address.expectedEnvironmentPairingRevision,
    undefined,
    { signal }
  )
  if (!response.ok) {
    if (response.error.code === 'runtime_environment_changed') {
      throw new RemotePreviewPairingChangedError(response.error.message)
    }
    // Why: a host without files.stat/readChunk can only be updated, never retried.
    throw new Error(
      response.error.code === 'method_not_found'
        ? REMOTE_PREVIEW_UPDATE_REQUIRED_MESSAGE
        : response.error.message
    )
  }
  return response.result
}

export async function statRemotePreviewFile(
  address: RemoteFilePreviewAddress,
  signal: AbortSignal
): Promise<RemotePreviewFileSnapshot> {
  const result = await callRemote(
    address,
    'files.stat',
    { worktree: address.worktree, relativePath: address.relativePath },
    STAT_TIMEOUT_MS,
    signal
  )
  if (
    !isRecord(result) ||
    typeof result.size !== 'number' ||
    !Number.isSafeInteger(result.size) ||
    result.size < 0 ||
    typeof result.isDirectory !== 'boolean' ||
    typeof result.mtime !== 'number'
  ) {
    throw new Error('The paired machine returned an unreadable file description.')
  }
  if (result.isDirectory) {
    throw new Error('This path is a directory, not a file.')
  }
  return {
    size: result.size,
    mtime: result.mtime,
    ...(typeof result.ctime === 'number' ? { ctime: result.ctime } : {})
  }
}

function isReadChunkResult(value: unknown): value is RuntimeFileReadChunkResult {
  return (
    isRecord(value) &&
    typeof value.contentBase64 === 'string' &&
    typeof value.bytesRead === 'number' &&
    typeof value.eof === 'boolean'
  )
}

export async function readRemotePreviewChunk(
  address: RemoteFilePreviewAddress,
  offset: number,
  length: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const result = await callRemote(
    address,
    'files.readChunk',
    { worktree: address.worktree, relativePath: address.relativePath, offset, length },
    READ_CHUNK_TIMEOUT_MS,
    signal
  )
  if (!isReadChunkResult(result)) {
    throw new Error('The paired machine returned an unreadable file chunk.')
  }
  const bytes = new Uint8Array(Buffer.from(result.contentBase64, 'base64'))
  if (bytes.length !== result.bytesRead || bytes.length > length) {
    throw new Error('The paired machine returned a corrupted file chunk.')
  }
  return bytes
}
