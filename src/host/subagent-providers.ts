/**
 * Provider discovery across DSH releases.
 *
 * `SubagentRuntime.list()` existed through 0.2.0-rc.2 but was removed by
 * 0.2.2-rc.5, where the runtime only exposes `getProvider(name)` plus its
 * internal `providers` map. Enumerate the map when `list()` is missing so
 * automatic review and consolidation keep working on both lines.
 */

export interface SubagentProviderLike {
  capabilities?: { outputSchema?: boolean }
}

export interface SubagentRuntimeLike {
  list?(): string[]
  getProvider?(name: string): SubagentProviderLike | undefined
  providers?: Map<string, SubagentProviderLike>
}

export function listProviderNames(subagents: SubagentRuntimeLike | undefined): string[] {
  if (subagents === undefined) return []
  try {
    if (typeof subagents.list === 'function') return subagents.list()
  } catch {
    // Fall through to the provider map: a hostile list() must not break flush.
  }
  const providers = subagents.providers
  if (providers instanceof Map) return [...providers.keys()]
  return []
}

export function pickOutputSchemaProvider(subagents: SubagentRuntimeLike | undefined): string | undefined {
  if (subagents === undefined) return undefined
  try {
    return listProviderNames(subagents)
      .find(name => subagents.getProvider?.(name)?.capabilities?.outputSchema === true)
  } catch {
    return undefined
  }
}
