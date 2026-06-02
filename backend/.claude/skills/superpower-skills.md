# Superpower Skills Reference

A quick reference of the `superpowers:*` skills available via the `Skill` tool in Claude Code. Invoke a skill by passing its short name (after the `superpowers:` prefix) to the `Skill` tool — e.g. `Skill(skill="superpowers:brainstorming")`.

The golden rule: **if there is even a 1% chance a skill applies, invoke it before responding**. Process skills (brainstorming, debugging, TDD) take priority over implementation skills.

---

## Process & workflow skills

### `superpowers:using-superpowers`
Establishes how to find and use skills. Auto-loaded at the start of every conversation (not subagents). Tells you to invoke skills before any response — including clarifying questions.

### `superpowers:brainstorming`
**Use before any creative work** — new features, components, behavior changes. Explores user intent, requirements, and design before code is touched. Required before `EnterPlanMode`.

### `superpowers:writing-plans`
Use when you have a spec or requirements for a multi-step task, before touching code. Produces a written implementation plan to execute later.

### `superpowers:executing-plans`
Use when you have a written implementation plan to execute in a separate session with review checkpoints.

### `superpowers:subagent-driven-development`
Use when executing implementation plans whose tasks are independent in the current session. Pairs with `dispatching-parallel-agents`.

### `superpowers:dispatching-parallel-agents`
Use when facing 2+ independent tasks with no shared state or sequential dependencies. Tells you when/how to spawn parallel `Agent` calls.

### `superpowers:using-git-worktrees`
Use when starting feature work that needs isolation from the current workspace, or before executing implementation plans. Creates isolated git worktrees with smart directory selection and safety checks.

### `superpowers:finishing-a-development-branch`
Use when implementation is complete, tests pass, and you need to integrate the work — guides merge / PR / cleanup options.

---

## Quality & rigor skills

### `superpowers:test-driven-development`
**Use before writing implementation code** for any feature or bugfix. Rigid skill — follow exactly, don't adapt away the discipline.

### `superpowers:systematic-debugging`
**Use on any bug, test failure, or unexpected behavior, before proposing fixes.** Rigid skill — enforces a disciplined debugging loop instead of guessing.

### `superpowers:verification-before-completion`
Use when about to claim work is complete, fixed, or passing — and before committing or creating PRs. Requires running verification commands and confirming output. Evidence before assertions, always.

### `superpowers:requesting-code-review`
Use when completing tasks, implementing major features, or before merging — verifies work meets requirements.

### `superpowers:receiving-code-review`
Use when receiving code review feedback, especially if it seems unclear or technically questionable. Requires technical rigor and verification, not performative agreement or blind implementation.

### `superpowers:writing-skills`
Use when creating new skills, editing existing skills, or verifying skills work before deployment.

---

## Deprecated (do not use — kept for reference)

- `superpowers:brainstorm` → use `superpowers:brainstorming`
- `superpowers:execute-plan` → use `superpowers:executing-plans`
- `superpowers:write-plan` → use `superpowers:writing-plans`

---

## Decision flow

```
User message arrives
        │
        ▼
Is this a bug / failure / unexpected behavior?  ── yes ──▶ systematic-debugging
        │ no
        ▼
Is this creative work (new feature/behavior)?   ── yes ──▶ brainstorming  ──▶ writing-plans (if multi-step)
        │ no
        ▼
About to write production code for a feature/fix? ── yes ──▶ test-driven-development
        │ no
        ▼
About to claim "done" / commit / PR?            ── yes ──▶ verification-before-completion
        │ no
        ▼
Multiple independent subtasks?                  ── yes ──▶ dispatching-parallel-agents
        │ no
        ▼
Just respond (skills already covered)
```

## Red-flag thoughts (means STOP and check for a skill)

| Thought | Reality |
|---|---|
| "This is just a simple question" | Questions are tasks. Check skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check skills. |
| "Let me gather information first" | Skills tell you HOW to gather. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve — read the current version. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |

## Priority order when multiple skills apply

1. **Process skills first** (brainstorming, debugging, TDD) — they decide HOW to approach the task.
2. **Implementation skills second** (frontend-design, mcp-builder, claude-api, etc.) — they guide execution.

User instructions (CLAUDE.md, AGENTS.md, direct messages) always override skill defaults.
