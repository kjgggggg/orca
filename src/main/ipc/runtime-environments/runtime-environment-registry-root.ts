import { app } from 'electron'

/** Where the paired-runtime registry lives; read per call, after `app.setName` settles the casing. */
export function getRuntimeEnvironmentRegistryRoot(): string {
  return app.getPath('userData')
}
