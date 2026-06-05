---
description: Sync the PR body (Scope / Test plan) and tracking issue with the current diff before pushing
argument-hint: [pr-number]
---

Enforce the PR Scope & Test Plan Sync Rule: the PR body is a live document and must describe the diff being pushed, not the diff from three pushes ago.

## Steps

1. Read the current PR body (`gh pr view <N> --json title,body`) and the full branch diff (`git diff origin/development...HEAD --stat` plus the actual diff for changed areas).
2. Answer explicitly: **"Does this body still describe what I'm pushing?"** Check each:
   - **Scope In** lists everything the diff now does — new dependencies, added features, pulled-in deferred items.
   - **Scope Out** still matches; anything moved to a follow-up issue is listed with its issue number.
   - **Test plan** has an item for every new behavior; stale items for removed work are deleted, not left unchecked.
   - **Figma node links** cover all UI surfaces in the diff.
   - **`Closes #N`** is present and points at the right issue.
   - **Title** is still an accurate Conventional Commit for the squash.
3. If anything drifted: update with `gh pr edit <N> --body-file <updated-body>` (and `--title` if needed) **before** `git push`.
4. Sync the tracking issue: if the In/Out split changed, amend the issue body or drop a comment so the issue stays the single source of truth.
5. Report a short drift summary to the user: what changed in the body, or "in sync, nothing to update".
