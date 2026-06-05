---
description: Open the PR with the Glaon body contract and watch CI until green
argument-hint: [issue-number]
---

Ship the current branch: final pre-flight, PR creation against `development`, then CI watch. Never merge — the user reviews and merges.

## Pre-flight (block on failure)

1. `pnpm type-check` and `pnpm lint` pass locally.
2. Branch follows `<issue>-<slug>` and is pushed up to date.
3. Commits are Conventional Commits (commitlint runs in CI; rewrite history on the feature branch if needed).
4. Rule check for the diff:
   - New/changed UI component → story + `.controls.ts` + `.mdx` exist in this diff (Storybook Rule); Figma node ID(s) known (Fidelity Rule).
   - New feature → at least one `@smoke` Playwright test in `apps/web-e2e/tests/` (E2E Smoke Rule).
   - Auth/storage/network/crypto touched → run the `security-review` skill before opening the PR.

## PR creation

```bash
gh pr create --base development --title "<conventional-commit-title>" --body-file <body>
```

PR body must contain, in this order:

- **Summary** — what and why, 2–4 sentences.
- **Scope** — In / Out lists matching the current diff exactly.
- **Figma** — node ID links for any UI work (omit section if no UI).
- **Test plan** — checklist a reviewer can reproduce; include the side-by-side Figma check at documented breakpoints for UI.
- **`Closes #N`** — mandatory. A PR without it is a workflow bug.

The PR title becomes the squash commit subject — it must be a valid Conventional Commit (`feat:` MINOR, `fix:`/`perf:`/`refactor:` PATCH, `!`/`BREAKING CHANGE:` MAJOR).

## CI watch (CI-Green-Before-Done Rule)

```bash
gh pr checks <N> --watch
```

- Failure → `gh run view <id> --log-failed`, fix root cause on the same branch, commit, push, keep watching.
- Flaky → `gh run rerun` once; persistent failures are fixed in code, never by disabling the check.
- Chromatic diffs → open the build, review; accept intentional changes in the Chromatic UI, fix unintended regressions in code. Remind the user that unaccepted diffs will fail the strict gate on `development`.
- Do not report "ready for review" while any check is red or pending.

After CI is green, hand off: post the PR link and a one-line status. Do not run `gh pr merge`.
