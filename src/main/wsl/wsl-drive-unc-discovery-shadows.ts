/**
 * Startup lists a UNC Windows-drive project's worktrees under their drive paths, so discovery may
 * already have written a drive-keyed row for a folder the project saved under its UNC path. Such a
 * row holds only bookkeeping; dropping it, its identity aliases and its identity-keyed row lets the
 * converted row, which carries the user's data, take the key.
 */
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { PersistedState } from '../../shared/persisted-state-types'
import { composeWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'

// What discovery writes on its own; any other field with a value is the user's.
const DISCOVERY_FIELDS: ReadonlySet<string> = new Set([
  'instanceId',
  'projectId',
  'hostId',
  'projectHostSetupId',
  'sortOrder',
  'lastActivityAt',
  'isUnread',
  'workspaceStatus',
  'smartTier'
])

/** `worktreeIds` maps each converting UNC worktree id to its drive id. */
export function withoutDiscoveryShadows(
  state: PersistedState,
  worktreeIds: ReadonlyMap<string, string>
): PersistedState {
  const meta = { ...state.worktreeMeta }
  const aliases = state.worktreeIdentityAliases && { ...state.worktreeIdentityAliases }
  const byIdentity = state.worktreeMetaByIdentity && { ...state.worktreeMetaByIdentity }
  let dropped = false
  for (const [oldId, newId] of worktreeIds) {
    const shadow = meta[newId]
    if (!meta[oldId] || !shadow || !isDiscoveryOnly(shadow)) {
      continue
    }
    delete meta[newId]
    const aliasKey = composeWorktreeHostIdentity(LOCAL_EXECUTION_HOST_ID, newId)
    const kept = new Set(
      aliases?.[composeWorktreeHostIdentity(LOCAL_EXECUTION_HOST_ID, oldId)] ?? []
    )
    for (const identity of aliases?.[aliasKey] ?? []) {
      if (byIdentity && !kept.has(identity) && isDiscoveryOnlyRow(byIdentity[identity])) {
        delete byIdentity[identity]
      }
    }
    if (aliases) {
      delete aliases[aliasKey]
    }
    dropped = true
  }
  return dropped
    ? {
        ...state,
        worktreeMeta: meta,
        ...(aliases ? { worktreeIdentityAliases: aliases } : {}),
        ...(byIdentity ? { worktreeMetaByIdentity: byIdentity } : {})
      }
    : state
}

function isDiscoveryOnlyRow(row: WorktreeMeta | undefined): boolean {
  return row === undefined || isDiscoveryOnly(row)
}

function isDiscoveryOnly(row: WorktreeMeta): boolean {
  return Object.entries(row).every(
    ([field, value]) =>
      DISCOVERY_FIELDS.has(field) ||
      value === undefined ||
      value === null ||
      value === '' ||
      value === false ||
      (Array.isArray(value) && value.length === 0)
  )
}
