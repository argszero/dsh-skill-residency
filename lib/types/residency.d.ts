/**
 * Computing the plan from the live skill registry.
 *
 * This module holds the one piece of state the plugin keeps: which skills are
 * resident, and — for the resident ones — the exact definition that was published
 * under each name. `SkillSummary`, all `ctx.skills.snapshot()` returns, carries
 * `whenToUse` but **not** `metadata`, so the frontmatter marker can only be read
 * from a loaded definition, and loading one per skill per step would put a
 * filesystem read on every model request. The answer is classified once per agent
 * and cached for that agent's lifetime; the steady-state cost of a step is then a
 * snapshot, a handful of map lookups, and one hash.
 *
 * The trade that cache makes is real and is stated where it is made: a marker or a
 * body edited mid-session is picked up only when the name is first seen by a *new*
 * agent. `resident` entries in config are not cached — they are decided from the
 * configuration — but the body they name is, for the same reason: the digest the
 * plan publishes and the body the message carries must be the same text.
 *
 * @module @argszero/dsh-skill-residency/residency
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
import type { Settings } from './config.ts';
import type { ResidencyPlan } from './plan.ts';
/** The borrowed read context every registry call in one step shares. */
export interface SkillLookup {
    /** The workspace whose project-level skills belong to this agent, when one is known. */
    readonly cwd: string | undefined;
    readonly signal: AbortSignal;
    readonly scope: Agent;
}
/** What one step decided to publish, and the bodies it needs to publish it. */
export interface ResidencyComputation {
    readonly plan: ResidencyPlan;
    /**
     * The loaded definitions of the resident skills, in the same order as
     * `plan.resident`. The two are produced together so a caller renders one from
     * the other without a second lookup, and so they cannot drift apart.
     */
    readonly bodies: readonly SkillDefinition[];
}
/**
 * Drop this agent's classification cache.
 *
 * Exported for the plugin's own disposer and for tests that need to observe a
 * re-classification. Nothing else should call it: the cache is precisely what
 * keeps a step off the filesystem.
 * @param agent - the agent whose cache is dropped.
 */
export declare function forgetClassifications(agent: Agent): void;
/**
 * Whether a loaded definition carries the residency marker.
 *
 * The marker is `metadata.resident === true` — a strict boolean, so a string
 * `"true"` from a hand-written metadata object does not silently count.
 * @param metadata - the definition's parsed `metadata`, if any.
 * @returns whether the skill declared itself resident.
 */
export declare function readsResidentMarker(metadata: Readonly<Record<string, unknown>> | undefined): boolean;
/**
 * Normalize one author's `whenToUse` into the text that will be rendered.
 * @param value - the raw frontmatter value, if the skill declared one.
 * @param maxLength - inclusive bound on the normalized text.
 * @returns the normalized, bounded text, or undefined when there is nothing to say
 *   (absent, blank, or whitespace-only).
 */
export declare function normalizeWhenToUse(value: string | undefined, maxLength: number): string | undefined;
/**
 * Compute one step's plan.
 * @param ctx - the plugin context, read for `skills`.
 * @param agent - the agent whose scope and session the registry is read through.
 * @param lookup - the borrowed read context for this step.
 * @param settings - the resolved configuration.
 * @returns the plan and its resident bodies, or `undefined` when discovery did not
 *   complete within a stable catalog revision — in which case the caller leaves the
 *   step alone rather than publishing a plan computed from a half-read catalog
 *   (the last-good posture `tool-skill` takes for its own).
 */
export declare function computePlan(ctx: Context, agent: Agent, lookup: SkillLookup, settings: Settings): Promise<ResidencyComputation | undefined>;
//# sourceMappingURL=residency.d.ts.map