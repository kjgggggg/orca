import type { RemoteMediaAddress } from '../../shared/media-file-extensions'
import type { RuntimeFileReadChunkResult } from '../../shared/runtime-file-contracts'
import { callRuntimeEnvironment } from '../ipc/runtime-environments/runtime-environment-transport-routing'
import { getCanonicalUserDataPath } from '../persistence'

const STAT_TIMEOUT_MS = 15_000
const READ_CHUNK_TIMEOUT_MS = 60_000

export const UPDATE_REQUIRED_MESSAGE =
  'Playing remote media requires a newer Orca on the paired machine. Update it and try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function callRemote(
  address: RemoteMediaAddress,
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
    // Old hosts lack range reads; report the required update instead of method_not_found.
    throw new Error(
      response.error.code === 'method_not_found' ? UPDATE_REQUIRED_MESSAGE : response.error.message
    )
  }
  return response.result
}

export async function statRemoteMedia(
  address: RemoteMediaAddress,
  signal: AbortSignal
): Promise<{ size: number }> {
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
    !Number.isFinite(result.size) ||
    result.size < 0 ||
    typeof result.isDirectory !== 'boolean'
  ) {
    throw new Error('The paired machine returned an unreadable file description.')
  }
  if (result.isDirectory) {
    throw new Error('This path is a directory, not a media file.')
  }
  return { size: result.size }
}

function isReadChunkResult(value: unknown): value is RuntimeFileReadChunkResult {
  return (
    isRecord(value) &&
    typeof value.contentBase64 === 'string' &&
    typeof value.bytesRead === 'number' &&
    typeof value.eof === 'boolean'
  )
}

export async function readRemoteMediaChunk(
  address: RemoteMediaAddress,
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
    throw new Error('The paired machine returned an unreadable media chunk.')
  }
  const bytes = new Uint8Array(Buffer.from(result.contentBase64, 'base64'))
  if (bytes.length !== result.bytesRead) {
    throw new Error('The paired machine returned a corrupted media chunk.')
  }
  return bytes
}

const MAX_SUPPORTED_VERDICTS = 64
const supportedVerdicts = new Map<string, true>()

// Older hosts lack files.readChunk; probing at mint time surfaces the update message before playback.
export async function assertRemoteMediaReadSupported(
  address: RemoteMediaAddress,
  signal: AbortSignal
): Promise<void> {
  const key = JSON.stringify([address.environmentId, address.expectedEnvironmentPairingRevision])
  if (supportedVerdicts.has(key)) {
    return
  }
  await readRemoteMediaChunk(address, 0, 1, signal)
  if (supportedVerdicts.size >= MAX_SUPPORTED_VERDICTS) {
    const oldest = supportedVerdicts.keys().next().value
    if (oldest !== undefined) {
      supportedVerdicts.delete(oldest)
    }
  }
  supportedVerdicts.set(key, true)
}
