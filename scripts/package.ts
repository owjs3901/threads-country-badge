import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const root =
  import.meta.dir === undefined ? process.cwd() : join(import.meta.dir, '..')
const dist = join(root, 'dist')
const release = join(root, 'release')
const packageJsonPath = join(root, 'package.json')
const CRC_TABLE = createCrcTable()

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
  name: string
  version: string
}
const zipPath = join(release, `${packageJson.name}-${packageJson.version}.zip`)
const files = await listFiles(dist)

if (!files.some((file) => file.endsWith('manifest.json'))) {
  throw new Error('Cannot package extension: dist/manifest.json is missing')
}

await mkdir(release, { recursive: true })
await rm(zipPath, { force: true })
await writeFile(zipPath, await createZip(files))

console.info(`Created ${relative(root, zipPath)}`)

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const result: string[] = []

  for (const entry of entries) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      result.push(...(await listFiles(path)))
      continue
    }

    if (entry.isFile()) {
      result.push(path)
    }
  }

  return result.sort((left, right) =>
    zipName(left).localeCompare(zipName(right), 'en'),
  )
}

async function createZip(paths: readonly string[]): Promise<Buffer> {
  const fileRecords: Buffer[] = []
  const centralRecords: Buffer[] = []
  let offset = 0

  for (const path of paths) {
    const data = await readFile(path)
    const name = zipName(path)
    const nameBuffer = Buffer.from(name, 'utf8')
    const metadata = await stat(path)
    const { date, time } = dosDateTime(metadata.mtime)
    const crc = crc32(data)
    const local = localFileHeader(nameBuffer, data, crc, time, date)
    const central = centralDirectoryHeader(
      nameBuffer,
      data,
      crc,
      time,
      date,
      offset,
    )

    fileRecords.push(local, data)
    centralRecords.push(central)
    offset += local.length + data.length
  }

  const centralDirectory = Buffer.concat(centralRecords)
  const end = endOfCentralDirectory(
    paths.length,
    centralDirectory.length,
    offset,
  )

  return Buffer.concat([...fileRecords, centralDirectory, end])
}

function zipName(path: string): string {
  return relative(dist, path).split(sep).join('/')
}

function localFileHeader(
  name: Buffer,
  data: Buffer,
  crc: number,
  time: number,
  date: number,
): Buffer {
  const header = Buffer.alloc(30 + name.length)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(time, 10)
  header.writeUInt16LE(date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  name.copy(header, 30)

  return header
}

function centralDirectoryHeader(
  name: Buffer,
  data: Buffer,
  crc: number,
  time: number,
  date: number,
  offset: number,
): Buffer {
  const header = Buffer.alloc(46 + name.length)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(time, 12)
  header.writeUInt16LE(date, 14)
  header.writeUInt32LE(crc, 16)
  header.writeUInt32LE(data.length, 20)
  header.writeUInt32LE(data.length, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(offset, 42)
  name.copy(header, 46)

  return header
}

function endOfCentralDirectory(
  count: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return end
}

function dosDateTime(value: Date): { date: number; time: number } {
  const year = Math.max(value.getFullYear(), 1980)

  return {
    date:
      ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    time:
      (value.getHours() << 11) |
      (value.getMinutes() << 5) |
      Math.floor(value.getSeconds() / 2),
  }
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256)

  for (let index = 0; index < table.length; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    table[index] = value >>> 0
  }

  return table
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff

  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}
