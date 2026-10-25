/**
 * Configuration and its normalization.
 *
 * Five knobs, each answering a question an operator actually asks: *which skills
 * are always on* (`resident`), *may a skill declare that for itself*
 * (`honorMetadata`), *should the authors' routing hints reach the model*
 * (`whenToUse`), *how much of a hint is worth its tokens*
 * (`whenToUseMaxLength`), and *can I watch before I trust it* (`mode`).
 *
 * The defaults are "do the useful thing, change nothing else": honour both the
 * config list and the frontmatter marker, publish the routing hints, inject. The
 * strictest knob is {@link Settings.whenToUse} at its default `true`, and even
 * that one is inert — a deployment whose skills declare no `whenToUse` gets no
 * message at all, because the plan is empty and an empty plan injects nothing.
 *
 * @module @argszero/dsh-skill-residency/config
 */
/** What the plugin does with a plan it computed. */
export type ResidencyMode = 'inject' | 'report' | 'off';
/** The plugin configuration as a user writes it. */
export interface Config {
    /**
     * Skill names whose full body is injected as resident instructions, whether or
     * not their frontmatter says so. A name that currently matches no
     * model-invocable skill is ignored rather than an error: a deployment may list
     * a skill it installs later.
     */
    readonly resident?: readonly string[];
    /**
     * Also treat a skill whose frontmatter carries `metadata: { resident: true }`
     * as resident. Default `true`.
     *
     * The marker is read from the loaded definition (`ctx.skills.get()`), because
     * `SkillSummary` — all `ctx.skills.snapshot()` returns — carries `whenToUse`
     * but not `metadata`. Each skill name is therefore classified **once per
     * session** and the answer cached for that session's lifetime; flipping the
     * marker on an already-classified skill takes effect in the next session.
     */
    readonly honorMetadata?: boolean;
    /**
     * Render each skill's `whenToUse` into a model-facing message. Default `true`.
     * Nothing is rendered for a skill that declares none.
     */
    readonly whenToUse?: boolean;
    /**
     * Inclusive bound on one rendered `whenToUse`, after whitespace normalization.
     * Longer values are truncated with an ellipsis. Minimum 8, default 240 — large
     * enough for the two-clause sentences this field is written in, small enough
     * that a runaway frontmatter value cannot spend a request's budget. Catalog
     * descriptions are bounded the same way upstream (`catalogDescriptionMaxLength`).
     */
    readonly whenToUseMaxLength?: number;
    /**
     * `inject` (default) appends the plan to the step. `report` computes the same
     * plan and logs it instead, which is how to see what a deployment would send
     * before letting it send anything. `off` installs nothing at all.
     */
    readonly mode?: ResidencyMode;
}
/** The configuration with every default resolved and every value validated. */
export interface Settings {
    readonly resident: readonly string[];
    readonly honorMetadata: boolean;
    readonly whenToUse: boolean;
    readonly whenToUseMaxLength: number;
    readonly mode: ResidencyMode;
}
/** The smallest `whenToUseMaxLength` that can still show a word and an ellipsis. */
export declare const MIN_WHEN_TO_USE_LENGTH = 8;
/** The reference defaults. */
export declare const defaultConfig: Required<Config>;
/**
 * Resolve a user configuration into the settings the plugin runs with.
 * @param config - the configuration as mounted, possibly empty.
 * @returns every setting, with defaults applied.
 * @throws when `whenToUseMaxLength` is present but not an integer of at least
 *   {@link MIN_WHEN_TO_USE_LENGTH} — a bound that cannot hold a word is a
 *   configuration mistake worth failing the mount over, rather than silently
 *   rendering nothing.
 */
export declare function normalizeConfig(config: Config): Settings;
//# sourceMappingURL=config.d.ts.map