/**
 * Guards the runtime routing of local Git: every runner entry point that takes Git options routes
 * them, and every deliberate `hostGit: true` says why on the line above.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNNER_DIR = join(__dirname)
const ENTRY_FILES = ['git-exec-file.ts', 'git-spawn.ts', 'git-stream-stdout.ts']
// Tests, mocks, harnesses and fixtures stand in for Git; they run none.
const TEST_SUPPORT = /\.test\.ts$|mock|harness|fixture/i
const MAIN_DIR = join(__dirname, '..', '..')
const REPO_ROOT = join(MAIN_DIR, '..', '..')

const COMMENT_LINE = /^\s*(\*|\/\/|\/\*)/

/** Files whose code, not only a comment, contains `text`. */
function sourcesMentioning(text: string): string[] {
  return readdirSync(MAIN_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !TEST_SUPPORT.test(file))
    .map((file) => join(MAIN_DIR, file))
    .filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some((line) => line.includes(text) && !COMMENT_LINE.test(line))
    )
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
        if (!line.includes('hostGit: true') || COMMENT_LINE.test(line)) {
          return
        }
        const above = [lines[index - 1] ?? '', lines[index - 2] ?? ''].join('\n')
        expect(above, `${file}:${index + 1}`).toMatch(/\/\/ Host Git on purpose: \S/)
      })
    }
  })

  it('keeps deliberate host Git to the calls that run before a project owns the folder', () => {
    expect(sourcesMentioning('hostGit: true').sort()).toEqual([
      // Repo detection, read-only.
      'src/main/git/repo-detection-command.ts',
      // Clone and init make a new repo.
      'src/main/ipc/repos/repo-clone-lifecycle.ts',
      'src/main/ipc/repos/repo-creation-handlers.ts',
      // The checks whether Git for Windows can take a project over.
      'src/main/ipc/wsl-drive-project-handlers.ts',
      'src/main/ipc/wsl-drive-unc-conversion-handlers.ts',
      // The remote read while a project is being added.
      'src/main/repo-icon-autodetect.ts',
      'src/main/runtime/runtime-repository-clone-controller.ts',
      'src/main/runtime/runtime-repository-registration-controller.ts',
      // The setup runner's path lookup, synchronous; with the router on it reads the link instead.
      'src/main/worktree-runner-script.ts'
    ])
  })

  it('keeps synchronous Git host-only, so routing never puts wsl.exe on the main thread', () => {
    const sync = readFileSync(join(RUNNER_DIR, 'git-exec-file-sync.ts'), 'utf8')
    expect(sync).not.toContain('routeLocalGitOptions')
    expect(sync).toContain('hostGit: HostGitOnly')
  })
})
