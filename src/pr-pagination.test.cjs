const assert = require('node:assert/strict')
const { test } = require('node:test')
const closeStalePullRequests = require('./close-stale-prs.cjs')
const { WARNING_MARKER } = require('./pr-policy.cjs')

test('real Octokit pagination reads warnings and label evidence beyond page one in preview', async () => {
  const { getOctokit } = await import('@actions/github')
  const requests = []
  const logs = []
  const old = '2026-06-01T00:00:00Z'
  const pr = {
    number: 1,
    state: 'open',
    merged: false,
    draft: false,
    created_at: old,
    labels: [{ name: 'stale' }],
    head: { ref: 'feature', sha: 'sha', repo: { full_name: 'owner/repo' } },
  }
  const github = getOctokit('test-token', {
    request: {
      fetch: async (url, init) => {
        assert.equal(
          init.method,
          'GET',
          'preview must not issue any mutation request',
        )
        const parsed = new URL(url)
        requests.push(parsed.pathname + parsed.search)
        const headers = { 'content-type': 'application/json' }
        let data
        if (parsed.pathname === '/repos/owner/repo')
          data = { full_name: 'owner/repo', default_branch: 'main' }
        else if (parsed.pathname === '/repos/owner/repo/pulls/1') data = pr
        else if (parsed.pathname === '/repos/owner/repo/pulls') data = [pr]
        else if (
          parsed.pathname.endsWith('/events') ||
          parsed.pathname.endsWith('/comments')
        ) {
          if (parsed.searchParams.get('page') === '2') {
            data = parsed.pathname.endsWith('/events')
              ? [
                  {
                    event: 'labeled',
                    label: { name: 'stale' },
                    created_at: old,
                  },
                ]
              : [
                  {
                    body: WARNING_MARKER,
                    user: { login: 'github-actions[bot]' },
                    created_at: old,
                  },
                ]
          } else {
            data = Array.from({ length: 100 }, (_, id) =>
              parsed.pathname.endsWith('/events')
                ? { id, event: 'mentioned', created_at: old }
                : {
                    id,
                    body: 'Ordinary comment',
                    user: { login: 'human', type: 'User' },
                    created_at: old,
                  },
            )
            parsed.searchParams.set('page', '2')
            headers.link = `<${parsed.href}>; rel="next"`
          }
        } else assert.fail(`Unexpected request: ${url}`)
        return new Response(JSON.stringify(data), { status: 200, headers })
      },
    },
  })
  await closeStalePullRequests({
    github,
    context: { repo: { owner: 'owner', repo: 'repo' } },
    core: {
      info: (message) => logs.push(message),
      warning: assert.fail,
      setFailed: assert.fail,
    },
    now: Date.parse('2026-06-20T00:00:00Z'),
    dryRun: true,
  })
  assert.ok(logs.some((message) => message.includes('Would close PR #1')))
  for (const endpoint of ['events', 'comments']) {
    assert.ok(
      requests.filter(
        (url) => url.includes(`/${endpoint}?`) && url.includes('page=2'),
      ).length >= 2,
      `${endpoint} pages must also be refreshed before closure`,
    )
  }
})
