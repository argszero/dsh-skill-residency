/**
 * Rendering: the two texts this plugin puts in front of the model.
 *
 * Both are `user` messages with a durable source, because that is the only
 * channel a pre-step listener may add model-visible content through — the
 * `agent/request` waterfall "cannot mutate messages", and `agent/pre-step`
 * returns the batch the loop then commits and logs.
 *
 * The plan message enumerates the authors' routing hints. The resident message
 * carries one skill body, rendered with `renderSkillContent` from
 * `@deepseek-ai/dsh-skill` — the very function the `skill` tool and the
 * user-explicit `/name` gesture both render through. That is not decoration: the
 * catalog already tells the model "a user may also invoke a skill directly; its
 * `<skill_content>` block then appears in this conversation. Follow it, and do
 * not call the `skill` tool again for that skill", so a resident body written in
 * the same envelope inherits that reading instead of inventing a second one.
 *
 * @module @argszero/dsh-skill-residency/render
 */
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { SkillDefinition } from '@deepseek-ai/dsh-skill';
import type { ResidencyPlan } from './plan.ts';
/**
 * The plan message.
 *
 * Both sections are optional and the message is only built when at least one is
 * non-empty (the caller checks {@link isEmptyPlan}), so the framing never arrives
 * with nothing to say.
 * @param plan - the hints and resident records to publish.
 * @returns the durable user message carrying them.
 */
export declare function renderPlan(plan: ResidencyPlan): UserMessage;
/**
 * One resident skill's body.
 *
 * The rendering is `renderSkillContent`, unchanged, so a model that has seen the
 * `skill` tool's result or a `/name` gesture recognises this envelope exactly.
 * @param definition - the loaded skill, whose body is the message text.
 * @returns the durable user message carrying it.
 */
export declare function renderResident(definition: SkillDefinition): UserMessage;
/**
 * The one-line account {@link describe} logs under `mode: 'report'`.
 *
 * Names only — a report is for deciding whether to turn the plan on, and the
 * texts themselves are the part a reader can already see in the skills' own
 * frontmatter.
 * @param plan - the computed plan.
 * @returns a single line naming both halves.
 */
export declare function describePlan(plan: ResidencyPlan): string;
//# sourceMappingURL=render.d.ts.map