# dsh-hermes-memory

DSH-native persistent memory, session-aware retrieval, and safe learning for DeepSeek Harness.

## Status

Design and project bootstrap phase. V1 implementation has not started.

## Product boundary

This is a new DSH plugin. It does not copy Pi runtime code, Pi commands, Pi TUI, Pi branding, Pi logos, Pi screenshots, or other Pi visual assets. It reuses only general engineering ideas such as scoped memories, provenance, full-text retrieval, correction tracking, and secret scanning.

## V1 scope

- Explicit `memory_save`, `memory_search`, `memory_replace`, and `memory_remove` tools.
- Global, user, project, and failure memory scopes.
- DSH `storage-domain` persistence with schema validation.
- Pre-write secret and prompt-injection scanning.
- Settings namespace and a small settings card for enablement, retrieval limits, capture policy, and retention.
- Source provenance containing session ID and event sequence when a memory comes from a DSH session.

## Deferred scope

- Automatic prompt injection on every step.
- Background model review and consolidation.
- Vector or embedding retrieval.
- Custom session database access.
- Replacement of DSH chat UI or session shell.

## Development

The implementation plan lives at:

- `docs/superpowers/plans/2026-08-26-dsh-hermes-memory.md`

The approved design is documented at:

- `docs/superpowers/specs/2026-08-26-dsh-hermes-memory-design.md`

## License

MIT. The implementation will contain original DSH-specific code and will not vendor Pi project assets.
