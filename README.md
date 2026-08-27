# dsh-hermes-memory

DSH-native persistent memory, session-aware retrieval, and safe learning for DeepSeek Harness.

## Status

V3's first slice is now implemented locally. In addition to the V1/V2 features, the plugin can optionally inject a bounded reference context once at `agent/session-start`. Injection is disabled by default, limited to authorized global/user/project memories, and does not capture new memories automatically. Per-step retrieval and background review remain deferred.

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
## Deferred scope

- Automatic prompt injection on every step.
- Background model review and consolidation.
- Vector or embedding retrieval.
- Custom session database access.
- Replacement of DSH chat UI or session shell.

## Development

The implementation plan lives at:

- `docs/superpowers/specs/2026-08-27-dsh-hermes-memory-v3-session-start-injection-design.md`
- `docs/superpowers/plans/2026-08-27-dsh-hermes-memory-v3-session-start-injection.md`

The approved design is documented at:

- `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`

## License

MIT. The implementation will contain original DSH-specific code and will not vendor Pi project assets.
