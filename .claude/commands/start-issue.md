---
description: Start work the Glaon way — tracking issue first, then a clean branch off development
argument-hint: <issue-number | short description of the work>
---

Start a new unit of work following the Issue-First and Branching rules in CLAUDE.md. The argument is either an existing issue number or a short description of work that needs a new issue.

## Steps

1. **Resolve the issue (Issue-First Rule — no exceptions besides repo bootstrap):**
   - If the argument is a number, fetch it (`gh issue view <N>` or GitHub MCP) and confirm it is open and matches the intended work.
   - Otherwise, search for an existing issue first (`gh issue list --search "..."`). If none fits, create one with: Motivation, Scope — In, Scope — Out, Acceptance checklist. Title must be a valid Conventional Commit subject (it may become a squash commit). Apply existing labels (`type:*`, `area:*`, phase label if applicable).
   - Tell the user the issue number before touching any file.

2. **Create the branch off development:**

   ```bash
   git switch development && git pull
   git switch -c <issue>-<short-kebab-slug>
   ```

   - Never branch from `main`. Never commit to `development` or `main` directly.
   - If the main checkout is dirty with unrelated work, do NOT stash someone else's WIP — create a worktree instead:
     ```bash
     git fetch origin development
     git worktree add .claude/worktrees/<issue>-<slug> -b <issue>-<slug> origin/development
     ```

3. **Restate scope before coding:** summarize Scope In/Out from the issue in one short list and get user confirmation if anything is ambiguous. Every commit on this branch references the issue (`Refs #N`; final PR uses `Closes #N`).

4. **Check rule triggers for this work** and say which apply:
   - UI component → Storybook Rule + UUI Source Rule + Design-System Fidelity Rule (Figma node IDs required in PR body).
   - Feature → E2E Smoke Rule (one `@smoke` Playwright test).
   - Auth/storage/network/crypto → security-review skill on the PR.
   - API errors → Toast Rule (`useToast`, no inline API error blocks).
