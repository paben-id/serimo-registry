import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const prefix = 'items/serimo/lower-third-slide/0.1.1'
const sourceNames = [
  'lower-third-slide.tsx',
  'lower-third-slide.css',
  'lower-third-slide.license.json'
]

export const APPROVED_HASHES = Object.freeze({
  'index.json': '2d463315010de99ec944b43274797f4f63410f270e21836d70b7dfd88ec728b4',
  [`${prefix}/manifest.json`]: '45e9e9f930d69ffd565d79a98a8513de0a129f4e35db3195df6b565587847dfd',
  [`${prefix}/files/lower-third-slide.tsx`]: 'cf67680ce46c9a742667bbfbad0cb539ff524f693d45b4270b4ba9e0e4ec4b1c',
  [`${prefix}/files/lower-third-slide.css`]: '7fd88d77f69e55d38df6e2d993481dc5709de837a5be91bd02a92ea9a0e1b2e1',
  [`${prefix}/files/lower-third-slide.license.json`]: 'aad5fe99c5c2f9d307414442738b853516ec29c717fc21f0c8b454002992074b'
})

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const privatePattern = /@repo\/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|[A-Za-z]:\\(?:Users|Devs)\\/i

async function filesUnder(root) {
  const found = []
  async function visit(relative = '') {
    const dir = join(root, ...relative.split('/').filter(Boolean))
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) throw new Error(`symlink: ${path}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) found.push(path)
      else throw new Error(`non-file path: ${path}`)
    }
  }
  if (!(await lstat(root)).isDirectory()) throw new Error('artifact root is not a directory')
  await visit()
  return found.sort()
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(`invalid JSON: ${label}`)
  }
}

function validateDocuments(contents) {
  const index = parseJson(contents.get('index.json'), 'index')
  const item = index?.items?.[0]
  if (
    index?.schemaVersion !== 1 ||
    index.namespace !== 'serimo' ||
    index.items?.length !== 1 ||
    item?.name !== 'lower-third-slide' ||
    item.latest !== '0.1.1' ||
    JSON.stringify(item.versions) !== '["0.1.1"]' ||
    item.manifest !== 'items/serimo/lower-third-slide/{version}/manifest.json'
  ) throw new Error('invalid one-item index')

  const manifest = parseJson(contents.get(`${prefix}/manifest.json`), 'manifest')
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.name !== '@serimo/lower-third-slide' ||
    manifest.version !== '0.1.1' ||
    manifest.type !== 'component' ||
    manifest.license !== 'MIT' ||
    manifest.dependencies?.react !== '19.3.0' ||
    manifest.dependencies?.gsap !== '3.15.0' ||
    Object.keys(manifest.dependencies).length !== 2 ||
    JSON.stringify(manifest.registryDependencies) !== '[]' ||
    manifest.files?.length !== sourceNames.length
  ) throw new Error('invalid candidate manifest')
  for (const name of sourceNames) {
    const entries = manifest.files.filter(file => file?.path === name)
    if (
      entries.length !== 1 ||
      entries[0].target !== `components/motion/${name}` ||
      entries[0].url !== `./files/${name}` ||
      entries[0].sha256 !== hash(contents.get(`${prefix}/files/${name}`))
    ) throw new Error(`manifest hash mismatch: ${name}`)
  }
  const notice = parseJson(contents.get(`${prefix}/files/lower-third-slide.license.json`), 'license')
  if (notice?.license !== 'MIT' || notice.copyright !== 'Copyright (c) 2026 Paben')
    throw new Error('invalid item notice')
}

export async function auditArtifact(root, { expected = APPROVED_HASHES, previousRoot } = {}) {
  const allowed = Object.keys(expected).sort()
  const actual = await filesUnder(root)
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    const extra = actual.find(path => !allowed.includes(path))
    throw new Error(`unexpected path or missing approved file: ${extra ?? 'missing file'}`)
  }

  const contents = new Map()
  const digests = {}
  for (const path of allowed) {
    const bytes = await readFile(join(root, ...path.split('/')))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (privatePattern.test(text)) throw new Error(`private content: ${path}`)
    const digest = hash(bytes)
    if (digest !== expected[path]) throw new Error(`hash mismatch: ${path}`)
    contents.set(path, bytes)
    digests[path] = digest
  }
  validateDocuments(contents)

  if (previousRoot && existsSync(previousRoot)) {
    for (const path of await filesUnder(previousRoot)) {
      if (!path.startsWith('items/')) continue
      const before = await readFile(join(previousRoot, ...path.split('/')))
      const after = contents.get(path)
      if (!after || !before.equals(after)) throw new Error(`immutable version changed: ${path}`)
    }
  }
  return digests
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [root, previousRoot] = process.argv.slice(2)
  if (!root) throw new Error('usage: node scripts/audit.mjs <v1-root> [previous-v1-root]')
  if (!existsSync(root)) {
    if (previousRoot && existsSync(previousRoot)) throw new Error('approved artifact removed')
    process.stdout.write('Bootstrap check: no registry item source present\n')
  } else {
    const digests = await auditArtifact(root, { previousRoot })
    process.stdout.write(`Approved artifact: ${Object.keys(digests).length} exact files\n`)
  }
}
