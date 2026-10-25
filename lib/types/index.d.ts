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
import type { Context } from '@deepseek-ai/cordis';
import type { Config } from './config.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "skill-residency";
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
export declare const inject: string[];
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
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map