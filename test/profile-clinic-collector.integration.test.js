'use strict'

const test = require('tap').test
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { collectClinicProfiler, PROFILERS } = require('../lib/profile-clinic-collector')

const workload = `
const fs = require('node:fs/promises')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const retained = []
const sampleFile = '.clinic-profile-sample'
async function main () {
  for (let i = 0; i < 18; i++) {
    retained.push({ index: i, payload: 'clinic-profile-sample-' + i })
    await fs.writeFile(sampleFile, JSON.stringify(retained))
    await fs.readFile(sampleFile, 'utf8')
    await Promise.resolve().then(() => delay(8))
  }
  let checksum = 0
  for (let i = 0; i < 50000; i++) checksum += i
  retained[0].checksum = checksum
  await delay(350)
  await fs.unlink(sampleFile)
}
main().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\\n')
  process.exitCode = 1
})
`

test('all Clinic collectors run through the worker and return profiler data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clinic-collector-integration-'))
  t.teardown(() => fs.rm(root, { recursive: true, force: true }))

  for (const profiler of PROFILERS) {
    const cwd = path.join(root, 'workload', profiler)
    const dest = path.join(root, 'artifacts', profiler)
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(dest, { recursive: true })
    const workloadFile = path.join(cwd, 'workload.js')
    await fs.writeFile(workloadFile, workload)
    let result
    try {
      result = await collectClinicProfiler(profiler, {
        nodePath: process.execPath,
        args: [workloadFile],
        cwd,
        dest,
        name: `integration-${profiler}`,
        timeoutMs: 15000,
        env: {}
      })
    } catch (error) {
      t.fail(`${profiler} collector failed: ${error.code || 'ERROR'} ${error.message}`)
      continue
    }

    t.equal(result.profiler, profiler, `${profiler} result identifies the selected profiler`)
    t.type(result.profile, 'object', `${profiler} returns analyzed profile data`)
    if (profiler === 'clinic-flame') {
      t.ok(result.profile.sample_count > 0, 'Flame returns samples')
      t.ok(Array.isArray(result.profile.nodes), 'Flame returns call-tree nodes')
      t.type(result.profile.call_tree, 'object', 'Flame preserves a hierarchical call tree for drill-down')
      t.ok(Array.isArray(result.profile.call_tree.children), 'Flame call tree includes child frames')
    } else if (profiler === 'clinic-doctor') {
      t.type(result.profile.issues, 'object', 'Doctor returns issue analysis')
    } else if (profiler === 'clinic-bubbleprof') {
      t.ok(Array.isArray(result.profile.nodes), 'Bubbleprof returns async clusters')
    } else if (profiler === 'clinic-heapprofiler') {
      t.type(result.profile.data, 'object', 'Heap Profiler returns a heap snapshot tree')
      t.ok(result.profile.node_count > 0, 'Heap Profiler returns analyzed nodes')
    } else if (profiler === 'clinic-deoptigate') {
      const logStat = await fs.stat(path.join(result.artifactDir, 'v8.log'))
      const metadata = JSON.parse(await fs.readFile(path.join(result.artifactDir, 'deoptigate.json'), 'utf8'))
      t.ok(logStat.isFile() && logStat.size > 0, 'Deoptigate writes a non-empty V8 log')
      t.equal(metadata.root, cwd, 'Deoptigate stores the declared workload cwd as the source root')
      t.ok(Number.isInteger(result.profile.deoptimization_count) && result.profile.deoptimization_count >= 0, 'Deoptigate returns a non-negative deoptimization count')
      t.ok(Number.isInteger(result.profile.inline_cache_transition_count) && result.profile.inline_cache_transition_count >= 0, 'Deoptigate returns a non-negative inline-cache transition count')
      t.ok(Array.isArray(result.profile.locations), 'Deoptigate returns parsed optimization locations')
      t.ok(result.profile.locations.length > 0, 'Deoptigate identifies optimization events in the workload source')
      t.ok(result.profile.locations.every(location => (
        typeof location.file === 'string' &&
        Number.isInteger(location.line) &&
        (location.kind === 'deoptimization' || location.kind === 'inline-cache') &&
        Number.isInteger(location.count) && location.count > 0 &&
        Number.isFinite(location.severity)
      )), 'Deoptigate locations contain parsed event details')
    }
  }
})
