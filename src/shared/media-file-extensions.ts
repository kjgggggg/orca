export const MEDIA_FILE_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

export function mediaFileMimeType(filePath: string): string | undefined {
  const name = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : MEDIA_FILE_MIME_TYPES[name.slice(dot).toLowerCase()]
}

export const MEDIA_PREVIEW_SCHEME = 'orca-media'

export type RemoteMediaAddress = {
  environmentId: string
  /** Runtime worktree selector, e.g. 'id:wt-1'. */
  worktree: string
  relativePath: string
  expectedEnvironmentPairingRevision?: number
}
