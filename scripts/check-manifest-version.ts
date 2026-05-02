import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertManifestVersionSynced } from './shared/manifest-version'

const root =
  import.meta.dir === undefined ? process.cwd() : join(import.meta.dir, '..')
const manifestPath = join(root, 'src', 'manifest.json')
const packagePath = join(root, 'package.json')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
  version: string
  [key: string]: unknown
}
const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
  version: string
  [key: string]: unknown
}
const version = assertManifestVersionSynced(manifest, packageJson)

console.info(`Manifest version is synced: ${version}`)
