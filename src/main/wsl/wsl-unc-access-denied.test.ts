import { describe, expect, it } from 'vitest'
import { describeWslUncAccessDenied } from './wsl-unc-access-denied'

const DRIVE = String.raw`\\wsl.localhost\Ubuntu\mnt\c\src\app`

function failing(code: string) {
  return async () => {
    throw Object.assign(new Error(code), { code })
  }
}

describe('describeWslUncAccessDenied', () => {
  it.each(['EPERM', 'EACCES'])('names a WSL path Windows refused with %s', async (code) => {
    expect(await describeWslUncAccessDenied(DRIVE, failing(code))).toBe(
      `Windows denied access to this WSL path: ${DRIVE}`
    )
  })

  it('leaves other failures, readable paths and non-WSL paths to the usual message', async () => {
    expect(await describeWslUncAccessDenied(DRIVE, failing('ENOENT'))).toBeNull()
    expect(await describeWslUncAccessDenied(DRIVE, async () => [])).toBeNull()
    expect(await describeWslUncAccessDenied(String.raw`C:\src\app`, failing('EPERM'))).toBeNull()
  })
})
