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
import { isModelInvocable } from '@deepseek-ai/dsh-skill';
import { digestText } from "./plan.js";
/** Per-agent classification cache. Weak, so a disposed agent's entries go with it. */
const classificationCache = new WeakMap();
/** The classification map for one agent, created on first use. */
function classificationsFor(agent) {
    const existing = classificationCache.get(agent);
    if (existing !== undefined)
        return existing;
    const created = new Map();
    classificationCache.set(agent, created);
    return created;
}
/**
 * Drop this agent's classification cache.
 *
 * Exported for the plugin's own disposer and for tests that need to observe a
 * re-classification. Nothing else should call it: the cache is precisely what
 * keeps a step off the filesystem.
 * @param agent - the agent whose cache is dropped.
 */
export function forgetClassifications(agent) {
    classificationCache.delete(agent);
}
/**
 * Whether a loaded definition carries the residency marker.
 *
 * The marker is `metadata.resident === true` — a strict boolean, so a string
 * `"true"` from a hand-written metadata object does not silently count.
 * @param metadata - the definition's parsed `metadata`, if any.
 * @returns whether the skill declared itself resident.
 */
export function readsResidentMarker(metadata) {
    return metadata?.['resident'] === true;
}
/**
 * Normalize one author's `whenToUse` into the text that will be rendered.
 * @param value - the raw frontmatter value, if the skill declared one.
 * @param maxLength - inclusive bound on the normalized text.
 * @returns the normalized, bounded text, or undefined when there is nothing to say
 *   (absent, blank, or whitespace-only).
 */
export function normalizeWhenToUse(value, maxLength) {
    if (typeof value !== 'string')
        return undefined;
    const normalized = value.replaceAll(/\s+/g, ' ').trim();
    if (normalized === '')
        return undefined;
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
/**
 * Load one skill's definition, or undefined when it is no longer available.
 * @param ctx - the plugin context, read for `skills`.
 * @param name - the skill to load.
 * @param lookup - the borrowed read context for this step.
 * @returns the definition, when the registry still serves one.
 */
async function loadDefinition(ctx, name, lookup) {
    const definition = await ctx.skills.get(name, lookup);
    lookup.signal.throwIfAborted();
    return definition;
}
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
export async function computePlan(ctx, agent, lookup, settings) {
    const snapshot = await ctx.skills.snapshot(lookup);
    if (!snapshot.complete)
        return undefined;
    const skills = snapshot.skills.filter(isModelInvocable);
    const hints = [];
    if (settings.whenToUse) {
        for (const skill of skills) {
            const whenToUse = normalizeWhenToUse(skill.whenToUse, settings.whenToUseMaxLength);
            if (whenToUse === undefined)
                continue;
            hints.push({ name: skill.name, whenToUse });
        }
    }
    const requested = new Set(settings.resident);
    const cache = classificationsFor(agent);
    const bodies = [];
    const resident = [];
    for (const skill of skills) {
        let classification = cache.get(skill.name);
        const wanted = requested.has(skill.name);
        if (classification === undefined || (wanted && !classification.resident)) {
            if (!wanted && !settings.honorMetadata) {
                // Nothing can make this skill resident without a config entry, and reading
                // every body to prove it would be work with no reader.
                cache.set(skill.name, { resident: false });
                continue;
            }
            const definition = await loadDefinition(ctx, skill.name, lookup);
            const isResident = wanted || readsResidentMarker(definition?.metadata);
            classification = isResident && definition !== undefined
                ? { resident: true, definition }
                : { resident: false };
            cache.set(skill.name, classification);
        }
        const definition = classification.definition;
        if (!classification.resident || definition === undefined)
            continue;
        resident.push({ name: skill.name, bodyDigest: digestText(definition.content) });
        bodies.push(definition);
    }
    return { plan: { hints, resident }, bodies };
}
