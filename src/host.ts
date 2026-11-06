/**
 * The harness modules this plugin borrows, resolved from the running host.
 *
 * ## Why this file exists
 *
 * 0.1.0 imported five values at module scope — `createUserMessage` from
 * `@deepseek-ai/dsh-llm`, `SessionSeq` from `@deepseek-ai/dsh-session`, and
 * `isModelInvocable`, `escapeText`, `renderSkillContent` from
 * `@deepseek-ai/dsh-skill` — which is fatal in a profile, and structurally so
 * rather than for a missing dependency. A profile installs with
 * `autoInstallPeers: false`, so pnpm installs a package's own `dependencies` and
 * none of its peers, and all of those packages are peers here. Node then resolves
 * the bare specifier from this plugin's own directory, finds nothing, and the
 * module never evaluates: the loader never sees the plugin, and the two gaps it
 * exists to close stay open. Declaring them as real `dependencies` is not the
 * repair — it moves the failure one level deeper, since each of those packages
 * imports its own peers at module scope, and where it does load the profile's copy
 * wins resolution for the whole process and silently shadows core packages (the
 * crash discussion #10338 reports).
 *
 * So the plugin asks the running host instead. Node resolves a bare specifier from
 * a base path, and `require()` of an ES module answers with the namespace object
 * the host already loaded — the same module record, not a second one.
 *
 * ## Why the evidence is graded rather than asserted
 *
 * A path on the stack proves something about the modules resolved from it, and
 * exactly how much depends on which frame the path came from. This plugin says so
 * in the report instead of flattening the three readings into "reached":
 *
 * - `host-frame` — a frame inside one of the three borrowed packages. Strongest:
 *   that package is executing, so the modules are the host's own instances.
 * - `host-tree` — a frame (or the process entry) inside some other harness
 *   package, or inside the shipped CLI. Same install tree, but the tree is not
 *   proof of a single instance.
 * - `fallback` — the working directory or this package's own tree. May be a second
 *   copy that merely happens to resolve.
 *
 * The grade is disclosure, not a correctness guard, because every borrowed value
 * here is **identity-free**, measured from the source rather than assumed:
 *
 * - `SessionSeq` is `brandNumber<SessionSeq>(value)`
 *   (`packages/core/session/src/types.ts:44`) — a validated number, and a number
 *   carries no identity.
 * - `isModelInvocable` reads `skill.invocation.modelInvocable`
 *   (`packages/skill/skill/src/index.ts:126`); `escapeText` and
 *   `renderSkillContent` are pure string functions over their argument.
 * - `createUserMessage` builds a fresh object (`packages/llm/llm/src/message.ts:246`).
 *
 * None is a `WeakSet` membership, an `instanceof` target or a module-scope Map, so
 * a second copy would behave identically here — unlike the loop-marker pair one of
 * this fleet's other borrows, where the identity is the deliverable. That is why
 * this plugin discloses which anchor answered instead of refusing a weaker one.
 *
 * ## What the failure must not become
 *
 * The plugin's contract is that a bug of its own never fails a step, so an
 * unreachable host must not throw into `agent/pre-step`. It must equally not be
 * silent, and it must not be mistaken for a plugin defect: "this session has no
 * resident skills" and "I could not reach the host, so I could not compute a plan"
 * are different facts, and only one of them is about the session.
 * {@link resolutionReport} therefore never throws and never answers "nothing to
 * publish" — it says `reached: false`, lists every anchor it tried and counts the
 * failure, which is what makes an unattended outage legible to an operator.
 *
 * Resolution is synchronous and lazy. Synchronous because a pre-step listener calls
 * these values while assembling a step; lazy because nothing here runs at import
 * time, which is what lets the package load in a profile that installs none of the
 * harness packages.
 *
 * Nothing here probes at mount time on purpose: `apply()` runs on the loader's own
 * stack, where none of these frames need appear, so a probe there would report an
 * outage to a host that is working perfectly.
 *
 * @module @argszero/dsh-skill-residency/host
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The host packages this plugin borrows. All are declaration-time peers. */
export const HOST_PACKAGES = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-skill',
] as const

/**
 * This package's own directory.
 *
 * A frame inside it is never the host's: it is this plugin's code, or a copy of the
 * harness packages installed beneath it as devDependencies. Matched by path prefix
 * rather than by name, because a name match is wrong in both directions — it misses
 * a package installed under any other directory name, and it silently discards
 * every frame whenever this package's own checkout happens to be named
 * `dsh-skill-residency`, which is exactly what its repository is called.
 */
const SELF_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Any harness package's directory, as it appears in a frame's path. */
const HARNESS_DIRECTORY = join('node_modules', '@deepseek-ai') + '/'

/** The three borrowed packages' own directories, as they appear in a frame's path. */
const BORROWED_DIRECTORIES = HOST_PACKAGES.map(name => join('node_modules', ...name.split('/')))

/**
 * What a successful resolution is evidence of, strongest first.
 *
 * See the module doc: the grade says how much the anchor proves, and the plugin
 * publishes it rather than collapsing it into a bare "reached".
 */
export type ResolutionKind = 'host-frame' | 'host-tree' | 'fallback'

/** One base path to try, and what resolving through it would prove. */
export interface AnchorCandidate {
  readonly path: string
  readonly kind: ResolutionKind
}

/** The borrowed modules, plus where they were found. */
export interface HostModules {
  /** The path whose resolution answered, for disclosure in a report. */
  readonly anchor: string
  /** Whether that anchor proves the instance is the host's own. */
  readonly kind: ResolutionKind
  /** The version of every borrowed package that answered, by name. */
  readonly packages: Readonly<Record<string, string>>
  /** `@deepseek-ai/dsh-llm`'s message builder. */
  readonly llm: {
    readonly createUserMessage: typeof import('@deepseek-ai/dsh-llm').createUserMessage
  }
  /** `@deepseek-ai/dsh-session`'s sequence brand. */
  readonly session: {
    readonly SessionSeq: typeof import('@deepseek-ai/dsh-session').SessionSeq
  }
  /** The three `@deepseek-ai/dsh-skill` values this plugin renders and filters through. */
  readonly skill: {
    readonly isModelInvocable: typeof import('@deepseek-ai/dsh-skill').isModelInvocable
    readonly escapeText: typeof import('@deepseek-ai/dsh-skill').escapeText
    readonly renderSkillContent: typeof import('@deepseek-ai/dsh-skill').renderSkillContent
  }
}

/** A resolution that answered, and what it is evidence of. */
export interface ResolutionReached {
  readonly reached: true
  readonly kind: ResolutionKind
  readonly anchor: string
  readonly packages: Readonly<Record<string, string>>
}

/** A resolution that did not answer. The plugin is inactive, and says so. */
export interface ResolutionUnreached {
  readonly reached: false
  /** Constant marker: no host module was reached, so no plan can be computed. */
  readonly inactive: true
  /** Every base path that was tried, in order. */
  readonly tried: readonly string[]
  /** What this state means, in one sentence an operator can act on. */
  readonly reason: string
}

/** What {@link resolutionReport} answers, with this process's running totals. */
export type ResolutionReport =
  | (ResolutionReached & { readonly failures: number })
  | (ResolutionUnreached & { readonly failures: number })

/** The path a stack line names, or undefined when the line names none. */
function framePath(line: string): string | undefined {
  const match = line.match(/\(?((?:file:\/\/)?\/[^():]+):\d+:\d+\)?$/)
  const frame = match?.[1]
  if (frame === undefined) return undefined
  return frame.startsWith('file://') ? fileURLToPath(frame) : frame
}

/**
 * File paths named by the current stack that belong to the harness, graded.
 * @returns candidate anchors, outermost frame first.
 */
function stackAnchors(): AnchorCandidate[] {
  const stack = String(new Error('anchor').stack ?? '')
  const found: AnchorCandidate[] = []
  for (const line of stack.split('\n')) {
    const path = framePath(line)
    if (path === undefined || path.startsWith(SELF_ROOT)) continue
    const kind: ResolutionKind | undefined = BORROWED_DIRECTORIES.some(directory => path.includes(directory))
      ? 'host-frame'
      : path.includes(HARNESS_DIRECTORY) ? 'host-tree' : undefined
    if (kind === undefined) continue
    // Keep the strongest reading of a path seen twice: a frame reached as a
    // borrowed package is stronger evidence than the same path read as a sibling.
    const seen = found.findIndex(candidate => candidate.path === path)
    if (seen === -1) found.push({ path, kind })
    else if (kind === 'host-frame') found[seen] = { path, kind }
  }
  return found
}

/**
 * Every anchor to try, in the order that prefers the host over this package.
 *
 * De-duplication keeps the first occurrence, which is why the stack anchors come
 * first: the same path reached as a host frame and as a fallback is host-frame
 * evidence, and the weaker reading must not overwrite the stronger one.
 * @returns base file paths, de-duplicated, each with the evidence it carries.
 */
export function anchorCandidates(): AnchorCandidate[] {
  const entry = process.argv[1]
  const candidates: Array<AnchorCandidate | undefined> = [
    ...stackAnchors(),
    entry === undefined
      ? undefined
      : { path: entry, kind: entry.includes(HARNESS_DIRECTORY) ? 'host-tree' : 'fallback' },
    { path: join(process.cwd(), 'index.js'), kind: 'fallback' },
    { path: fileURLToPath(import.meta.url), kind: 'fallback' },
  ]
  const seen = new Set<string>()
  const ordered: AnchorCandidate[] = []
  for (const candidate of candidates) {
    if (candidate === undefined || seen.has(candidate.path)) continue
    seen.add(candidate.path)
    ordered.push(candidate)
  }
  return ordered
}

/** Read one package's version through the same anchor that resolved it. */
function versionOf(require: NodeRequire, name: string): string {
  for (const relative of [join('..', 'package.json'), join('..', '..', 'package.json')]) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(dirname(require.resolve(name)), relative), 'utf8'),
      ) as { version?: unknown }
      if (typeof manifest.version === 'string') return manifest.version
    } catch {
      // Another depth may still answer; a version is disclosure, not a gate.
    }
  }
  return 'unknown'
}

/** Resolve every borrowed package through one anchor, or throw. */
function readFrom(candidate: AnchorCandidate): HostModules {
  const require = createRequire(candidate.path)
  // `require()` of an ES module answers with the namespace object the host already
  // loaded: the same module record, not a copy of it.
  const llm = require('@deepseek-ai/dsh-llm') as typeof import('@deepseek-ai/dsh-llm')
  const session = require('@deepseek-ai/dsh-session') as typeof import('@deepseek-ai/dsh-session')
  const skill = require('@deepseek-ai/dsh-skill') as typeof import('@deepseek-ai/dsh-skill')
  // A namespace missing one of the five values is not a usable answer, however
  // successfully it resolved: counting it as reached would report a working plugin
  // over a package that cannot render a message or brand a sequence.
  const wanted: ReadonlyArray<readonly [string, unknown]> = [
    ['createUserMessage', llm.createUserMessage],
    ['SessionSeq', session.SessionSeq],
    ['isModelInvocable', skill.isModelInvocable],
    ['escapeText', skill.escapeText],
    ['renderSkillContent', skill.renderSkillContent],
  ]
  for (const [name, value] of wanted) {
    if (typeof value !== 'function') {
      throw new TypeError(`a borrowed host package resolved without ${name}`)
    }
  }
  return {
    anchor: candidate.path,
    kind: candidate.kind,
    packages: {
      '@deepseek-ai/dsh-llm': versionOf(require, '@deepseek-ai/dsh-llm'),
      '@deepseek-ai/dsh-session': versionOf(require, '@deepseek-ai/dsh-session'),
      '@deepseek-ai/dsh-skill': versionOf(require, '@deepseek-ai/dsh-skill'),
    },
    llm: { createUserMessage: llm.createUserMessage },
    session: { SessionSeq: session.SessionSeq },
    skill: {
      isModelInvocable: skill.isModelInvocable,
      escapeText: skill.escapeText,
      renderSkillContent: skill.renderSkillContent,
    },
  }
}

/**
 * Resolve every borrowed package through the first anchor that answers.
 *
 * The counter-free core, exported so the failure arm can drive it with anchors that
 * are known to resolve nothing — the one reading this plugin cannot produce from a
 * working checkout any other way.
 * @param candidates - base paths in preference order.
 * @returns the modules and the anchor that answered.
 * @throws when no candidate resolves every borrowed package.
 */
export function resolveFrom(candidates: readonly AnchorCandidate[]): HostModules {
  const tried: string[] = []
  let last: unknown
  for (const candidate of candidates) {
    tried.push(candidate.path)
    try {
      return readFrom(candidate)
    } catch (error: unknown) {
      // This anchor is a candidate, not a verdict: the next one may resolve.
      last = error
    }
  }
  const error = new Error(
    `skill-residency: could not reach ${HOST_PACKAGES.join(', ')} from any anchor. Tried:\n`
    + tried.map(anchor => `  - ${anchor}`).join('\n')
    + (last === undefined ? '' : `\nLast error: ${String(last)}`),
  )
  Object.defineProperty(error, 'anchors', { value: tried, enumerable: true })
  throw error
}

let cached: HostModules | undefined

/** Running totals for this process: attempts made, and attempts that reached nothing. */
const counts = { attempts: 0, failures: 0 }

/**
 * How many resolutions have been attempted, and how many found nothing.
 *
 * A count rather than the last value: a plugin that could not reach the host once
 * and one that has been failing on every step all session are different
 * operational states, and only the count separates them.
 * @returns the running totals for this process.
 */
export function resolutionCounts(): { attempts: number, failures: number } {
  return { attempts: counts.attempts, failures: counts.failures }
}

/** The reason recorded on an unreached report; constant so a log line can be grepped. */
const UNREACHED_REASON =
  `skill-residency: no anchor reached the running host's ${HOST_PACKAGES.join(', ')},`
  + ' so the plugin is inactive: no plan is computed and nothing is injected. Reported rather'
  + ' than swallowed because "this session has no resident skills" and "the host could not be'
  + ' reached" are different facts, and only one of them is about the session.'

/**
 * What the resolver can currently reach, without ever throwing.
 *
 * This is the reading an operator needs when the plugin looks inert: a resolution
 * that did not answer is `reached: false` with every anchor tried and a failure
 * counted, never an exception at the step boundary and never a claim that there was
 * simply nothing to publish.
 * @returns the reached modules with their evidence, or the anchors that failed.
 */
export function resolutionReport(): ResolutionReport {
  counts.attempts += 1
  if (cached !== undefined) {
    return { reached: true, kind: cached.kind, anchor: cached.anchor, packages: cached.packages, failures: counts.failures }
  }
  const tried = anchorCandidates().map(candidate => candidate.path)
  try {
    const modules = resolveFrom(anchorCandidates())
    cached = modules
    return { reached: true, kind: modules.kind, anchor: modules.anchor, packages: modules.packages, failures: counts.failures }
  } catch {
    counts.failures += 1
    return { reached: false, inactive: true, tried, failures: counts.failures, reason: UNREACHED_REASON }
  }
}

/**
 * The host's modules, resolved once and reused.
 *
 * The first call resolves and caches; a failure is not cached, so a later call from
 * a deeper host frame gets its own chance to find an anchor.
 * @returns the borrowed modules and the anchor that answered.
 * @throws when no anchor resolves the packages.
 */
export function hostModules(): HostModules {
  if (cached !== undefined) return cached
  counts.attempts += 1
  try {
    cached = resolveFrom(anchorCandidates())
    return cached
  } catch (error: unknown) {
    counts.failures += 1
    throw error
  }
}
