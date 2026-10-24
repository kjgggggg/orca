import { describe, expect, it } from 'vitest'
import { mediaFileMimeType } from './media-file-extensions'

describe('mediaFileMimeType', () => {
  it.each([
    ['a/b.MP4', 'video/mp4'],
    ['a\\b.webm', 'video/webm'],
    ['.mp4', undefined],
    ['dir/.mp4', undefined],
    ['noext', undefined],
    ['x.txt', undefined]
  ])('%s -> %s', (path, expected) => {
    expect(mediaFileMimeType(path)).toBe(expected)
  })
})
