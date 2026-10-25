/**
 * Guards the runtime routing of local Git: every runner entry point that takes Git options routes
 * them, and every deliberate `hostGit: true` says why on the line above.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNNER_DIR = join(__dirname)
const ENTRY_FILES = ['git-exec-file.ts', 'git-spawn.ts', 'git-stream-stdout.ts']
// git-exec-file-sync.ts is host-only on purpose: its callers run before a project exists.
// Tests, mocks, harnesses and fixtures stand in for Git; they run none.
const TEST_SUPPORT = /\.test\.ts$|mock|harness|fixture/i
const MAIN_DIR = join(__dirname, '..', '..')
const REPO_ROOT = join(MAIN_DIR, '..', '..')

function sourcesMentioning(text: string): string[] {
  return readdirSync(MAIN_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !TEST_SUPPORT.test(file))
    .map((file) => join(MAIN_DIR, file))
    .filter((file) => readFileSync(file, 'utf8').includes(text))
    .map((file) => relative(REPO_ROOT, file).replaceAll('\\', '/'))
}

const HOST_ONLY_ENTRIES = new Set<string>()

describe('local Git runtime routing guard', () => {
  it('routes the options of every exported runner entry point', () => {
    const checked: string[] = []
    for (const file of ENTRY_FILES) {
      const source = readFileSync(join(RUNNER_DIR, file), 'utf8')
      for (const body of source.split(/\nexport (?:async )?function /).slice(1)) {
        const name = body.slice(0, body.indexOf('('))
        if (HOST_ONLY_ENTRIES.has(name)) {
          continue
        }
        checked.push(name)
        expect(body.slice(0, 400), `${file}: ${name}`).toContain(
          'routeLocalGitOptions(callerOptions)'
        )
      }
    }
    expect(checked).toHaveLength(6)
  })

  it('has a reason above every deliberate host-Git call', () => {
    const files = sourcesMentioning('hostGit: true')
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split('\n')
      lines.forEach((line, index) => {
        // Code only: a doc comment may name the option.
        if (!line.includes('hostGit: true') || /^\s*(\*|\/\/)/.test(line)) {
          return
        }
        const above = [lines[index - 1] ?? '', lines[index - 2] ?? ''].join('\n')
        expect(above, `${file}:${index + 1}`).toMatch(/\/\/ Host Git on purpose: \S/)
      })
    }
  })

  it('keeps unrouted synchronous Git to the callers that run before a project exists', () => {
    const callers = sourcesMentioning('gitExecFileSync').sort()
    expect(callers).toEqual([
      'src/main/git/command-runner/git-exec-file-sync.ts',
      'src/main/git/repo-detection-command.ts',
      'src/main/git/runner.ts',
      'src/main/worktree-runner-script.ts'
    ])
  })
})
