/**
 * The durable injection plan: what gets published, how it is identified, and how
 * a later step recognises that it is already there.
 *
 * The plan has two halves. `hints` is the routing intent skill authors declare
 * but the model never sees (`whenToUse`); `resident` is the set of skills whose
 * full body belongs in the conversation. Their digests, not their rendered prose,
 * are the plan's identity — the prose is written for the model and must not
 * decide whether a republish is needed (the same split
 * `@deepseek-ai/dsh-tool-skill` draws for its catalog).
 *
 * {@link publishedPlan} is what makes the injection survive the context window.
 * It reads the agent's own session backlog for an earlier plan and compares the
 * digest of the one the model can still see (`agent.session.surface.nodes` — the
 * folded, model-visible set). A plan whose message was dropped by compaction is
 * simply not visible any more, and the next step publishes it again. That is the
 * mechanism `tool-skill` uses for its catalog, applied to the two skill facts
 * core does not render; reusing it is deliberate, because it is the one shape
 * that survives compaction *and* stays quiet when nothing changed.
 *
 * @module @argszero/dsh-skill-residency/plan
 */
import { createHash } from 'node:crypto';
import { SessionSeq } from '@deepseek-ai/dsh-session';
/** The `source.kind` every message this plugin publishes carries. */
export const SOURCE_KIND = 'skill-residency';
/** The plan that injects nothing. */
export const EMPTY_PLAN = { hints: [], resident: [] };
/**
 * Whether a plan has nothing to publish.
 *
 * The whole plugin is inert under this predicate, which is the point: a
 * deployment that declares no `whenToUse` anywhere and keeps no residents sees
 * no message, no session event, and no token spent.
 * @param plan - the plan to test.
 * @returns whether both halves are empty.
 */
export function isEmptyPlan(plan) {
    return plan.hints.length === 0 && plan.resident.length === 0;
}
/** Digest of one exact string, hex. */
export function digestText(value) {
    return createHash('sha256').update(value).digest('hex');
}
/**
 * The plan's identity.
 *
 * Canonical JSON per record rather than a separator: every separator character is
 * itself a legal skill name or body character, so only quoting makes the boundary
 * exact. Both arrays are published in a deterministic order (name, ascending), so
 * two runs that found the same skills necessarily agree here.
 * @param plan - the plan to identify.
 * @returns a hex digest of both halves.
 */
export function digestPlan(plan) {
    const canonical = JSON.stringify({
        hints: plan.hints.map(hint => [hint.name, hint.whenToUse]),
        resident: plan.resident.map(record => [record.name, record.bodyDigest]),
    });
    return digestText(canonical);
}
/** Read a string field, or undefined when it is absent or not a usable string. */
function stringField(value) {
    return typeof value === 'string' ? value : undefined;
}
/**
 * Read one plan back out of a durable source.
 *
 * The record may come from a resumed, forked, or externally written session seed,
 * and seed validation guarantees only a source object with a non-empty `kind` —
 * no per-kind field is checked there. Anything that is not structurally a plan is
 * therefore "not this plugin's plan", never a throw: a listener that throws
 * inside `agent/pre-step` would fail every later turn of that session.
 * @param source - the raw `source` of one durable user message.
 * @returns the readable plan, or undefined when the record is not one.
 */
export function readPlan(source) {
    if (typeof source !== 'object' || source === null)
        return undefined;
    const raw = source;
    if (!Array.isArray(raw.hints) || !Array.isArray(raw.resident))
        return undefined;
    const hints = [];
    for (const entry of raw.hints) {
        if (typeof entry !== 'object' || entry === null)
            return undefined;
        const { name, whenToUse } = entry;
        const readName = stringField(name);
        const readWhen = stringField(whenToUse);
        if (readName === undefined || readName === '' || readWhen === undefined)
            return undefined;
        hints.push({ name: readName, whenToUse: readWhen });
    }
    const resident = [];
    for (const entry of raw.resident) {
        if (typeof entry !== 'object' || entry === null)
            return undefined;
        const { name, bodyDigest } = entry;
        const readName = stringField(name);
        const readDigest = stringField(bodyDigest);
        if (readName === undefined || readName === '' || readDigest === undefined)
            return undefined;
        resident.push({ name: readName, bodyDigest: readDigest });
    }
    return { hints, resident };
}
/**
 * The newest plan in this session's backlog, and whether the model can see it.
 *
 * The scan walks backwards from the current session length, which is the same
 * window `tool-skill` reads for its catalog, and for the same reason: the durable
 * record is the only thing that survives a resumed or compacted session, and
 * `surface.nodes` is the only statement of what the model currently holds.
 * @param agent - the agent whose session is read.
 * @returns the visible digest (when there is one) and whether anything was ever
 *   published.
 * @throws when the session reports a length its own history cannot serve, which
 *   means the log was rewritten underneath the read rather than that this plan
 *   is absent.
 */
export function publishedPlan(agent) {
    const visible = new Set(agent.session.surface.nodes);
    let published = false;
    for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        const event = agent.session.eventAt(SessionSeq(index));
        if (event === undefined) {
            throw new Error(`skill-residency: cannot read session seq ${String(index)} below the current length`);
        }
        if (event.type !== 'user/message' || event.data.source.kind !== SOURCE_KIND)
            continue;
        const plan = readPlan(event.data.source);
        if (plan === undefined)
            continue;
        published = true;
        if (visible.has(event.seq))
            return { visibleDigest: digestPlan(plan), published };
    }
    return { published };
}
