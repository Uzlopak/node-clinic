'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('tap').test
const { hashInputPath, openInputMount } = require('../lib/profile-input-mounts')
const { createSourceRoots } = require('../lib/profile-source-roots')
const { analyzeClinicDiagnostics } = require('../lib/profile-analyzer')

test('hashes file inputs and opens only digest-matching read-only mounts', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-input-mount-'))
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'fixture.json')
  fs.writeFileSync(source, '{"items":[1,2,3]}')
  const digest = hashInputPath(source)
  t.match(digest, /^sha256-[a-f0-9]{64}$/)

  const mount = openInputMount({
    source_root: 'workspace',
    source: 'fixture.json',
    target: '/inputs/fixture.json',
    digest
  }, { workspace: root })
  t.equal(fs.fstatSync(mount.fd).isFile(), true)
  t.equal(mount.target, '/inputs/fixture.json')
  fs.closeSync(mount.fd)

  t.throws(() => openInputMount({
    source_root: 'workspace',
    source: 'fixture.json',
    target: '/inputs/fixture.json',
    digest: `sha256-${'0'.repeat(64)}`
  }, { workspace: root }), { code: 'INPUT_DIGEST_MISMATCH' })
  t.end()
})

test('directory input digests are deterministic and cover relative paths and contents', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-input-tree-'))
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }))
  const directory = path.join(root, 'assets')
  fs.mkdirSync(path.join(directory, 'nested'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'nested', 'b.json'), '{"b":2}')
  fs.writeFileSync(path.join(directory, 'a.json'), '{"a":1}')
  const first = hashInputPath(directory)
  t.equal(hashInputPath(directory), first)
  fs.writeFileSync(path.join(directory, 'nested', 'b.json'), '{"b":3}')
  t.not(hashInputPath(directory), first)
  t.end()
})

test('input mounts reject symlinks, noncanonical targets, and unconfigured roots', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-input-invalid-'))
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }))
  const secret = path.join(root, 'secret')
  const link = path.join(root, 'linked')
  fs.writeFileSync(secret, 'private')
  fs.symlinkSync(secret, link)
  const mount = {
    source_root: 'workspace',
    source: 'linked',
    target: '/inputs/linked',
    digest: `sha256-${'0'.repeat(64)}`
  }
  t.throws(() => openInputMount(mount, { workspace: root }), { code: 'INVALID_INPUT_MOUNT' })
  t.throws(() => openInputMount({ ...mount, source: 'secret', target: '/workspace/secret' }, { workspace: root }), { code: 'INVALID_INPUT_MOUNT' })
  t.throws(() => openInputMount({ ...mount, source: 'secret', source_root: 'declared-input' }, { workspace: root }), { code: 'ISOLATION_UNAVAILABLE' })
  t.end()
})

test('source roots map declared input mounts without exposing host paths', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-source-roots-'))
  const declaredInputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clinic-source-input-'))
  t.teardown(() => fs.rmSync(root, { recursive: true, force: true }))
  t.teardown(() => fs.rmSync(declaredInputRoot, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'bench'))
  const inputFile = path.join(declaredInputRoot, 'fixture.js')
  fs.writeFileSync(inputFile, 'module.exports = 1\n')
  const mount = {
    source_root: 'declared-input',
    source: 'fixture.js',
    target: '/inputs/corpus/fixture.js',
    digest: hashInputPath(inputFile)
  }
  const roots = createSourceRoots({ cwd: '/workspace/bench', input_mounts: [mount] }, root, declaredInputRoot)
  t.same(roots.map(entry => entry.reportPrefix), ['bench', '', 'inputs/corpus/fixture.js'])
  t.equal(roots[0].root, path.join(root, 'bench'))
  t.equal(roots[2].root, inputFile)

  const profile = file => analyzeClinicDiagnostics('clinic-deoptigate', {
    deoptimization_count: 1,
    inline_cache_transition_count: 0,
    locations: [{ file, line: 1, kind: 'deoptimization', reason: 'wrong map', count: 1, severity: 2 }]
  }, { source_roots: roots, workload: 'mounted-input' })
  t.same(profile('/inputs/corpus/fixture.js').findings[0].location, {
    file: 'inputs/corpus/fixture.js',
    line: 1
  }, 'maps the container-visible single-file input path')
  t.same(profile(inputFile).findings[0].location, {
    file: 'inputs/corpus/fixture.js',
    line: 1
  }, 'maps the host-visible single-file input path without exposing its location')
  t.end()
})
