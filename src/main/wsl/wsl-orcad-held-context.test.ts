import { describe, expect, it } from 'vitest'
import { isWsl1KernelRelease } from './wsl-orcad-held-context'

describe('isWsl1KernelRelease', () => {
  it('tells the WSL 1 syscall layer from a WSL 2 kernel, stock or custom', () => {
    expect(isWsl1KernelRelease('4.4.0-19041-Microsoft')).toBe(true)
    expect(isWsl1KernelRelease('4.4.0-22621-Microsoft\n')).toBe(true)
    expect(isWsl1KernelRelease('5.15.167.4-microsoft-standard-WSL2')).toBe(false)
    expect(isWsl1KernelRelease('6.6.36.6-microsoft-standard-WSL2+')).toBe(false)
    expect(isWsl1KernelRelease('6.10.0-custom')).toBe(false)
  })
})
