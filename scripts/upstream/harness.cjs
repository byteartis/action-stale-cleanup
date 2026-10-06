const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { NOW, ago, materialize } = require('./fixtures.cjs')

const MUTATIONS = new Set([
  'comment',
  'flag',
  'unflag',
  'close',
  'create-label',
  'delete',
])

function fixture(input) {
  const data = materialize(input)
  const { scenario, pr, repository, events, comments } = data
  const calls = []
  const logs = []
  let prReads = 0
  const core = Object.fromEntries(
    ['info', 'warning', 'error', 'debug', 'setFailed'].map((level) => [
      level,
      (...message) => logs.push({ level, message: message.join(' ') }),
    ]),
  )
  core.group = async (_, fn) => fn()

  function endpoint(name, handler = () => ({})) {
    const fn = async (args) => {
      const call = { name, args: structuredClone(args), succeeded: false }
      calls.push(call)
      if (scenario.fail === name) throw new Error(`Mock ${name} failure`)
      const data = structuredClone(handler(args))
      call.succeeded = true
      return { data }
    }
    fn.endpoint = { merge: (args) => ({ ...args, fixtureEndpoint: name }) }
    return fn
  }
  const page = (items, args, defaultSize = 30) => {
    const size = args.per_page || defaultSize
    const start = ((args.page || 1) - 1) * size
    return items.slice(start, start + size)
  }
  const rest = {
    repos: { get: endpoint('repository', () => repository) },
    pulls: {
      list: endpoint('pulls', (args) =>
        args.head || args.base ? [] : page([pr], args),
      ),
      get: endpoint('pr', () => {
        prReads++
        return scenario.finalExempt && prReads >= 2
          ? { ...pr, labels: [...pr.labels, { name: 'keep-open' }] }
          : pr
      }),
      update: endpoint('close', () => {
        pr.state = 'closed'
        return pr
      }),
    },
    issues: {
      listForRepo: endpoint('issues', (args) => page([pr], args)),
      listEvents: endpoint('events', (args) => page(events, args)),
      listComments: endpoint('comments', (args) =>
        page(
          comments.filter(
            (comment) =>
              !args.since ||
              Date.parse(comment.created_at) >= Date.parse(args.since),
          ),
          args,
        ),
      ),
      getLabel: endpoint('label', () => ({ name: 'stale' })),
      createLabel: endpoint('create-label'),
      createComment: endpoint('comment', (args) => {
        const comment = {
          id: 999,
          body: args.body,
          created_at: ago(0),
          user: { type: 'Bot', login: 'github-actions[bot]' },
        }
        comments.push(comment)
        return comment
      }),
      addLabels: endpoint('flag', () => {
        events.push({
          event: 'labeled',
          label: { name: 'stale' },
          created_at: ago(0),
        })
        return [{ name: 'stale' }]
      }),
      removeLabel: endpoint('unflag'),
      update: endpoint('close', () => {
        pr.state = 'closed'
        return pr
      }),
    },
    git: { deleteRef: endpoint('delete') },
  }
  const github = {
    rest,
    paginate: async (method, args) => {
      if (typeof method !== 'function') {
        args = method
        method = Object.values(rest.issues).find(
          (fn) =>
            fn.endpoint.merge({}).fixtureEndpoint === args.fixtureEndpoint,
        )
      }
      assert.ok(method, 'Only known mocked pagination endpoints are allowed')
      const result = []
      for (let number = 1; ; number++) {
        const response = await method({ ...args, page: number })
        result.push(...response.data)
        if (response.data.length < (args.per_page || 30)) break
      }
      return result
    },
  }
  return { ...data, github, core, calls, logs }
}

function upstreamOptions(input) {
  const local = {
    prStaleDays: 7,
    prWarningDays: 7,
    exemptDrafts: true,
    ...input.options,
  }
  return {
    repoToken: 'mock-token-never-used',
    staleIssueMessage: '',
    stalePrMessage: 'This PR is stale',
    closeIssueMessage: '',
    closePrMessage: '',
    daysBeforeStale: local.prStaleDays,
    daysBeforeIssueStale: -1,
    daysBeforePrStale: local.prStaleDays,
    daysBeforeClose: local.prWarningDays,
    daysBeforeIssueClose: -1,
    daysBeforePrClose: local.prWarningDays,
    staleIssueLabel: 'stale',
    stalePrLabel: 'stale',
    closeIssueLabel: '',
    closePrLabel: '',
    exemptIssueLabels: '',
    exemptPrLabels: 'keep-open',
    onlyLabels: '',
    onlyIssueLabels: '',
    onlyPrLabels: '',
    anyOfLabels: '',
    anyOfIssueLabels: '',
    anyOfPrLabels: '',
    operationsPerRun: 1000,
    removeStaleWhenUpdated: false,
    removePrStaleWhenUpdated: false,
    removeIssueStaleWhenUpdated: undefined,
    debugOnly: Boolean(input.preview),
    ascending: true,
    sortBy: 'created',
    deleteBranch: false,
    startDate: undefined,
    exemptMilestones: '',
    exemptIssueMilestones: '',
    exemptPrMilestones: '',
    exemptAllMilestones: false,
    exemptAllIssueMilestones: undefined,
    exemptAllPrMilestones: undefined,
    exemptAssignees: '',
    exemptIssueAssignees: '',
    exemptPrAssignees: '',
    exemptAllAssignees: false,
    exemptAllIssueAssignees: undefined,
    exemptAllPrAssignees: undefined,
    enableStatistics: false,
    labelsToRemoveWhenStale: '',
    labelsToRemoveWhenUnstale: '',
    labelsToAddWhenUnstale: '',
    ignoreUpdates: true,
    ignoreIssueUpdates: undefined,
    ignorePrUpdates: true,
    exemptDraftPr: local.exemptDrafts,
    closeIssueReason: '',
    includeOnlyAssigned: false,
  }
}

// Load unmodified tsc output. Only external GitHub transport/core and the clock
// are mocked. No IssuesProcessor/Issue/State method is replaced or subclassed.
async function loadUpstream(f) {
  const source = process.env.STALE_UPSTREAM_SOURCE
  const build = process.env.STALE_UPSTREAM_BUILD
  assert.ok(source && build, 'Run through node scripts/check-upstream.cjs')
  assert.ok(
    vm.SourceTextModule,
    'The runner must enable --experimental-vm-modules',
  )
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [NOW]))
    }
    static now() {
      return NOW
    }
  }
  const context = vm.createContext({ Date: Clock })
  const resolveDependency = createRequire(path.join(source, 'package.json'))
  const modules = new Map()
  async function getModule(specifier, referencing) {
    const key = specifier.startsWith('.')
      ? path.resolve(path.dirname(referencing.identifier), specifier)
      : specifier
    if (modules.has(key)) return modules.get(key)
    const pending = (async () => {
      if (path.isAbsolute(key))
        return new vm.SourceTextModule(await fs.readFile(key, 'utf8'), {
          context,
          identifier: key,
        })
      const exports =
        key === '@actions/core'
          ? f.core
          : key === '@actions/github'
            ? {
                context: { repo: { owner: 'owner', repo: 'repo' } },
                getOctokit: () => f.github,
              }
            : await import(pathToFileURL(resolveDependency.resolve(key)).href)
      return new vm.SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [name, value] of Object.entries(exports))
            this.setExport(name, value)
        },
        { context, identifier: key },
      )
    })()
    modules.set(key, pending)
    return pending
  }
  async function entry(relative) {
    const module = await getModule(path.join(build, relative))
    if (module.status === 'unlinked') await module.link(getModule)
    if (module.status === 'linked') await module.evaluate()
    return module.namespace
  }
  return {
    ...(await entry('classes/issues-processor.js')),
    ...(await entry('classes/state/state.js')),
  }
}

async function runLocal(input) {
  const f = fixture(input)
  const closeStalePullRequests = require('../../src/close-stale-prs.cjs')
  await closeStalePullRequests({
    github: f.github,
    core: f.core,
    context: { repo: { owner: 'owner', repo: 'repo' } },
    now: NOW,
    dryRun: Boolean(input.preview),
    options: { excludedBranches: ['release/*'], ...input.options },
  })
  return f
}

async function runUpstream(input, { options: overrides = {}, storage } = {}) {
  const f = fixture(input)
  const { IssuesProcessor, State } = await loadUpstream(f)
  const options = { ...upstreamOptions(input), ...overrides }
  const state = new State(
    storage || { restore: async () => '', save: async () => {} },
    options,
  )
  await state.restore()
  const processor = new IssuesProcessor(options, state)
  await processor.processIssues()
  return { ...f, processor, state }
}

function mutations(f) {
  return f.calls.filter(({ name }) => MUTATIONS.has(name))
}
function action(f) {
  const writes = mutations(f).filter(({ succeeded }) => succeeded)
  if (writes.some(({ name }) => name === 'close')) return 'close'
  if (writes.some(({ name }) => name === 'flag')) {
    return writes.some(({ name }) => name === 'comment') ? 'warn' : 'label-only'
  }
  return 'none'
}

module.exports = { runLocal, runUpstream, mutations, action }
