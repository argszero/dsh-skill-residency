# @argszero/dsh-skill-residency

Gives the skill system the two things it cannot express today: a **resident**
(always-on) loading path, and **model visibility** for the `whenToUse`
frontmatter field.

A [Cordis](https://github.com/deepseek-ai/deepseek-harness) plugin for the
DeepSeek Harness — an independent npm package, mounted through
`dsh.bundle.patch`. It changes no core package and works on the released lines
`0.1.7-rc.2`, `0.2.0-rc.2` and `0.2.1-alpha.2`.

## The two gaps

**A skill that should always be on cannot say so.** The catalog message every
session receives ends with the trigger rule:

> If the user names a skill, or the task clearly matches a skill's description,
> call the `skill` tool…

Both conditions presume a skill **bound to a task**. An output style — *"load
this at the start of every session and follow it for all responses until the
reader says stop"* — satisfies neither, and no frontmatter field carries the
intent: the filesystem provider parses `name`, `description`, `whenToUse`,
`metadata`, `disable-model-invocation` and `user-invocable`, and none of them
means *always*. Making such instructions resident means leaving the skill system
and writing them into `AGENTS.md`.

**`whenToUse` is never shown to the model.** It is parsed, validated,
documented, and carried to the client — and it stops there. The catalog emits
`{name, description}` per skill (`catalogSourceEntries`), `renderSkillContent`
renders the body, and `@deepseek-ai/dsh-tool-skill` contains **zero** occurrences
of the field. An author writes the routing sentence and the model never sees it.

Both were reported together in [discussion
#9375](https://github.com/deepseek-ai/deepseek-harness/discussions/9375).

## What it does

At `agent/pre-step` — the waterfall every model request is assembled through —
the plugin appends at most two kinds of message, as durable, source-attributed
`user` messages:

1. **the plan message** — each author's `whenToUse`, so routing intent reaches
   the model;
2. **one message per resident skill** — its full body, rendered through
   `renderSkillContent`, the same `<skill_content>` envelope the `skill` tool and
   the user's `/name` gesture already produce. The catalog already tells the
   model how to read that envelope, so a resident body inherits the reading
   instead of inventing a second one.

Residency is declared in either of two places:

| Where | How |
|---|---|
| Configuration | `resident: ['my-style', 'my-rules']` |
| The skill itself | `metadata: { resident: true }` in its frontmatter |

```markdown
---
name: house-style
description: The house output style.
metadata:
  resident: true
---

Never open with a summary sentence. Never close with a question.
```

No core change is needed for the frontmatter form: the filesystem provider
preserves arbitrary `metadata` keys.

## Why a message, and not a system prompt

The injection is a logged, source-attributed message, so it is **durable**. The
plan is re-published when it changes, and re-published automatically after
compaction drops it — detected by asking the session which of its events the
model can still see (`agent.session.surface.nodes`), never by keeping plugin
state. A resident skill therefore survives the context window, and the plugin
stays quiet when nothing changed. This is the mechanism
`@deepseek-ai/dsh-tool-skill` uses for its catalog, applied to the two facts core
does not render.

## Install

```sh
dsh plugin --profile <profile> add github:argszero/dsh-skill-residency
```

The git spec installs the tree this README describes; `npm install` on its own never attaches a plugin to a profile — `dsh plugin add` is what writes the row that makes it load.

Mount it in a profile bundle — `cordis.patch.yml` next to this README is that
patch, ready to reference:

```yaml
- insert:
    - id: skill-residency
      name: '@argszero/dsh-skill-residency'
```

With no configuration, the plugin publishes each skill's `whenToUse` and injects
the body of every skill that marks itself `resident: true`. Add a `config` block
to name residents outright or to change the behaviour:

```yaml
- insert:
    - id: skill-residency
      name: '@argszero/dsh-skill-residency'
      config:
        resident: ['house-style']
        whenToUse: true
        whenToUseMaxLength: 240
        mode: inject
```

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `resident` | `[]` | Skill names whose full body is always injected, whether or not their frontmatter says so. A name matching no model-invocable skill is ignored, not an error — a deployment may list a skill it installs later. |
| `honorMetadata` | `true` | Also treat `metadata: { resident: true }` as residency. |
| `whenToUse` | `true` | Render each author's `whenToUse` for the model. Nothing is rendered for a skill that declares none. |
| `whenToUseMaxLength` | `240` | Inclusive bound on one rendered `whenToUse`, after whitespace normalization; longer values are truncated with an ellipsis. Minimum `8` — a smaller value is refused at mount rather than silently rendering nothing. |
| `mode` | `inject` | `inject` appends the plan to the step. `report` computes the same plan and logs it instead — how to see what a deployment would send before letting it send anything. `off` installs nothing at all. |

## What it is not

It is not the fix. An `always-load` field the tool path recognises, the catalog
carrying `whenToUse`, and trigger wording that admits resident skills are all
changes in the harness's own packages; this plugin exists so the capability is
available to a deployment that cannot patch them. It refuses nothing, injects
nothing when there is nothing to inject, and reads nothing outside the skill
registry.

## Behaviour notes

- **Inert by default.** A deployment whose skills declare no `whenToUse` and
  keep no residents gets no message, no session event and no token spent.
- **One message per changed plan.** A step that finds the model already holding
  the current plan appends nothing — including the case where the loop
  re-proposes a batch it has not committed yet.
- **Residency is classified once per session per skill.** The marker lives on the
  loaded definition, not on the catalog summary, and reading every skill body on
  every request is a filesystem read per model call. Flipping the marker, or
  editing a resident body, takes effect for a skill the first time a *new* agent
  session sees it. A `resident` entry in config is not cached as a decision, but
  the body it names is, so the digest the plan publishes and the text the message
  carries are always the same text.
- **Fails open.** If the skill service throws, the step proceeds unmodified and
  the plugin logs. A plugin whose own bug fails a step would be worse than the
  gap it answers.
- **No working-directory service required.** Project-scoped skills are planned
  when the composition provides one; without it, the global layer is still
  planned.

## Verify

```sh
npm test              # behaviour arms against the real registry and the real waterfall
npm run test:inject   # mutation arms: every defect must be caught by a named arm
npm run probe:lines   # re-run the suite with every harness package pinned to one line
npm run build         # emit lib/
```

The behaviour suite drives a **real** Cordis context, the **real**
`@deepseek-ai/dsh-skill` registry, the **real** filesystem provider and real
skill files on disk, through the dispatcher the agent loop itself uses. Every arm
that claims "the plugin injected this" is paired with the same world with the
plugin unmounted.

## License

MIT.
