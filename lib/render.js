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
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill';
import { SOURCE_KIND } from "./plan.js";
/**
 * The plan message.
 *
 * Both sections are optional and the message is only built when at least one is
 * non-empty (the caller checks {@link isEmptyPlan}), so the framing never arrives
 * with nothing to say.
 * @param plan - the hints and resident records to publish.
 * @returns the durable user message carrying them.
 */
export function renderPlan(plan) {
    const lines = ['<system-reminder>'];
    if (plan.hints.length > 0) {
        lines.push('Skill routing hints. Each line below is the skill author\'s own `whenToUse`; weigh it together with the skill\'s description when deciding whether that skill applies, and call the `skill` tool for one that does.', '', ...plan.hints.map(hint => `- \`${hint.name}\`: ${escapeText(hint.whenToUse)}`));
    }
    if (plan.resident.length > 0) {
        if (plan.hints.length > 0)
            lines.push('');
        lines.push('Resident skills. Their instructions are already loaded into this conversation and apply to every response until the reader says otherwise; do not call the `skill` tool for them.', '', ...plan.resident.map(record => `- \`${record.name}\``));
    }
    lines.push('</system-reminder>');
    return createUserMessage({
        content: [{ type: 'text', text: lines.join('\n') }],
        source: { kind: SOURCE_KIND, form: 'instructions', hints: plan.hints, resident: plan.resident },
    });
}
/**
 * One resident skill's body.
 *
 * The rendering is `renderSkillContent`, unchanged, so a model that has seen the
 * `skill` tool's result or a `/name` gesture recognises this envelope exactly.
 * @param definition - the loaded skill, whose body is the message text.
 * @returns the durable user message carrying it.
 */
export function renderResident(definition) {
    return createUserMessage({
        content: [{ type: 'text', text: renderSkillContent(definition) }],
        source: { kind: SOURCE_KIND, form: 'instructions', skill: definition.name },
    });
}
/**
 * The one-line account {@link describe} logs under `mode: 'report'`.
 *
 * Names only — a report is for deciding whether to turn the plan on, and the
 * texts themselves are the part a reader can already see in the skills' own
 * frontmatter.
 * @param plan - the computed plan.
 * @returns a single line naming both halves.
 */
export function describePlan(plan) {
    const hints = plan.hints.map(hint => hint.name).join(', ');
    const resident = plan.resident.map(record => record.name).join(', ');
    return `hints=[${hints}] resident=[${resident}]`;
}
