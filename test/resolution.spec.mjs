/**
 * The repair's own arms: the shipped build carries no module-scope harness import,
 * and the borrowed values come from the process that is already running.
 *
 * The defect these arms exist for is not a behaviour bug that a residency arm would
 * catch — the package simply never evaluates in a profile, so no arm runs at all.
 * It is therefore asserted on the artifact (`lib/*.js`, what actually ships) and on
 * the resolver's own disclosures, including the two readings a working checkout
 * cannot produce by itself: an anchor set that resolves nothing, and a namespace
 * that resolves but is missing one of the five values.
 *
 * A note on `kind`: in this process the anchors are the test runner's, so a healthy
 * machine answers through a `fallback` anchor and the arm accepts any of the three
 * grades. What the grade *is* on a real host is a reading the profile takes, not
 * this suite — the claim made here is the one this suite can hold: the answered
 * instances are identical to the modules the process already loaded, so no second
 * copy answered.
 *
 * @module test/resolution.spec
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  anchorCandidates,
  HOST_PACKAGES,
  resolutionCounts,
  resolutionReport,
  resolveFrom,
} from '../lib/host.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The five values the plugin borrows, each with the package it comes from. */
const BORROWED = [
  ['@deepseek-ai/dsh-llm', 'createUserMessage'],
  ['@deepseek-ai/dsh-session', 'SessionSeq'],
  ['@deepseek-ai/dsh-skill', 'isModelInvocable'],
  ['@deepseek-ai/dsh-skill', 'escapeText'],
  ['@deepseek-ai/dsh-skill', 'renderSkillContent'],
]

test('the shipped build imports no harness package at module scope', () => {
  // The decisive property, asserted where the defect was: `lib/` is what npm ships
  // and what the loader evaluates. A static `from '@deepseek-ai/...'` here is the
  // module that never loads in a profile, whatever the source looked like.
  const files = readdirSync(join(ROOT, 'lib')).filter(file => file.endsWith('.js'))
  assert.ok(files.length > 0, 'expected the build to emit modules')
  for (const file of files) {
    const text = readFileSync(join(ROOT, 'lib', file), 'utf8')
    for (const pattern of [/from\s*['"]@deepseek-ai\//, /import\s*['"]@deepseek-ai\//]) {
      assert.ok(!pattern.test(text), `lib/${file} imports a harness package at module scope`)
    }
  }
})

test('the resolver reports what it reached, and what that is evidence of', () => {
  const report = resolutionReport()
  assert.equal(report.reached, true, `no anchor reached the host on a machine that has it: ${report.reason}`)
  assert.ok(report.anchor.length > 0, 'a reached report must name the anchor that answered')
  assert.ok(
    ['host-frame', 'host-tree', 'fallback'].includes(report.kind),
    `unexpected evidence grade ${String(report.kind)}`,
  )
  for (const name of HOST_PACKAGES) {
    // A version is the one thing that separates "some copy" from "the copy the
    // session is running", so an undisclosed version is a defect of the report.
    assert.match(
      report.packages[name] ?? '',
      /^\d+\.\d+\.\d+/,
      `${name}'s version was not disclosed (got ${String(report.packages[name])})`,
    )
  }
})

test('the borrowed values are the modules this process already loaded', async () => {
  const modules = resolveFrom(anchorCandidates())
  const loaded = {
    '@deepseek-ai/dsh-llm': await import('@deepseek-ai/dsh-llm'),
    '@deepseek-ai/dsh-session': await import('@deepseek-ai/dsh-session'),
    '@deepseek-ai/dsh-skill': await import('@deepseek-ai/dsh-skill'),
  }
  for (const [packageName, value] of BORROWED) {
    const answered = packageName === '@deepseek-ai/dsh-llm'
      ? modules.llm[value]
      : packageName === '@deepseek-ai/dsh-session' ? modules.session[value] : modules.skill[value]
    assert.equal(
      answered,
      loaded[packageName][value],
      `${packageName}'s ${value} came from a second copy of the module`,
    )
  }
})

test('an unreachable host throws a report that names every anchor it tried', () => {
  const tried = [
    join(tmpdir(), 'dsh-skill-residency-no-such-tree', 'a.js'),
    join(tmpdir(), 'dsh-skill-residency-no-such-tree', 'b.js'),
  ]
  assert.throws(
    () => resolveFrom(tried.map(path => ({ path, kind: 'fallback' }))),
    error => {
      // An operator has to be able to see the outage without a debugger, so the
      // anchors are carried on the error rather than only interpolated in prose.
      assert.deepEqual(error.anchors, tried)
      for (const name of HOST_PACKAGES) {
        assert.ok(error.message.includes(name), `the failure does not name ${name}`)
      }
      return true
    },
  )
})

test('a namespace that resolves without the values is not counted as reached', async () => {
  // Resolution and usability are two different facts. A package that answers but is
  // missing one of the five values would make the plugin report itself healthy and
  // then fail inside a step, which is the failure this guard exists to move forward.
  const home = await mkdtemp(join(tmpdir(), 'dsh-skill-residency-'))
  try {
    const scope = join(home, 'node_modules', '@deepseek-ai')
    for (const name of ['dsh-llm', 'dsh-session', 'dsh-skill']) {
      const directory = join(scope, name)
      await mkdir(directory, { recursive: true })
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ name: `@deepseek-ai/${name}`, version: '9.9.9', type: 'module', main: 'index.js' }),
      )
      const body = name === '@deepseek-ai/dsh-skill' || name === 'dsh-skill'
        ? 'export const isModelInvocable = () => true\nexport const renderSkillContent = () => ""\n'
        : name === 'dsh-llm'
          ? 'export const createUserMessage = () => ({})\n'
          : 'export const SessionSeq = value => value\n'
      await writeFile(join(directory, 'index.js'), body)
    }
    const anchor = join(home, 'anchor.js')
    await writeFile(anchor, '')
    assert.throws(
      () => resolveFrom([{ path: anchor, kind: 'fallback' }]),
      /escapeText/,
      'a namespace missing escapeText must not count as a usable resolution',
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a healthy process counts its attempts and records no failure', () => {
  const before = resolutionCounts()
  assert.equal(resolutionReport().reached, true)
  const after = resolutionCounts()
  assert.equal(after.attempts, before.attempts + 1, 'an attempt must be counted')
  assert.equal(after.failures, 0, 'a reachable host must record no failure')
})
