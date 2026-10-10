/**
 * The integration harness: a REAL cordis context, the REAL skill registry from
 * `@deepseek-ai/dsh-skill`, the REAL filesystem provider, and REAL skill files on
 * disk — driven through the REAL `agent/pre-step` waterfall via
 * `agentEvents(ctx, agent)`, which is the dispatcher the agent loop itself uses.
 *
 * Nothing about the seam is simulated. The plugin's listener is invoked the way
 * the loop invokes it, its decision is the decision the loop would commit, and
 * the session the plugin reads (`agent.session.surface`, `eventAt`) is a real
 * `Session` the harness appends to with the same `surfaceOp` the loop uses. The
 * only fabricated articles are the `Agent` shell (the loop's driver is not under
 * test) and the `workingDirectory` service, which the harness provides as a
 * one-line stub of the shipped shape.
 *
 * Two entry points matter for the arms that follow: {@link world} mounts the
 * plugin, and `world({mounted: false})` does not — so every "the plugin injected
 * this" claim is measured against the same step with nothing mounted.
 *
 * @module test/harness
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import plugin, * as namespace from '../lib/index.js'

/** Every temp home this harness created, to be removed by the caller's afterEach. */
const homes = []

/** The module namespace, for the arm that compares it with the default export. */
export { namespace }

/** Remove every temp home this harness made. */
export async function cleanup() {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
}

/** One skill file as the operator would write it. */
export async function writeSkillFile(root, { name, description, body = 'Body.', whenToUse, metadata }) {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  const lines = ['---', `name: ${name}`, `description: ${description}`]
  if (whenToUse !== undefined) lines.push(`whenToUse: ${JSON.stringify(whenToUse)}`)
  if (metadata !== undefined) {
    lines.push('metadata:')
    for (const [key, value] of Object.entries(metadata)) lines.push(`  ${key}: ${JSON.stringify(value)}`)
  }
  lines.push('---', '', body)
  await writeFile(join(directory, 'SKILL.md'), `${lines.join('\n')}\n`)
}

/**
 * Build one world.
 * @param world.files - skill files to write under `<home>/.dsh/skills`.
 * @param world.register - skills to register through the runtime registry instead.
 * @param world.config - the plugin configuration to mount with.
 * @param world.mounted - `false` mounts every dependency but not the plugin, which
 *   is the control arm for "did the plugin cause this?".
 * @param world.form - which export to mount: the `default` (what a Loader entry
 *   resolves) or the module `namespace`.
 * @returns the context, the temp home, and the skills root.
 */
export async function world({ files = [], register = [], config = {}, mounted = true, provideWorkingDirectory = true, form = 'default' } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'skill-residency-'))
  homes.push(home)
  const root = join(home, '.dsh', 'skills')
  await mkdir(root, { recursive: true })
  for (const file of files) await writeSkillFile(root, file)
  const ctx = new Context()
  // The shipped shape: one method, resolving the agent's workspace. Provided by
  // the harness rather than mounted, because this plugin reads it structurally.
  if (provideWorkingDirectory) ctx.provide('workingDirectory', { ensure: async () => home })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, { dshHome: join(home, '.dsh'), agentsHome: join(home, '.agents'), watch: false })
  for (const skill of register) ctx.skills.register(skill)
  // The DEFAULT export, because that is what a Loader entry resolves: a plugin
  // whose default export is not itself mountable works in a suite that mounts the
  // namespace and fails the moment a profile names it. `namespace` is kept for the
  // arm that asserts both forms agree.
  if (mounted) await ctx.plugin(form === 'namespace' ? namespace : plugin, config)
  return { ctx, home, root }
}

/**
 * A real session, created the way the loop creates one.
 *
 * No header is passed: `Session.create` fills in the format version, the id and a
 * creation time itself, and a hand-written header whose `cwd` is `undefined` is
 * refused as not losslessly JSON-serializable — which is the session telling the
 * caller that an undefined field would not survive the log.
 */
export function newSession(name) {
  return Session.create(SessionId(name))
}

/**
 * The `Agent` shell a step is dispatched against.
 *
 * The loop's own driver is not what this plugin touches; what it reads is
 * `session` (its backlog and its surface) and, through the payload, the agent as
 * a scope key. Everything else is the inert shape the shipped `Agent` interface
 * declares, `inject` throwing because a pre-step listener that reached for it
 * would be a defect worth a loud failure.
 * @param session - the session the agent owns.
 * @param id - an identifier for diagnostics.
 * @returns the agent shell.
 */
export function agentFor(session, id = 'skill-residency-agent') {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('a step-boundary injection must not use agent.inject()') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** The user message that opens a turn, so the session has a turn to belong to. */
export function openTurn(session, turn = 1) {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `turn ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/**
 * Dispatch one `agent/pre-step`, exactly as the loop does.
 * @param ctx - the world's context.
 * @param agent - the agent whose step this is.
 * @param dispatch.turn - the turn number.
 * @param dispatch.step - the step number.
 * @param dispatch.messages - the batch the loop proposes.
 * @returns the decision the waterfall composed.
 */
export async function propose(ctx, agent, { turn = 1, step = 1, messages = [] } = {}) {
  const signal = new AbortController().signal
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn, step, signal },
    () => Promise.resolve({ kind: 'enter', messages }),
  )
}

/** Commit a decision the way the loop does: append every message to the surface. */
export function commit(agent, decision) {
  if (decision.kind !== 'enter') return
  for (const message of decision.messages) {
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  }
}

/** Dispatch and commit in one call, which is one step of the loop. */
export async function step(ctx, agent, options = {}) {
  const decision = await propose(ctx, agent, options)
  commit(agent, decision)
  return decision
}

/** This plugin's messages in a batch, in order. */
export function injected(decision) {
  if (decision.kind !== 'enter') return []
  return decision.messages.filter(message => message.source.kind === 'skill-residency')
}

/** The text of one message. */
export function textOf(message) {
  return message.content.map(block => block.text ?? '').join('')
}

/**
 * Every event this plugin published into a session, in order.
 *
 * The events themselves, not their messages: a caller that wants to compact one
 * away needs its `seq`, which lives on the event.
 */
export function published(session) {
  return session.snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'skill-residency')
}

/** Remove a message from the model-visible surface the way compaction does. */
export function compactAway(session, seq, compactionId = 'skill-residency-compaction') {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'compacted history' }],
    source: { kind: 'compact-checkpoint', compactionId },
  }), {
    surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
    sourceEventSeqs: [seq],
  })
}
