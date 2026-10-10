/**
 * Packaging guard: the published artifact must declare every bare specifier it
 * imports, must not declare packages it never mentions, must ship the files the
 * manifest promises — and must keep the one property that makes a Cordis plugin
 * mountable at all.
 *
 * Each arm is a defect this family has already shipped once somewhere:
 *
 * - A value import declared only in `devDependencies` resolves on the publishing
 *   machine and fails for a consumer with `ERR_MODULE_NOT_FOUND`.
 * - A `files` list that names the entry but not its modules publishes a package
 *   whose own relative imports are missing.
 * - A **plain object** exported as `Config` — under either a named export or the
 *   default export — is read as a schema by the Loader (`resolveConfig` calls
 *   `runtime.Config['~standard'].validate`), so the plugin throws
 *   `Cannot read properties of undefined (reading 'validate')` at mount. The
 *   namespace mount that a test suite performs hides it, which is why it is
 *   asserted on the artifact's own export shape here.
 *
 * `npm pack --dry-run` is deliberate: it uses npm's own matcher, where a
 * hand-rolled glob would be the same guess the defect is made of.
 *
 * @module test/packaging.spec
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import semver from 'semver'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/**
 * The prerelease lines this plugin claims to work on.
 *
 * Calibrated by running the suite with every harness package pinned to one line
 * (`scripts/probe-lines.sh`). The list is the contract and the manifest has to
 * agree with it — not the other way round.
 */
const SUPPORTED_LINES = ['0.1.7-rc.2', '0.2.0-rc.2', '0.2.1-alpha.2']

/**
 * The two readings of a prerelease range that a consumer can take.
 *
 * They disagree about a range whose only prerelease comparator names an older
 * tuple: the include-prerelease reading (pnpm, and the repository's own gate)
 * admits a later line, the default reading (npm) rejects it with `ERESOLVE`
 * while the same install succeeds silently under pnpm. A range is only as wide as
 * its narrowest reader, so both are asserted.
 */
const READINGS = [{}, { includePrerelease: true }]

/**
 * The Cordis version each supported line's harness packages are built against.
 *
 * Cordis carries its own version series, so it is not one of
 * {@link SUPPORTED_LINES}; each harness line peers on a different one, and a
 * plugin that named only the oldest would make the newest line unresolvable for
 * the consumer that installs it (`ERESOLVE`, from the harness package's own peer).
 */
const CORDIS_FOR_LINE = {
  '0.1.7-rc.2': '4.0.4',
  '0.2.0-rc.2': '4.0.4',
  '0.2.1-alpha.2': '4.0.5-alpha.1',
}

/** Every file under `dir`, recursively. */
function walk(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else found.push(path)
  }
  return found
}

/** Specifiers reached by static import/export, dynamic `import()` and `require()`. */
function allSpecifiers(source) {
  const specifiers = new Set()
  const patterns = [
    /(?:^|[\s;{])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;(=])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|[\s;{])(?:import|export)\s*['"]([^'"]+)['"]/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1])
  }
  return specifiers
}

/** The package a bare specifier names. */
function packageOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

test('every bare specifier the build imports is declared, and nothing else is', () => {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  // What the published artifact imports at RUNTIME — the only direction a consumer
  // can fail on, since a missing package is `ERR_MODULE_NOT_FOUND` at mount.
  const runtimeUsed = new Set()
  for (const file of walk(join(ROOT, 'lib'))) {
    if (!file.endsWith('.js')) continue
    for (const specifier of allSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      runtimeUsed.add(packageOf(specifier))
    }
  }
  assert.ok(runtimeUsed.size > 0, 'expected the build to import something')
  for (const name of runtimeUsed) {
    assert.ok(declared.has(name), `${name} is imported at runtime but not declared in dependencies/peerDependencies`)
  }
  // The other direction: a declaration is a promise to the consumer, and a
  // type-only import in `src/` — erased by the build — is what justifies one.
  const sourceUsed = new Set()
  for (const file of walk(join(ROOT, 'src'))) {
    if (!file.endsWith('.ts')) continue
    for (const specifier of allSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      sourceUsed.add(packageOf(specifier))
    }
  }
  for (const name of declared) {
    assert.ok(sourceUsed.has(name), `${name} is declared but never imported, not even as a type`)
  }
})

test('every declared peer range admits each supported line, read either way', () => {
  // The ranges are union segments on purpose, one per supported line: a single
  // `>=x <y` segment that names only an older prerelease is read differently by
  // npm and by pnpm — installed-but-unresolvable on one and silently fine in the
  // other, which is the split that lets the mistake survive a local test run.
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    for (const line of SUPPORTED_LINES) {
      const version = name === '@deepseek-ai/cordis' ? CORDIS_FOR_LINE[line] : line
      for (const reading of READINGS) {
        assert.ok(
          semver.satisfies(version, range, reading),
          `${name}'s range ${range} does not admit ${version} (line ${line}) under ${
            reading.includePrerelease === true ? 'the include-prerelease reading' : 'the default reading'}`,
        )
      }
    }
  }
})

test('the manifest ships what it promises', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' })
  const files = JSON.parse(output)[0].files.map(file => file.path)
  for (const required of ['package.json', 'README.md', 'LICENSE', 'cordis.patch.yml', 'lib/index.js']) {
    assert.ok(files.includes(required), `npm pack would not ship ${required}`)
  }
  assert.ok(!files.some(file => file.startsWith('src/')), 'the published tarball must not carry sources')
  assert.ok(!files.some(file => file.startsWith('test/')), 'the published tarball must not carry tests')
})

test('the bundle patch exists and mounts this package by its own name', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string', 'package.json must declare dsh.bundle.patch')
  const path = join(ROOT, patch)
  assert.ok(existsSync(path), `${patch} does not exist`)
  const text = readFileSync(path, 'utf8')
  assert.match(text, new RegExp(`name: '${manifest.name}'`), 'the patch must mount this package by name')
})

test('the default export is mountable: name, inject, apply — and no plain-object Config', async () => {
  const plugin = await import(join(ROOT, 'lib/index.js'))
  const exported = plugin.default
  assert.equal(typeof exported.name, 'string')
  assert.ok(Array.isArray(exported.inject))
  assert.equal(typeof exported.apply, 'function')
  assert.equal(exported.name, plugin.name)
  assert.equal(exported.apply, plugin.apply)
  // A plain object here is what `resolveConfig` cannot read.
  if ('Config' in exported) {
    assert.equal(
      typeof exported.Config?.['~standard']?.validate,
      'function',
      'an exported Config must be a Standard Schema, never a plain object',
    )
  }
  if ('Config' in plugin) {
    assert.equal(
      typeof plugin.Config?.['~standard']?.validate,
      'function',
      'an exported Config must be a Standard Schema, never a plain object',
    )
  }
})

test('the README names every supported line and no others', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  for (const line of SUPPORTED_LINES) {
    assert.ok(readme.includes(line), `README does not mention the supported line ${line}`)
  }
  // The trap this catches: a README quoting a range the manifest does not admit,
  // which is how a documented line becomes an installed-but-unresolvable one.
  for (const line of ['0.2.0-alpha.1', '0.1.6-rc.1']) {
    assert.ok(!readme.includes(line), `README mentions ${line}, which no peer range admits`)
  }
})
