/**
 * The two things the skill system cannot say, said at the step boundary.
 *
 * ## What is missing
 *
 * The catalog message every session receives ends with the trigger rule
 * (`@deepseek-ai/dsh-tool-skill`, `renderCatalogMessage`): *"If the user names a
 * skill, or the task clearly matches a skill's description, call the `skill`
 * tool…"*. Both conditions presume a skill **bound to a task**, so a skill whose
 * description says *"active by default: load this skill at the start of every
 * session … for all responses until the reader says stop"* can never trigger:
 * nothing about an ordinary request "clearly matches" it, and the only way to make
 * such instructions resident is to leave the skill system and write them into
 * `AGENTS.md`. No frontmatter field carries the intent either — the filesystem
 * provider parses `name`, `description`, `whenToUse`, `metadata`,
 * `disable-model-invocation` and `user-invocable`, and none of them means "always".
 *
 * The second gap is quieter. `whenToUse` **is** parsed, validated, carried to the
 * API layer, and documented — and it never reaches the model: it is absent from
 * the catalog entries (`catalogSourceEntries` emits name and description only),
 * absent from the `skill` tool's result, and absent from `renderSkillContent`. The
 * package that renders for the model, `@deepseek-ai/dsh-tool-skill`, contains zero
 * occurrences of the field. An author fills it in and gets nothing.
 *
 * ## What this plugin does
 *
 * At `agent/pre-step` — the waterfall through which every model request is
 * assembled — it appends at most two things, as durable source-attributed user
 * messages:
 *
 * 1. one **plan message** carrying each author's `whenToUse`, so the routing
 *    intent reaches the model;
 * 2. one message per **resident** skill carrying its full body, rendered through
 *    `renderSkillContent` — the same envelope the `skill` tool and the `/name`
 *    gesture already produce, which the catalog already teaches the model to
 *    follow.
 *
 * Residency comes from two places: the `resident` config list, and
 * `metadata: { resident: true }` in a skill's frontmatter (which needs no core
 * change — the filesystem provider preserves arbitrary metadata keys).
 *
 * ## Why it is a message and not a system prompt
 *
 * The injection is a logged, source-attributed message, so it is durable: the plan
 * is republished when it changes **and** when compaction drops it, detected by
 * asking the session which of its events the model can still see
 * (`agent.session.surface.nodes`). A resident skill therefore survives the context
 * window without the plugin keeping any state of its own. This is the mechanism
 * `@deepseek-ai/dsh-tool-skill` uses for its catalog, applied to the two facts core
 * does not render.
 *
 * ## What it is not
 *
 * It is not the fix, and it does not pretend to be one: an `always-load`
 * frontmatter field recognised by `tool-skill`, `whenToUse` rendered into the
 * catalog, and wording in the catalog instruction that admits resident skills are
 * all changes in core packages. This plugin exists so the capability is available
 * to a deployment that cannot patch them, and it changes nothing outside its own
 * two services.
 *
 * @module @argszero/dsh-skill-residency
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Config, Settings } from './config.ts'
import { normalizeConfig } from './config.ts'
import { digestPlan, isEmptyPlan, publishedPlan, readPlan, SOURCE_KIND } from './plan.ts'
import { describePlan, renderPlan, renderResident } from './render.ts'
import { computePlan } from './residency.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-residency'

/**
 * The services this plugin needs to be dispatched at all.
 *
 * `agents` is what delivers the `agent/pre-step` waterfall this plugin listens
 * on; `skills` is the catalog it plans from. The working directory is read
 * through {@link WorkingDirectoryLike} but deliberately **not** injected: a
 * composition without one still has global-layer skills to plan from, and a
 * missing project scope is a reason to publish fewer hints, not a reason for the
 * plugin to never mount.
 */
export const inject = ['agents', 'skills']

/**
 * The slice of the working-directory service this plugin reads.
 *
 * Declared structurally rather than imported, so the plugin depends on the shape
 * it uses and not on a package that a given composition may not have installed.
 */
interface WorkingDirectoryLike {
  ensure(agent: Agent, signal: AbortSignal): Promise<string>
}

/** The working-directory service, when this composition provides one. */
function workingDirectoryOf(ctx: Context): WorkingDirectoryLike | undefined {
  const service: WorkingDirectoryLike | undefined = ctx.get('workingDirectory')
  return typeof service?.ensure === 'function' ? service : undefined
}

/** The prefix of every diagnostic this plugin logs. */
const LOG_PREFIX = 'skill-residency:'

/** The last digest a `report`-mode deployment announced, so a step does not repeat it. */
const reported = new WeakMap<Agent, string>()

/**
 * Install the plugin.
 * @param ctx - the plugin context; the listener is disposed with it.
 * @param config - the configuration as mounted, possibly empty. Defaults are
 *   applied here rather than in an exported `Config` object, because a plain
 *   object under that name is read as a schema by the Loader and makes the plugin
 *   unmountable.
 * @throws when the configuration is unusable — `normalizeConfig` refuses a bound
 *   that cannot hold a word rather than silently rendering nothing.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const settings = normalizeConfig(config)
  if (settings.mode === 'off') return

  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    try {
      return await augment(ctx, agent, messages, signal, decision, settings)
    } catch (error: unknown) {
      // A plugin whose own bug fails a step is a worse failure than the one it
      // answers: report it and let the step proceed unmodified.
      ctx.logger.warn(`${LOG_PREFIX} leaving this step alone: ${String(error)}`)
      return decision
    }
  }, { prepend: true })
}

/**
 * Compute this step's plan and, when the model is not already holding it, append it.
 * @param ctx - the plugin context.
 * @param agent - the agent whose step is being assembled.
 * @param messages - the batch the step proposes, read to recognise a plan the loop
 *   is re-proposing.
 * @param signal - the turn's cancellation signal.
 * @param decision - what the rest of the waterfall decided.
 * @param settings - the resolved configuration.
 * @returns the decision, with this plugin's messages appended, or unchanged when
 *   there is nothing to publish.
 */
async function augment(
  ctx: Context,
  agent: Agent,
  messages: readonly UserMessage[],
  signal: AbortSignal,
  decision: Extract<PreStepDecision, { kind: 'enter' }>,
  settings: Settings,
): Promise<PreStepDecision> {
  const workingDirectory = workingDirectoryOf(ctx)
  const cwd = workingDirectory === undefined ? undefined : await workingDirectory.ensure(agent, signal)
  signal.throwIfAborted()
  const computed = await computePlan(ctx, agent, { cwd, signal, scope: agent }, settings)
  if (computed === undefined) return decision
  signal.throwIfAborted()
  const { plan, bodies } = computed
  if (isEmptyPlan(plan)) return decision

  const digest = digestPlan(plan)
  if (publishedPlan(agent).visibleDigest === digest) return decision
  if (proposedPlan(messages) === digest) return decision

  if (settings.mode === 'report') {
    if (reported.get(agent) !== digest) {
      reported.set(agent, digest)
      ctx.logger.info(`${LOG_PREFIX} would publish ${describePlan(plan)}`)
    }
    return decision
  }

  // Bodies first, the plan last: the plan is the message that states the residents
  // are loaded, and it is the record a later step reads to decide whether this
  // whole batch is still in front of the model.
  const injected = [...bodies.map(renderResident), renderPlan(plan)]
  return { ...decision, messages: [...decision.messages, ...injected] }
}

/**
 * The digest of a plan already present in the proposed batch.
 *
 * The loop may re-propose a batch it has not yet committed, and a second copy of
 * the same plan would be one the model reads twice. Matching is by digest rather
 * than by identity, so a re-rendered copy still counts.
 * @param messages - the batch the step proposes.
 * @returns the digest of the first readable plan, or undefined when there is none.
 */
function proposedPlan(messages: readonly UserMessage[]): string | undefined {
  for (const message of messages) {
    if (message.source.kind !== SOURCE_KIND) continue
    const plan = readPlan(message.source)
    if (plan !== undefined) return digestPlan(plan)
  }
  return undefined
}

export default { name, inject, apply }
