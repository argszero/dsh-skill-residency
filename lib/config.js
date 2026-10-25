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
/** The smallest `whenToUseMaxLength` that can still show a word and an ellipsis. */
export const MIN_WHEN_TO_USE_LENGTH = 8;
/** The reference defaults. */
export const defaultConfig = {
    resident: [],
    honorMetadata: true,
    whenToUse: true,
    whenToUseMaxLength: 240,
    mode: 'inject',
};
/** Read a boolean, falling back for anything that is not one. */
function boolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
/** Read a list of non-empty strings, dropping anything else. */
function names(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    for (const entry of value) {
        if (typeof entry !== 'string')
            continue;
        const name = entry.trim();
        if (name !== '')
            seen.add(name);
    }
    return [...seen];
}
/**
 * Resolve a user configuration into the settings the plugin runs with.
 * @param config - the configuration as mounted, possibly empty.
 * @returns every setting, with defaults applied.
 * @throws when `whenToUseMaxLength` is present but not an integer of at least
 *   {@link MIN_WHEN_TO_USE_LENGTH} — a bound that cannot hold a word is a
 *   configuration mistake worth failing the mount over, rather than silently
 *   rendering nothing.
 */
export function normalizeConfig(config) {
    const mode = config.mode === 'off' || config.mode === 'report' ? config.mode : 'inject';
    const whenToUseMaxLength = config.whenToUseMaxLength ?? defaultConfig.whenToUseMaxLength;
    if (!Number.isInteger(whenToUseMaxLength) || whenToUseMaxLength < MIN_WHEN_TO_USE_LENGTH) {
        throw new TypeError(`skill-residency: whenToUseMaxLength must be an integer greater than or equal to ${String(MIN_WHEN_TO_USE_LENGTH)}, got ${String(whenToUseMaxLength)}`);
    }
    return {
        resident: names(config.resident),
        honorMetadata: boolean(config.honorMetadata, defaultConfig.honorMetadata),
        whenToUse: boolean(config.whenToUse, defaultConfig.whenToUse),
        whenToUseMaxLength,
        mode,
    };
}
