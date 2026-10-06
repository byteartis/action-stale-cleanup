#!/usr/bin/env node
// Research only: pinned source and its build dependencies stay outside this repo.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const UPSTREAM_COMMIT = '4391f3da665fdf50b6810c1a66712fb9ba21aa93'
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--upstream')) {
  console.error(
    'Usage: node scripts/check-upstream.cjs [--upstream /tmp/stale-source]',
  )
  process.exit(1)
}
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error(
    'Use Node.js 24 or newer, matching the pinned upstream runtime.',
  )
  process.exit(1)
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, {
    cwd: root,
    stdio: 'inherit',
    timeout: 240_000,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`)
  return result.stdout?.trim()
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-differential-'))
try {
  const upstream = args.length
    ? path.resolve(args[1])
    : path.join(temp, 'source')
  if (!args.length) {
    run('git', [
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--branch',
      'v11.0.0',
      'https://github.com/actions/stale.git',
      upstream,
    ])
  }
  const commit = run('git', ['rev-parse', 'HEAD'], {
    cwd: upstream,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
  assert.equal(commit, UPSTREAM_COMMIT, 'The v11.0.0 commit must match the pin')
  const dirty = run(
    'git',
    [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--',
      'src',
      'package.json',
      'package-lock.json',
      'tsconfig*.json',
    ],
    { cwd: upstream, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  )
  assert.equal(
    dirty,
    '',
    'Upstream source/manifests/config must be pristine, including untracked files',
  )
  console.log(`Comparing real actions/stale v11.0.0 (${commit})`)
  // Even a reused checkout gets its dependencies replaced from the verified
  // lockfile. An existing compiler alone is not evidence of a locked install.
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: upstream,
  })
  const build = path.join(temp, 'lib')
  run(
    process.execPath,
    [
      path.join(upstream, 'node_modules/typescript/bin/tsc'),
      '--project',
      path.join(upstream, 'tsconfig.app.json'),
      '--outDir',
      build,
    ],
    { cwd: upstream },
  )
  run(
    process.execPath,
    [
      '--experimental-vm-modules',
      '--test',
      path.join(__dirname, 'upstream/comparison.test.cjs'),
    ],
    {
      env: {
        ...process.env,
        STALE_UPSTREAM_SOURCE: upstream,
        STALE_UPSTREAM_BUILD: build,
      },
    },
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
