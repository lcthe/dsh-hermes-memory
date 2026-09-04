# dsh-hermes-memory

DSH-native persistent memory, session-aware retrieval, and safe learning for DeepSeek Harness.

## Status

V5 background review, V6 standing context, and the V7 consolidation foundation are implemented locally. Standing profiles and instructions are explicitly saved, bounded, persisted in the DSH storage domain, and injected once at the start of each new session. V7 now has crash-safe plan state, replacement-before-retirement execution, structured model scheduling, and native settings. V8 now has storage-backed skills and a DSH-native provider; explicit skill tools and automatic learning remain in progress.

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
- Vector or embedding retrieval.
- Custom session database access.
- Replacement of DSH chat UI or session shell.
- A separate memory management UI is not planned: ordinary memories use the existing memory tools, while standing context is managed with `memory_pin`, `memory_pins`, and `memory_unpin`.

## Development

The V5 background review implementation and its safety constraints are documented here:

- `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v5-background-review-design.md`
- `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v5-background-review.md`

The implementation plan for earlier versions lives at:

- `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md`
- `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md`

The approved design is documented at:

- `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`

## License

MIT. The implementation will contain original DSH-specific code and will not vendor Pi project assets.
