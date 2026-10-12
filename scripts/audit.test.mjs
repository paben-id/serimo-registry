import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import { auditArtifact } from './audit.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const prefix = 'items/serimo/lower-third-slide/0.1.1'
const sourcePaths = [
  `${prefix}/files/lower-third-slide.tsx`,
  `${prefix}/files/lower-third-slide.css`,
  `${prefix}/files/lower-third-slide.license.json`
]

async function fixture(root) {
  const files = new Map([
    [sourcePaths[0], 'import { gsap } from "gsap"\nexport const name = "lower-third"\n'],
    [sourcePaths[1], '.lower-third { opacity: 1; }\n'],
    [sourcePaths[2], JSON.stringify({ license: 'MIT', copyright: 'Copyright (c) 2026 Paben', text: 'MIT License' })]
  ])
  const manifest = {
    schemaVersion: 1,
    name: '@serimo/lower-third-slide',
    version: '0.1.1',
    type: 'component',
    license: 'MIT',
    files: sourcePaths.map(path => ({
      path: path.split('/').at(-1),
      target: `components/motion/${path.split('/').at(-1)}`,
      url: `./files/${path.split('/').at(-1)}`,
      sha256: hash(files.get(path))
    })),
    dependencies: { react: '19.3.0', gsap: '3.15.0' },
    registryDependencies: []
  }
  files.set(`${prefix}/manifest.json`, JSON.stringify(manifest))
  files.set('index.json', JSON.stringify({
    schemaVersion: 1,
    namespace: 'serimo',
    items: [{ name: 'lower-third-slide', latest: '0.1.1', versions: ['0.1.1'], manifest: 'items/serimo/lower-third-slide/{version}/manifest.json' }]
  }))
  for (const [path, content] of files) {
    const absolute = join(root, ...path.split('/'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  return Object.fromEntries([...files].map(([path, content]) => [path, hash(content)]))
}

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'serimo-audit-'))
  try {
    const expected = await fixture(root)
    await run(root, expected)
  } finally {
    await removeTestRoot(root, 'serimo-audit-')
  }
}

async function removeTestRoot(root, prefix) {
  const target = resolve(root)
  if (
    dirname(target).toLowerCase() !== resolve(tmpdir()).toLowerCase() ||
    !basename(target).startsWith(prefix)
  ) throw new Error(`unsafe test cleanup: ${target}`)
  await rm(target, { recursive: true, force: true })
}

test('accepts an exact one-item artifact', async () => {
  await withFixture(async (root, expected) => {
    assert.deepEqual(await auditArtifact(root, { expected }), expected)
  })
})

test('rejects extra and private-version files', async () => {
  await withFixture(async (root, expected) => {
    await writeFile(join(root, 'extra.txt'), 'unexpected')
    await assert.rejects(auditArtifact(root, { expected }), /unexpected path/)
  })
  await withFixture(async (root, expected) => {
    const path = join(root, 'items/serimo/lower-third-slide/0.1.0/manifest.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, '{}')
    await assert.rejects(auditArtifact(root, { expected }), /unexpected path/)
  })
})

test('rejects changed source hashes and private imports', async () => {
  await withFixture(async (root, expected) => {
    await writeFile(join(root, ...sourcePaths[1].split('/')), 'changed')
    await assert.rejects(auditArtifact(root, { expected }), /hash mismatch/)
  })
  await withFixture(async (root, expected) => {
    const path = sourcePaths[0]
    const content = 'import x from "@repo/core"\n'
    await writeFile(join(root, ...path.split('/')), content)
    expected[path] = hash(content)
    await assert.rejects(auditArtifact(root, { expected }), /private content/)
  })
})

test('rejects symlinks', async t => {
  await withFixture(async (root, expected) => {
    try {
      await symlink(join(root, 'index.json'), join(root, 'link.json'))
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('symlink creation is unavailable on this host')
        return
      }
      throw error
    }
    await assert.rejects(auditArtifact(root, { expected }), /unexpected path|symlink/)
  })
})

test('rejects changed previously published bytes', async () => {
  await withFixture(async (root, expected) => {
    const previous = await mkdtemp(join(tmpdir(), 'serimo-previous-'))
    try {
      await fixture(previous)
      const changed = '.lower-third { opacity: 0; }\n'
      await writeFile(join(root, ...sourcePaths[1].split('/')), changed)
      expected[sourcePaths[1]] = hash(changed)
      const manifestPath = `${prefix}/manifest.json`
      const manifest = JSON.parse(await readFile(join(root, ...manifestPath.split('/'))))
      manifest.files[1].sha256 = hash(changed)
      const bytes = JSON.stringify(manifest)
      await writeFile(join(root, ...manifestPath.split('/')), bytes)
      expected[manifestPath] = hash(bytes)
      await assert.rejects(auditArtifact(root, { expected, previousRoot: previous }), /immutable version/)
    } finally {
      await removeTestRoot(previous, 'serimo-previous-')
    }
  })
})

test('rejects manifest source digest mismatch', async () => {
  await withFixture(async (root, expected) => {
    const path = `${prefix}/manifest.json`
    const manifest = JSON.parse(await readFile(join(root, ...path.split('/'))))
    manifest.files[0].sha256 = '0'.repeat(64)
    const bytes = JSON.stringify(manifest)
    await writeFile(join(root, ...path.split('/')), bytes)
    expected[path] = hash(bytes)
    await assert.rejects(auditArtifact(root, { expected }), /manifest hash mismatch/)
  })
})
