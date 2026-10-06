import * as core from '@actions/core'
import * as githubSdk from '@actions/github'
import { run } from './runner.cjs'

await run({ core, githubSdk })
