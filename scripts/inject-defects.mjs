/**
 * Defect injection: mutate the source, rebuild, run the affected suite, and
 * require that the mutation is caught. An arm whose mutation leaves the suite
 * green is SILENT — it proves nothing about the test that was supposed to hold
 * the line.
 *
 * The suite imports `lib/*.js`, not `src/*.ts`, so every arm rebuilds with tsc
 * first; a mutation that fails to type-check proves nothing either, and is
 * reported separately as UNBUILDABLE. The source is restored **and rebuilt**
 * whatever happened: an injector that can leave a mutation (or a stale `lib/`) in
 * the tree would be worse than no injector.
 *
 * Every mutation here is a defect this plugin could plausibly ship — a guard
 * dropped, a bound moved, a predicate loosened, a bookkeeping map replaced. None
 * is engineered to be caught: each names the shape of mistake the arm exists for.
 *
 * Run from the plugin root: `npm run test:inject`.
 *
 * The control arm is the unmutated suite, run first: every mutant is compared
 * against a suite that is known green, so a manifest-wide failure (a broken
 * dependency, a missing build) cannot be mistaken for a caught defect.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MUTATIONS = [
  {
    name: 'a plan with hints but no residents is treated as empty, so every routing hint is dropped',
    file: 'src/plan.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '  return plan.hints.length === 0 && plan.resident.length === 0',
      '  return plan.hints.length === 0 || plan.resident.length === 0',
    ]],
  },
  {
    name: 'the body digest is constant, so an edited resident body is never re-published',
    file: 'src/plan.ts',
    arms: 'residency.spec.mjs',
    edits: [["  return createHash('sha256').update(value).digest('hex')", "  return 'digest'"]],
  },
  {
    name: 'the visibility test is inverted, so a plan the model still holds looks compacted away',
    file: 'src/plan.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '    if (visible.has(event.seq)) return { visibleDigest: digestPlan(plan), published }',
      '    if (!visible.has(event.seq)) return { visibleDigest: digestPlan(plan), published }',
    ]],
  },
  {
    name: 'whitespace is no longer collapsed, so a wrapped frontmatter value reaches the model as written',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      "  const normalized = value.replaceAll(/\\s+/g, ' ').trim()",
      '  const normalized = value.trim()',
    ]],
  },
  {
    name: 'a blank value is no longer absent, so an empty hint is published',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [["  if (normalized === '') return undefined", '  if (normalized.length === -1) return undefined']],
  },
  {
    name: 'the ellipsis is appended past the bound instead of inside it, so a bounded hint overshoots',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      'normalized.slice(0, maxLength - 3)',
      'normalized.slice(0, maxLength)',
    ]],
  },
  {
    name: 'the residency marker is read as truthy rather than as a strict boolean',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [["  return metadata?.['resident'] === true", "  return Boolean(metadata?.['resident'])"]],
  },
  {
    name: 'the model-invocable filter is dropped, so a user-only skill is published to the model',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '  const skills = snapshot.skills.filter(isModelInvocable)',
      '  const skills = snapshot.skills',
    ]],
  },
  {
    name: 'the frontmatter marker is honoured even when the operator turned it off',
    file: 'src/residency.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '      if (!wanted && !settings.honorMetadata) {',
      '      if (!wanted && settings.whenToUseMaxLength === -1) {',
    ]],
  },
  {
    name: 'the bound on whenToUseMaxLength is not validated, so an unusable value mounts silently',
    file: 'src/config.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '  if (!Number.isInteger(whenToUseMaxLength) || whenToUseMaxLength < MIN_WHEN_TO_USE_LENGTH) {',
      '  if (whenToUseMaxLength === -1) {',
    ]],
  },
  {
    name: 'the mode is always inject, so a report-only deployment writes to the session',
    file: 'src/config.ts',
    arms: 'residency.spec.mjs',
    edits: [
      ["  const mode = config.mode === 'off' || config.mode === 'report' ? config.mode : 'inject'", "  const mode = 'inject'"],
    ],
  },
  {
    name: 'an unchanged plan is republished on every step',
    file: 'src/index.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '  if (publishedPlan(agent).visibleDigest === digest) return decision',
      "  if (publishedPlan(agent).visibleDigest === digest + ' ') return decision",
    ]],
  },
  {
    name: 'a batch the loop is re-proposing is published to twice',
    file: 'src/index.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '  if (proposedPlan(messages) === digest) return decision',
      "  if (proposedPlan(messages) === digest + ' ') return decision",
    ]],
  },
  {
    name: 'the fail-open path rethrows, so one registry failure fails the turn',
    file: 'src/index.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      '      ctx.logger.warn(`${LOG_PREFIX} leaving this step alone: ${String(error)}`)\n      return decision',
      '      ctx.logger.warn(`${LOG_PREFIX} leaving this step alone: ${String(error)}`)\n      throw error',
    ]],
  },
  {
    name: 'a resident message loses the name that identifies the skill it carries',
    file: 'src/render.ts',
    arms: 'residency.spec.mjs',
    edits: [[
      "    source: { kind: SOURCE_KIND, form: 'instructions', skill: definition.name },",
      "    source: { kind: SOURCE_KIND, form: 'instructions' },",
    ]],
  },
]

/** Rebuild `lib/` from `src/`; true when tsc accepted the tree. */
function build() {
  try {
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')], { cwd: ROOT, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Run one suite file; true when it failed, plus its output. */
function runSuite(arms) {
  try {
    execFileSync(process.execPath, ['--test', `test/${arms}`], { cwd: ROOT, stdio: 'pipe' })
    return { failed: false, output: '' }
  } catch (error) {
    return { failed: true, output: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

// The control arm: the unmutated tree. A suite that is red on its own makes every
// CAUGHT below meaningless, so it is asserted rather than assumed.
if (!build()) {
  console.log('CONTROL UNBUILDABLE: src/ does not compile, no arm below proves anything')
  process.exit(1)
}
const control = runSuite('*.spec.mjs')
if (control.failed) {
  console.log('CONTROL RED: the unmutated suite fails, no arm below proves anything')
  console.log(control.output)
  process.exit(1)
}
console.log('CONTROL: the unmutated suite is green')

let silent = 0
let unbuildable = 0
for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file)
  const original = readFileSync(path, 'utf8')
  let mutated = original
  let anchored = true
  for (const [find, replace] of mutation.edits) {
    if (!original.includes(find)) {
      anchored = false
      console.log(`SKIP (anchor missing): ${mutation.name}`)
    }
    mutated = mutated.replace(find, replace)
  }
  if (!anchored) continue

  writeFileSync(path, mutated)
  let built = false
  let result = { failed: false, output: '' }
  try {
    built = build()
    if (built) result = runSuite(mutation.arms)
  } finally {
    // Restore the source and rebuild, whatever happened: leaving either a mutation
    // or a stale `lib/` behind is the failure mode this file exists to avoid, and a
    // stale `lib/` is how an arm goes SILENT.
    writeFileSync(path, original)
    build()
  }

  if (!built) {
    unbuildable += 1
    console.log(`UNBUILDABLE (proves nothing): ${mutation.name}`)
    continue
  }
  const caught = result.failed && /fail [1-9]/.test(result.output)
  if (!caught) silent += 1
  console.log(`${caught ? 'CAUGHT' : 'SILENT'}: ${mutation.name} (${mutation.arms})`)
}
console.log(`SILENT ARMS: ${silent === 0 ? 'none' : String(silent)}; UNBUILDABLE: ${String(unbuildable)}`)
if (silent > 0 || unbuildable > 0) process.exit(1)
