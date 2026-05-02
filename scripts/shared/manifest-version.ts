export interface VersionedManifest {
  version: string
  [key: string]: unknown
}

export interface VersionedPackageJson {
  version: string
  [key: string]: unknown
}

const CHROME_EXTENSION_VERSION = /^\d+(?:\.\d+){0,3}$/

export function assertChromeExtensionVersion(version: string): string {
  if (!CHROME_EXTENSION_VERSION.test(version)) {
    throw new Error(
      `Invalid Chrome extension version: ${version}. Use 1 to 4 dot-separated numeric components.`,
    )
  }

  return version
}

export function syncManifestVersion(
  manifest: VersionedManifest,
  packageJson: VersionedPackageJson,
): VersionedManifest {
  return {
    ...manifest,
    version: assertChromeExtensionVersion(packageJson.version),
  }
}

export function assertManifestVersionSynced(
  manifest: VersionedManifest,
  packageJson: VersionedPackageJson,
): string {
  const version = assertChromeExtensionVersion(packageJson.version)

  if (manifest.version !== version) {
    throw new Error(
      `Manifest version ${manifest.version} does not match package version ${version}. Run bun run manifest:sync.`,
    )
  }

  return version
}

export function releaseArchiveName(name: string, version: string): string {
  return `${name}-${assertChromeExtensionVersion(version)}.zip`
}
