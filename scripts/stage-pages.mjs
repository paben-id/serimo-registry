import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditArtifact } from './audit.mjs'

export const ENTRY_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Serimo Registry</title></head>
<body><p>Registry API: <a href="./v1/index.json">v1/index.json</a></p></body>
</html>
`

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function stagePages(sourceRoot, siteRoot) {
  if (existsSync(siteRoot)) throw new Error('site already exists')
  await auditArtifact(sourceRoot)

  await mkdir(siteRoot)
  await cp(sourceRoot, join(siteRoot, 'v1'), {
    recursive: true,
    force: false,
    errorOnExist: true
  })
  await writeFile(join(siteRoot, 'index.html'), ENTRY_HTML)

  const rootEntries = (await readdir(siteRoot)).sort()
  if (JSON.stringify(rootEntries) !== '["index.html","v1"]')
    throw new Error('unexpected Pages root path')
  const copied = await auditArtifact(join(siteRoot, 'v1'))
  const entryBytes = await readFile(join(siteRoot, 'index.html'))
  if (!entryBytes.equals(Buffer.from(ENTRY_HTML, 'utf8')))
    throw new Error('Pages entry changed')

  return Object.fromEntries([
    ['index.html', hash(entryBytes)],
    ...Object.entries(copied).map(([path, digest]) => [`v1/${path}`, digest])
  ])
}

if (
  process.argv[1] &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  const [sourceRoot, siteRoot] = process.argv.slice(2)
  if (!sourceRoot || !siteRoot)
    throw new Error(
      'usage: node scripts/stage-pages.mjs <v1-root> <new-site-root>'
    )
  const inventory = await stagePages(sourceRoot, siteRoot)
  process.stdout.write(
    `Staged Pages artifact: ${Object.keys(inventory).length} exact files\n`
  )
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`)
}
