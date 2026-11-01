'use strict'

const fs = require('fs')
const path = require('path')
const url = require('url')
const test = require('tap').test
const cli = require('./cli.js')

const version = require('@clinic/deoptigate/package.json').version

test('clinic deoptigate --help', function (t) {
  cli({ relayStderr: false }, ['clinic', 'deoptigate', '--help'], function (err, stdout) {
    t.error(err)
    t.match(stdout, /Clinic\.js Deoptigate/)
    t.match(stdout, /--visualize-only/)
    t.end()
  })
})

test('clinic deoptigate --version', function (t) {
  cli({ relayStderr: false }, ['clinic', 'deoptigate', '--version'], function (err, stdout) {
    t.error(err)
    t.equal(stdout, `v${version}\n`)
    t.end()
  })
})

test('clinic deoptigate rejects commands that do not start with Node.js', function (t) {
  cli({ relayStderr: false }, ['clinic', 'deoptigate', '--', 'sh', 'script.sh'], function (err, stdout) {
    t.match(err, /process exited with exit code 1/)
    t.match(stdout, /Clinic\.js Deoptigate/)
    t.end()
  })
})

test('clinic deoptigate collects data and visualizes it later', function (t) {
  const name = 'deoptigate-cli-test'
  cli({}, [
    'clinic', 'deoptigate', '--collect-only', '--name', name,
    '--', 'node', '-e', 'setTimeout(() => {}, 20)'
  ], function (err, stdout, stderr, tempdir) {
    t.error(err, stderr)
    if (err) return t.end()
    const dataPath = path.resolve(tempdir, '.clinic', `${name}.clinic-deoptigate`)
    t.match(stdout, /Output file is \.clinic[/\\]deoptigate-cli-test\.clinic-deoptigate/)
    t.ok(fs.statSync(path.join(dataPath, 'v8.log')).isFile(), 'writes the V8 log')
    t.ok(fs.statSync(path.join(dataPath, 'deoptigate.json')).isFile(), 'writes run metadata')

    cli({ cwd: tempdir, relayStderr: false }, [
      'clinic', 'deoptigate', '--no-open', '--visualize-only', dataPath
    ], function (err, visualizeStdout, visualizeStderr) {
      t.error(err, visualizeStderr)
      if (err) return t.end()
      t.equal(visualizeStdout, `Generated HTML file is ${url.pathToFileURL(dataPath)}.html\n`)
      const html = fs.readFileSync(`${dataPath}.html`, 'utf8')
      t.match(html, /Clinic Deoptigate/)
      const headerLogo = fs.readFileSync(require.resolve('@clinic/deoptigate/visualizer/logo-alt.svg'), 'utf8').trim()
      t.ok(html.includes(headerLogo), 'embeds the Deoptigate logo in the Clinic header')
      t.match(html, /deoptigate-workspace/)
      t.match(html, /aria-label="Filter by severity"/)
      t.match(html, /data-severity="1"[^>]*>Low<\/button>/)
      t.match(html, /data-severity="2"[^>]*>Medium<\/button>/)
      t.match(html, /data-severity="3"[^>]*>High<\/button>/)
      t.end()
    })
  })
})

test('clinic deoptigate runs autocannon against the profiled application', function (t) {
  cli({ relayStderr: false }, [
    'clinic', 'deoptigate', '--no-open',
    '--autocannon', '[', 'localhost:$PORT', '-d', '1', ']',
    '--', 'node', '-e', `
      const http = require('http')

      http.createServer((req, res) => res.end('ok')).listen(0)
    `
  ], function (err, stdout, stderr, tempdir) {
    t.error(err, stderr)
    if (err) return t.end()
    t.match(stderr, /Running 1s test @ http:\/\/localhost:/)

    const report = stdout.match(/Generated HTML file is (.+\.html)/)
    t.ok(report, 'reports the generated HTML file')
    if (report) {
      const reportPath = new URL(report[1])
      t.ok(fs.statSync(reportPath).isFile(), 'writes the Clinic report')
    }

    const dataPath = path.resolve(tempdir, '.clinic')
    t.ok(fs.readdirSync(dataPath).some(name => name.endsWith('.clinic-deoptigate')),
      'stores the deoptigate profile')
    t.end()
  })
})

test('clinic deoptigate runs a custom on-port workload', function (t) {
  cli({ relayStderr: false, timeoutMs: 10000 }, [
    'clinic', 'deoptigate', '--no-open',
    '--on-port', 'node -e "require(\'http\').get(\'http://localhost:$PORT\', res => { console.log(\'ON_PORT_WORKLOAD_COMPLETED\'); res.resume() })"',
    '--', 'node', '-e', `
      const http = require('http')

      http.createServer((req, res) => res.end('ok')).listen(0)
    `
  ], function (err, stdout, stderr, tempdir) {
    t.error(err, stderr)
    if (err) return t.end()
    t.match(stdout, /ON_PORT_WORKLOAD_COMPLETED/)
    t.match(stdout, /Generated HTML file is/)

    const dataPath = path.resolve(tempdir, '.clinic')
    t.ok(fs.readdirSync(dataPath).some(name => name.endsWith('.clinic-deoptigate')),
      'stores the deoptigate profile')
    t.end()
  })
})
