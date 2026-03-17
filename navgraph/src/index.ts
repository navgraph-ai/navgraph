export { generate, enrich, validate, loadConfig, writeManifest, readManifest, generateStarterConfig } from './generator'
export { match, matchWithLLM, matchCascade } from './matcher'
export type { LLMMatcherOptions } from './matcher'
export { resolve } from './resolver'
export type { ResolveOptions } from './resolver'
export { detectDrift, formatDriftReport } from './drift'
export { CorpusLogger, MemoryCorpusStorage, FileCorpusStorage } from './corpus'
export type { CorpusStorage } from './corpus'

import type { Manifest, AskResult } from './types'
import { match } from './matcher'
import { resolve } from './resolver'
import type { ResolveOptions } from './resolver'

export async function ask(
  query:    string,
  manifest: Manifest,
  options:  ResolveOptions & { params?: Record<string, unknown> } = {}
): Promise<AskResult> {
  const matchResult = match(query, manifest)
  const resolution  = await resolve(matchResult, options.params ?? {}, options)
  return { match: matchResult, resolution }
}
