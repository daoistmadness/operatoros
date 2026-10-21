# OperatorOS Agent Skills

This versioned package ships task-scoped guidance for coding agents. The
`skills/elysiajs/SKILL.md` points to the package note `docs/elysiajs.md` and
the references under `docs/elysiajs/references/`.

## Use with TanStack Intent

Install this package and a pinned `@tanstack/intent` CLI in the consumer
project. Configure an explicit allowlist and exclusions in `package.json`:

```json
{
  "intent": {
    "skills": ["@operatoros/agent-skills#elysiajs"],
    "exclude": ["@tanstack/intent"]
  }
}
```

`intent list` inspects dependency manifests and static skill files; it does not
execute dependency package code. It surfaces only allowed skills after
exclusions. Load the Elysia guidance only for a matching backend task:

```sh
intent load @operatoros/agent-skills#elysiajs
```

Editor hooks are optional convenience integrations. They cannot prove that a
skill was loaded, relevant, or followed, and they are not a security boundary.
Use CI validation and normal code review for enforceable checks.
