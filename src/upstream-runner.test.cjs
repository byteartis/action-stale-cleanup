const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

// Exercise the runner's subprocess boundary without downloading any code or
// touching a real checkout. Dirty source must fail before dependency install;
// a clean reused checkout must reinstall even when its compiler already exists.
for (const dirty of ['?? src/injected.ts', ' M tsconfig.app.json', '']) {
  test(`upstream reuse runner ${dirty || 'clean source with preexisting compiler'}`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-runner-test-'))
    try {
      const bin = path.join(temp, 'bin')
      const upstream = path.join(temp, 'upstream')
      const log = path.join(temp, 'calls.jsonl')
      fs.mkdirSync(bin)
      fs.mkdirSync(path.join(upstream, 'node_modules/typescript/bin'), {
        recursive: true,
      })
      fs.writeFileSync(
        path.join(upstream, 'node_modules/typescript/bin/tsc'),
        '',
      )
      for (const command of ['git', 'npm']) {
        fs.writeFileSync(
          path.join(bin, command),
          `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(process.env.PROBE_LOG, JSON.stringify({command: '${command}', args}) + '\\n');\nif ('${command}' === 'npm') process.exit(37);\nif (args[0] === 'rev-parse') console.log('4391f3da665fdf50b6810c1a66712fb9ba21aa93');\nelse if (args[0] === 'status') console.log(process.env.PROBE_DIRTY);\nelse process.exit(38);\n`,
          { mode: 0o755 },
        )
      }
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-upstream.cjs'), '--upstream', upstream],
        {
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            PROBE_LOG: log,
            PROBE_DIRTY: dirty,
          },
          encoding: 'utf8',
          timeout: 15_000,
        },
      )
      assert.equal(result.status, 1)
      const calls = fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const status = calls.find(
        (call) => call.command === 'git' && call.args[0] === 'status',
      )
      assert.ok(status.args.includes('--untracked-files=all'))
      assert.ok(
        status.args.includes('tsconfig*.json') && status.args.includes('src'),
      )
      const install = calls.find((call) => call.command === 'npm')
      if (dirty) {
        assert.match(
          result.stderr,
          /must be pristine, including untracked files/,
        )
        assert.equal(install, undefined)
      } else {
        assert.deepEqual(install.args, [
          'ci',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ])
        assert.match(result.stderr, /npm exited 37/)
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
  })
}
