const assert = require('node:assert/strict')
const { test } = require('node:test')
const { cases } = require('./fixtures.cjs')
const { runLocal, runUpstream, mutations, action } = require('./harness.cjs')

for (const scenario of cases) {
  test(scenario.name, async () => {
    const local = await runLocal(scenario)
    const upstream = await runUpstream(scenario)
    assert.deepEqual(
      [action(local), action(upstream)],
      scenario.expected,
      'local/upstream action pair',
    )
    assert.ok(
      !mutations(local).some(({ name }) => name === 'delete'),
      'PR comparison fixtures must not delete branches',
    )
    assert.ok(
      !mutations(upstream).some(({ name }) => name === 'delete'),
      'upstream deleteBranch must stay disabled',
    )
    if (!scenario.fail) {
      assert.deepEqual(
        local.logs.filter(({ level }) => level === 'setFailed'),
        [],
        'No unexpected local errors',
      )
      assert.deepEqual(
        upstream.logs.filter(
          ({ level }) => level === 'error' || level === 'setFailed',
        ),
        [],
        'No unexpected upstream errors',
      )
    }
    if (scenario.preview) {
      assert.deepEqual(
        mutations(local),
        [],
        'Local preview must not attempt any mutation',
      )
      assert.deepEqual(
        mutations(upstream),
        [],
        'Upstream preview must not attempt any mutation',
      )
      if (scenario.intent) {
        assert.ok(
          local.logs.some(({ level }) => level === 'info'),
          'Local preview logs its intent',
        )
        assert.equal(
          scenario.intent === 'warn'
            ? upstream.processor.staleIssues.length
            : upstream.processor.closedIssues.length,
          1,
        )
      }
    }
    if (scenario.fail === 'comment') {
      assert.ok(local.logs.some(({ level }) => level === 'setFailed'))
      assert.ok(
        !local.calls.some(({ name }) => name === 'flag'),
        'Failed local warning must prevent even a label attempt',
      )
      assert.ok(
        upstream.calls.some(({ name }) => name === 'flag'),
        'Real upstream continues to the label after comment failure',
      )
    }
    if (scenario.evidencePage === 2) {
      for (const name of ['comments', 'events'])
        assert.ok(
          local.calls.some(
            (call) => call.name === name && call.args.page === 2,
          ),
        )
      assert.ok(
        upstream.calls.some(
          (call) => call.name === 'events' && call.args.page === 2,
        ),
      )
    }
    if (scenario.humanSecondPage) {
      assert.ok(
        local.calls.some(
          (call) =>
            call.name === 'comments' &&
            call.args.page === 1 &&
            call.args.per_page === 100,
        ),
      )
      assert.equal(
        upstream.calls.filter(({ name }) => name === 'comments').length,
        1,
      )
      assert.equal(
        upstream.calls.find(({ name }) => name === 'comments').args.per_page,
        undefined,
      )
    }
    if (!scenario.preview && scenario.expected[0] === 'warn') {
      const comment = local.calls.findIndex(({ name }) => name === 'comment')
      const label = local.calls.findIndex(({ name }) => name === 'flag')
      assert.ok(
        comment >= 0 && label > comment,
        'Delivered warning must precede labeling',
      )
    }
  })
}

test('real upstream budget can overshoot within an item and resumes by processed ID', async () => {
  let saved = ''
  const storage = {
    restore: async () => saved,
    save: async (value) => {
      saved = value
    },
  }
  const first = await runUpstream(
    { stale: false },
    { options: { operationsPerRun: 2 }, storage },
  )
  assert.equal(action(first), 'warn')
  assert.ok(
    first.processor.operations.getConsumedOperationsCount() > 2,
    'The budget is checked between items, not every API call',
  )
  assert.equal(first.processor.operations.getConsumedOperationsCount(), 5)
  await first.state.persist()
  assert.equal(saved, '1')
  const resumed = await runUpstream({}, { storage })
  assert.deepEqual(
    mutations(resumed),
    [],
    'A processed ID is skipped even when the mocked PR is now due',
  )
  await resumed.state.persist()
  assert.equal(saved, '', 'State resets only after the complete scan finishes')
})

test('real upstream preview state does not persist', async () => {
  let saves = 0
  const result = await runUpstream(
    { stale: false, preview: true },
    {
      options: { operationsPerRun: 2 },
      storage: {
        restore: async () => '',
        save: async () => {
          saves++
        },
      },
    },
  )
  await result.state.persist()
  assert.equal(saves, 0)
  assert.deepEqual(mutations(result), [])
})
