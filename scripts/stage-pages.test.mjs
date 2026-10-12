import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'

import { APPROVED_HASHES } from './audit.mjs'
import { ENTRY_HTML, stagePages } from './stage-pages.mjs'

const sourceRoot = fileURLToPath(new URL('../v1/', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), 'serimo-pages-'))
  try {
    await run(root)
  } finally {
    const target = resolve(root)
    if (
      dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('serimo-pages-')
    )
      throw new Error(`unsafe test cleanup: ${target}`)
    await rm(target, { recursive: true, force: true })
  }
}

test('stages the five approved bytes under v1 and one root entry', async () => {
  await withRoot(async root => {
    const site = join(root, 'site')
    const inventory = await stagePages(sourceRoot, site)
    assert.deepEqual((await readdir(site)).sort(), ['index.html', 'v1'])
    assert.equal(await readFile(join(site, 'index.html'), 'utf8'), ENTRY_HTML)
    assert.equal(inventory['index.html'], hash(ENTRY_HTML))
    for (const [path, expected] of Object.entries(APPROVED_HASHES)) {
      const bytes = await readFile(join(site, 'v1', ...path.split('/')))
      assert.equal(hash(bytes), expected)
      assert.equal(inventory[`v1/${path}`], expected)
    }
    assert.equal(Object.keys(inventory).length, 6)
  })
})

test('rejects an altered source before creating a site', async () => {
  await withRoot(async root => {
    const source = join(root, 'source')
    await cp(sourceRoot, source, { recursive: true })
    await writeFile(join(source, 'index.json'), '{}')
    const site = join(root, 'site')
    await assert.rejects(stagePages(source, site), /hash mismatch/)
    await assert.rejects(readdir(site), { code: 'ENOENT' })
  })
})

test('refuses to replace an existing staged site', async () => {
  await withRoot(async root => {
    const site = join(root, 'site')
    await mkdir(site)
    await assert.rejects(stagePages(sourceRoot, site), /site already exists/)
  })
})
