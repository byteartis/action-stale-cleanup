const { readInputs } = require('./config.cjs')
const closeStalePullRequests = require('./close-stale-prs.cjs')
const cleanupOrphanBranches = require('./cleanup-orphan-branches.cjs')

async function run({
  core,
  githubSdk,
  closePulls = closeStalePullRequests,
  cleanupBranches = cleanupOrphanBranches,
} = {}) {
  try {
    // Validate the entire configuration before constructing a client or writing.
    const { options, dryRun } = readInputs(core)
    const token = core.getInput('github-token', { required: true })
    const context = githubSdk.context
    const github = githubSdk.getOctokit(token)
    const args = { github, context, core, options, dryRun }
    core.info(
      `Repository cleanup for ${context.repo.owner}/${context.repo.repo} (dry-run: ${dryRun})`,
    )
    try {
      await closePulls(args)
    } catch (error) {
      core.setFailed(`PR cleanup: ${error.message}`)
    }
    // A PR failure must not prevent independently guarded branch cleanup.
    try {
      await cleanupBranches(args)
    } catch (error) {
      core.setFailed(`Branch cleanup: ${error.message}`)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

module.exports = { run }
