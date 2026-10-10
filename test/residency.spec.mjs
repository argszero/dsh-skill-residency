/**
 * Behaviour arms: each one names a claim the README makes and drives the real
 * waterfall to see whether the claim holds.
 *
 * Every arm that says "the plugin injected X" is paired with a control — the same
 * world with the plugin unmounted — because "a message appeared" is only evidence
 * of the plugin when the message is absent without it. The control is spelled
 * inline where it measures something (the neutrality arm) and omitted where the
 * message carries this plugin's own source kind, which nothing else can produce.
 *
 * @module test/residency.spec
 */

import assert from 'node:assert/strict'
import { after, afterEach, describe, it } from 'node:test'
import { writeSkillFile } from './harness.mjs'
import {
  agentFor, cleanup, commit, compactAway, injected, namespace, newSession, openTurn,
  propose, published, step, textOf, world,
} from './harness.mjs'

after(cleanup)
afterEach(cleanup)

/** The plan message in a batch, or undefined. */
function planMessage(decision) {
  return injected(decision).find(message => Array.isArray(message.source.hints))
}

/** The resident bodies in a batch, as `{name, text}`. */
function bodies(decision) {
  return injected(decision)
    .filter(message => typeof message.source.skill === 'string')
    .map(message => ({ name: message.source.skill, text: textOf(message) }))
}

describe('skill residency', () => {
  it('injects nothing when no skill declares whenToUse and none is resident', async () => {
    const files = [{ name: 'plain', description: 'A skill with no routing hint' }]
    const control = await world({ files, mounted: false })
    const controlSession = newSession('neutrality-control')
    openTurn(controlSession)
    const controlAgent = agentFor(controlSession)
    const before = (await propose(control.ctx, controlAgent)).messages.length

    const { ctx } = await world({ files })
    const session = newSession('neutrality')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)

    assert.deepEqual(injected(decision), [])
    assert.equal(decision.messages.length, before)
  })

  it('publishes the author\'s whenToUse to the model', async () => {
    const { ctx } = await world({
      files: [{
        name: 'style',
        description: 'A house style',
        whenToUse: 'Whenever the user asks for prose, not code.',
      }],
    })
    const session = newSession('hint')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)

    const plan = planMessage(decision)
    assert.ok(plan !== undefined, 'expected a plan message')
    const text = textOf(plan)
    assert.match(text, /Whenever the user asks for prose, not code\./)
    assert.match(text, /- `style`: /)
    assert.deepEqual(plan.source.hints, [{
      name: 'style',
      whenToUse: 'Whenever the user asks for prose, not code.',
    }])
    assert.deepEqual(plan.source.resident, [])
  })

  it('publishes no hint for a skill that declares none, and no empty message at all', async () => {
    const { ctx } = await world({
      files: [
        { name: 'hinted', description: 'Has a hint', whenToUse: 'Use it for X.' },
        { name: 'silent', description: 'Has no hint' },
      ],
    })
    const session = newSession('partial-hints')
    openTurn(session)
    const agent = agentFor(session)
    const plan = planMessage(await propose(ctx, agent))

    assert.deepEqual(plan.source.hints, [{ name: 'hinted', whenToUse: 'Use it for X.' }])
    assert.doesNotMatch(textOf(plan), /silent/)
  })

  it('treats a blank whenToUse as absent', async () => {
    const { ctx } = await world({
      files: [{ name: 'blank', description: 'Blank hint', whenToUse: '   ' }],
    })
    const session = newSession('blank-hint')
    openTurn(session)
    const agent = agentFor(session)
    assert.deepEqual(injected(await propose(ctx, agent)), [])
  })

  it('injects a resident body declared by frontmatter metadata', async () => {
    const { ctx } = await world({
      files: [{
        name: 'house-style',
        description: 'Always-on output style',
        body: 'Never open with a summary sentence.',
        metadata: { resident: true },
      }],
    })
    const session = newSession('resident-marker')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)

    // The rendering is `renderSkillContent` unchanged, so the assertion is on the
    // envelope it defines rather than on the provider's resource hint, which is
    // the provider's business (a filesystem skill names its own directory).
    assert.deepEqual(bodies(decision).map(body => body.name), ['house-style'])
    const body = bodies(decision)[0].text
    assert.match(body, /^<skill_content name="house-style">\n/)
    assert.match(body, /<skill_instructions>\nNever open with a summary sentence\.\n<\/skill_instructions>/)
    assert.match(body, /<\/skill_content>$/)
    const plan = planMessage(decision)
    assert.deepEqual(plan.source.resident.map(record => record.name), ['house-style'])
    assert.match(textOf(plan), /Resident skills\./)
    assert.match(textOf(plan), /do not call the `skill` tool for them/)
  })

  it('injects a resident body named in config, with no marker in the skill', async () => {
    const files = [{ name: 'config-resident', description: 'Ordinary skill', body: 'Follow me always.' }]
    const { ctx } = await world({ files, config: { resident: ['config-resident'] } })
    const session = newSession('resident-config')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)
    assert.deepEqual(bodies(decision).map(body => body.name), ['config-resident'])
    assert.match(bodies(decision)[0].text, /Follow me always\./)
  })

  it('does not re-publish when the plan has not changed', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('dedup')
    openTurn(session)
    const agent = agentFor(session)

    const first = await step(ctx, agent)
    assert.equal(injected(first).length, 1)
    const second = await propose(ctx, agent, { turn: 1, step: 2 })
    assert.deepEqual(injected(second), [])
    assert.equal(published(session).length, 1)
  })

  it('re-publishes after compaction hides its durable message', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('republish-after-compaction')
    openTurn(session)
    const agent = agentFor(session)

    await step(ctx, agent)
    const first = published(session)[0]
    if (first === undefined) throw new Error('expected an initial plan')
    compactAway(session, first.seq)

    const decision = await propose(ctx, agent, { turn: 1, step: 2 })
    assert.equal(injected(decision).length, 1)
    assert.equal(published(session).length, 1, 'the republish is committed by the caller, not the listener')
  })

  it('re-publishes when a skill starts declaring a hint', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('republish-on-change')
    openTurn(session)
    const agent = agentFor(session)
    await step(ctx, agent)

    // A runtime registration is a real catalog revision, and the one a second
    // plugin produces: the discovery cache is invalidated by it, which a file
    // written behind a `watch: false` provider is not.
    ctx.skills.register({ name: 'second', description: 'Second skill', whenToUse: 'For tests.', source: 'runtime', content: 'body' })
    const plan = planMessage(await propose(ctx, agent, { turn: 1, step: 2 }))
    assert.deepEqual(plan.source.hints.map(hint => hint.name), ['second', 'style'])
  })

  it('recognises a plan the loop is re-proposing with the same batch', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('reproposed-batch')
    openTurn(session)
    const agent = agentFor(session)

    const first = await propose(ctx, agent)
    assert.equal(injected(first).length, 1)
    // The batch comes back carrying the plan it was given; what must not happen is
    // a second copy of it.
    const second = await propose(ctx, agent, { messages: first.messages })
    assert.equal(injected(second).length, 1)
  })

  it('bounds a long whenToUse', async () => {
    const long = `${'routing guidance '.repeat(40)}end`
    const { ctx } = await world({
      files: [{ name: 'long', description: 'Long hint', whenToUse: long }],
      config: { whenToUseMaxLength: 40 },
    })
    const session = newSession('bounded')
    openTurn(session)
    const agent = agentFor(session)
    const plan = planMessage(await propose(ctx, agent))
    assert.equal(plan.source.hints[0].whenToUse.length, 40)
    assert.match(plan.source.hints[0].whenToUse, /\.\.\.$/)
  })

  it('collapses whitespace in a whenToUse before bounding it', async () => {
    const { ctx } = await world({
      files: [{
        name: 'wrapped',
        description: 'Wrapped hint',
        whenToUse: 'First line\n  and a second line',
      }],
    })
    const session = newSession('normalized')
    openTurn(session)
    const agent = agentFor(session)
    const plan = planMessage(await propose(ctx, agent))
    assert.equal(plan.source.hints[0].whenToUse, 'First line and a second line')
  })

  it('leaves the model-invocable filter in place', async () => {
    const { ctx } = await world({
      register: [
        { name: 'user-only', description: 'User only', whenToUse: 'Never for the model.', source: 'runtime', content: 'body', invocation: { modelInvocable: false, userInvocable: true } },
        { name: 'model-ok', description: 'Model ok', whenToUse: 'For the model.', source: 'runtime', content: 'body' },
      ],
    })
    const session = newSession('invocation-filter')
    openTurn(session)
    const agent = agentFor(session)
    const plan = planMessage(await propose(ctx, agent))
    assert.deepEqual(plan.source.hints.map(hint => hint.name), ['model-ok'])
  })

  it('honours whenToUse: false without disabling residency', async () => {
    const { ctx } = await world({
      files: [{
        name: 'style',
        description: 'House style',
        whenToUse: 'For prose.',
        metadata: { resident: true },
      }],
      config: { whenToUse: false },
    })
    const session = newSession('hints-off')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)
    const plan = planMessage(decision)
    assert.deepEqual(plan.source.hints, [])
    assert.deepEqual(bodies(decision).map(body => body.name), ['style'])
  })

  it('honours honorMetadata: false without disabling the config list', async () => {
    const files = [
      { name: 'marked', description: 'Marked', metadata: { resident: true } },
      { name: 'listed', description: 'Listed' },
    ]
    const { ctx } = await world({ files, config: { honorMetadata: false, resident: ['listed'] } })
    const session = newSession('marker-off')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)
    assert.deepEqual(bodies(decision).map(body => body.name), ['listed'])
  })

  it('requires a strict boolean for the marker', async () => {
    const { ctx } = await world({
      files: [{ name: 'stringy', description: 'Stringy', metadata: { resident: 'true' } }],
    })
    const session = newSession('stringy-marker')
    openTurn(session)
    const agent = agentFor(session)
    assert.deepEqual(injected(await propose(ctx, agent)), [])
  })

  it('injects nothing under mode: report and logs the plan instead', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
      config: { mode: 'report' },
    })
    const session = newSession('report-mode')
    openTurn(session)
    const agent = agentFor(session)
    assert.deepEqual(injected(await propose(ctx, agent)), [])
  })

  it('installs nothing at all under mode: off', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
      config: { mode: 'off' },
    })
    const session = newSession('off-mode')
    openTurn(session)
    const agent = agentFor(session)
    assert.deepEqual(injected(await propose(ctx, agent)), [])
  })

  it('fails open when the skills service throws', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('fail-open')
    openTurn(session)
    const agent = agentFor(session)
    const original = ctx.skills.snapshot.bind(ctx.skills)
    ctx.skills.snapshot = () => { throw new Error('registry exploded') }
    try {
      const decision = await propose(ctx, agent, { messages: [] })
      assert.deepEqual(injected(decision), [])
      assert.equal(decision.kind, 'enter')
    } finally {
      ctx.skills.snapshot = original
    }
  })

  it('works without a working directory service', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
      provideWorkingDirectory: false,
    })
    const session = newSession('no-working-directory')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)
    assert.deepEqual(injected(decision).map(message => message.source.hints?.length ?? 0), [1])
  })

  it('refuses a whenToUseMaxLength that cannot hold a word', async () => {
    await assert.rejects(
      async () => await world({ config: { whenToUseMaxLength: 4 } }),
      /whenToUseMaxLength must be an integer greater than or equal to 8/,
    )
  })

  it('does not let a foreign seed record crash the step', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('foreign-record')
    openTurn(session)
    const agent = agentFor(session)
    // A resumed or externally written session may hold a `skill-residency` source
    // that is not a plan this plugin can read — a non-object, or a record whose
    // arrays are the wrong shape. It must read as "not mine", never as a throw.
    session.append('user/message', {
      id: 'foreign-1', time: 0, role: 'user',
      content: [{ type: 'text', text: 'unreadable seed' }],
      source: { kind: 'skill-residency', form: 'instructions', hints: 'not-an-array' },
    }, { surfaceOp: 'append' })
    const decision = await propose(ctx, agent)
    assert.deepEqual(injected(decision).map(message => message.source.hints), [[{
      name: 'style', whenToUse: 'For prose.',
    }]])
  })

  it('re-publishes a resident body when its content changes for a new agent', async () => {
    const { ctx, root } = await world({
      files: [{ name: 'style', description: 'House style', body: 'First body.', metadata: { resident: true } }],
    })
    const session = newSession('resident-body-change')
    openTurn(session)
    const first = agentFor(session, 'agent-one')
    const initial = planMessage(await propose(ctx, first))
    const initialDigest = initial.source.resident[0].bodyDigest

    await writeSkillFile(root, { name: 'style', description: 'House style', body: 'Second body.', metadata: { resident: true } })
    // A fresh agent re-classifies, which is the documented refresh point for a
    // cached body: the cache lives for one agent's lifetime.
    const second = agentFor(session, 'agent-two')
    const updated = planMessage(await propose(ctx, second, { turn: 1, step: 2 }))
    assert.notEqual(updated.source.resident[0].bodyDigest, initialDigest)
    assert.match(bodies(await propose(ctx, second, { turn: 1, step: 3 }))[0].text, /Second body\./)
  })

  it('behaves the same mounted through its namespace as through its default export', async () => {
    const files = [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }]
    const viaDefault = await world({ files })
    const viaNamespace = await world({ files, form: 'namespace' })
    const defaultSession = newSession('default-export')
    const namespaceSession = newSession('namespace-export')
    openTurn(defaultSession)
    openTurn(namespaceSession)
    const first = injected(await propose(viaDefault.ctx, agentFor(defaultSession)))
    const second = injected(await propose(viaNamespace.ctx, agentFor(namespaceSession)))
    assert.deepEqual(second.map(message => message.source), first.map(message => message.source))
    // Both forms carry the loader-facing identity, and they are the same object's.
    assert.equal(namespace.name, 'skill-residency')
    assert.equal(namespace.default.name, namespace.name)
    assert.equal(namespace.default.apply, namespace.apply)
    assert.deepEqual(namespace.inject, ['agents', 'skills'])
  })

  it('commits its messages as durable user messages carrying this plugin\'s kind', async () => {
    const { ctx } = await world({
      files: [{ name: 'style', description: 'House style', whenToUse: 'For prose.' }],
    })
    const session = newSession('durable-shape')
    openTurn(session)
    const agent = agentFor(session)
    const decision = await propose(ctx, agent)
    commit(agent, decision)
    const events = published(session)
    assert.equal(events.length, 1)
    assert.equal(events[0].data.role, 'user')
    assert.equal(events[0].data.source.form, 'instructions')
    assert.equal(events[0].data.source.kind, 'skill-residency')
  })
})
