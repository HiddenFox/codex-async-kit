# Codex Async Release State

Last updated: 2026-09-06 23:55 +08:00
Maintainer role: `codex-async-release-manager`
Role contract: `docs/RELEASE_MANAGER.md`

## Current Versions

- Local candidate: `1.1.2`
- Published Grove version: `1.1.2`
- Grove kit: `codex-async` (`OteJGwtOzLqL7jmyZ2PfM`)
- Published bundle hash: `b82ec8aa888bfb86108a499e86804ca29ab487171dd07bf4948e452090b94d1d`
- Published bundle size: `12229` bytes
- Local candidate archive: `target/codex-async-1.1.2.tar.gz` (`12265` bytes, generated 2026-09-06)

The local archive and published bundle sizes differ. Do not infer that they are identical without downloading and comparing their contents and hashes again.

## Repository State

- Repository: `D:\Workspace\code\codex-async-kit`
- Branch: `master`, ahead of `origin/master` by 6 commits at the last inspection.
- HEAD: `a5d262eff878864bd9e6956600e5ab00e4424118` (`fix: align callbacks with Heart query auth`)
- Worktree: dirty. It contains the uncommitted `1.1.2` unified configuration, packaging, documentation, and test changes, plus untracked files.
- An untracked `nul` entry is present. Its ownership and purpose have not been established; do not delete it without inspection or explicit instruction.
- No commit, tag, push, or deployment has been authorized for the current dirty worktree.

Run `git status --short --branch` and inspect the current diff before relying on this snapshot.

## Published State

`GET https://beings.town/api/grove/codex-async` returned HTTP 200 on 2026-09-06 23:54 +08:00 and reported:

- version `1.1.2`
- status `grown`
- manifest version `1.1.2`
- bundle present
- setup guide based on `codex-async.env.example`

This confirms the Grove metadata at that time. It does not by itself verify a fresh installation or callback behavior.

## Verification Evidence

- `npm test` passed during the `1.1.2` preparation flow.
- `npm run package:release` completed and generated the local archive under `target/`.
- The generated archive was previously extracted over the local installed Kit and its metadata and JavaScript syntax were checked.
- A live callback smoke test succeeded during the `1.1.2` release flow, and Grove call reporting advanced afterward.
- The currently published Grove metadata was independently read back as described above.

Before a future release, rerun all gates from the current worktree. Historical passes are not current release evidence.

## Role Conversion

The former one-off Prime tentacle `108a32a5` has been saved as the durable Prime profile `codex-async-release-manager` using model `gpt/gpt-5.6-terra`.

The runtime tentacle remains reusable only while its current Prime server process survives. After restart, spawn the saved profile and use the bootstrap prompt in `docs/RELEASE_MANAGER.md`. This state file and the repository are authoritative; the old runtime ID is not.

## Authorization State

No side-effect authorization remains active.

The previous authorization for the single `1.1.2` Grove publication was consumed and is expired. Future publication, commit, tag, push, installation, Portal restart, or deployment requires explicit authorization naming the action and target version.

## Pending Decisions

- Decide whether and when to commit the current `1.1.2` worktree.
- Inspect the untracked `nul` entry before deciding its disposition.
- Before another release, reconcile the current worktree, rerun tests and packaging, inspect the archive whitelist, and compare the exact candidate against the intended release.

## Next Action

For ordinary Release Manager startup, recover context and report state only. Do not perform side effects until the human provides a new version-specific authorization.
