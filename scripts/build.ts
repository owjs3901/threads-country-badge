import { watch as watchDirectory } from 'node:fs'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const root =
  import.meta.dir === undefined ? process.cwd() : join(import.meta.dir, '..')
const dist = join(root, 'dist')
const watch = process.argv.includes('--watch')

async function build(): Promise<void> {
  await rm(dist, { force: true, recursive: true })
  await mkdir(dist, { recursive: true })

  const result = await Bun.build({
    entrypoints: [
      join(root, 'src/content.ts'),
      join(root, 'src/injected.ts'),
      join(root, 'src/background.ts'),
      join(root, 'src/options.ts'),
    ],
    outdir: dist,
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'linked',
    naming: '[dir]/[name].[ext]',
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }

    throw new Error('Extension bundle failed')
  }

  await copyStatic('manifest.json')
  await copyStatic('options.html')
  await copyFlags()
  console.info(`Built extension into ${dist}`)
}

async function copyStatic(fileName: string): Promise<void> {
  const source = join(root, 'src', fileName)
  const destination = join(dist, fileName)
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination)
}

async function copyFlags(): Promise<void> {
  const source = join(root, 'node_modules', 'flag-icons', 'flags', '4x3')
  const destination = join(dist, 'flags')
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: true })
}

await build()

if (watch) {
  console.info('Watching src/ and scripts/ for changes...')
  const watchers = [join(root, 'src'), join(root, 'scripts')].map((directory) =>
    watchDirectory(directory, { recursive: true }, () => {
      void (async () => {
        try {
          await build()
        } catch (error) {
          console.error(error)
        }
      })()
    }),
  )

  process.once('SIGINT', () => {
    for (const watcher of watchers) {
      watcher.close()
    }

    process.exit(0)
  })

  await new Promise(() => undefined)
}
