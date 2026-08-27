# dsh-hermes-memory

DSH-native persistent memory, session-aware retrieval, and safe learning for DeepSeek Harness.

## Status

V4.2 is now implemented locally. Expired memories are cleaned by retention policy: non-failure records use `retentionDays` (90) and failure records use `failureRetentionDays` (30), anchored at `lastReferencedAt ?? updatedAt`. Cleanup runs at startup and on a throttled per-session basis, and can be disabled entirely. Background model review and vector search remain deferred; a separate memory management UI is not planned.

## Product boundary

This is a new DSH plugin. It does not copy Pi runtime code, Pi commands, Pi TUI, Pi branding, Pi logos, Pi screenshots, or other Pi visual assets. It reuses only general engineering ideas such as scoped memories, provenance, full-text retrieval, correction tracking, and secret scanning.

## V1 scope

- Explicit `memory_save`, `memory_search`, `memory_replace`, and `memory_remove` tools.
- Global, user, project, and failure memory scopes.
- DSH `storage-domain` persistence with schema validation.
- Pre-write secret and prompt-injection scanning.
- Settings namespace and a small settings card for enablement, retrieval limits, capture policy, and retention.
- Source provenance containing session ID and event sequence when a memory comes from a DSH session.
- `session_memory_search` powered by DSH's native `sessionQuery` service.
- Optional V3 session-start injection of bounded reference context, off by default.

## V3 scope

- Opt-in `agent/session-start` injection of one bounded `form: 'recall'` context message per agent lifecycle.
- Authorized global, user, and current project memories only; failure memories are not injected automatically.
- Deterministic scope/date/ID ordering, entry limits, total character limits, resume de-duplication, and fail-soft startup behavior.

## V3.1 scope

- `memory_list` lists bounded records by scope/category and the current workspace.
- `memory_stats` reports counts and character usage per scope.
- `lastReferencedAt` advances on search hits and successful startup injection, off-path and fail-soft.
- List/stats and reference tracking never bypass the existing exact-match workspace authorization.

## V4 scope (first slice)

- Rule-based captures from real `user/message` events: corrections, project conventions, and preferences.
- Captured records carry `source: 'session'` provenance with session ID and event sequence.
- Idempotency via existing provenance fields and content deduplication; no new storage tables or domain version bump.
- Per-session capture cap, category switches, and safety scanning before every write; default off.

## V4.1 scope

- Per-session tracking of `lastToolCall`/`lastFailure` and the previous user-message sequence.
- Corrections paired with a failed tool call in the same exchange also save a `failure/tool-quirk` record naming the tool.
- A failure context is consumed at most once; `captureToolContext` lets users disable pairing.

## V4.2 scope

- Expired memory cleanup using `lastReferencedAt ?? updatedAt` as the aging anchor.
- Failure-scope records expire after `failureRetentionDays`; all others after `retentionDays`.
- Hard delete with count-only logging; invalid timestamps are kept; `retentionEnabled` can disable cleanup.
- Sweeps run at startup and are throttled to once per hour per process on session starts.

## Deferred scope

- Automatic prompt injection on every step.
- Background model review and consolidation.
- Vector or embedding retrieval.
- Custom session database access.
- Replacement of DSH chat UI or session shell.
- A separate memory management UI is not planned: view, filter, and remove memories through the built-in `memory_list`, `memory_stats`, `memory_replace`, and `memory_remove` tools instead.

## Development

The implementation plan lives at:

- `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md`
- `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md`

The approved design is documented at:

- `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`

## License

MIT. The implementation will contain original DSH-specific code and will not vendor Pi project assets.
