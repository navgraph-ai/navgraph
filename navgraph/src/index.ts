// ─── NavGraph Public API ──────────────────────────────────────────────────────
// The single entry point. Import everything from here.
//
// Core flow:
//   1. Define capabilities in navgraph.config.js
//   2. npx navgraph generate  → navgraph.manifest.json
//   3. npx navgraph enrich    → adds AI intent labels (optional but recommended)
//   4. import { ask } from 'navgraph' and ship
//
// Quick start:
//   const { match, resolution } = await ask("show my orders", manifest, {
//     baseUrl:   'https://api.myapp.com',
//     authToken: req.headers.authorization,
//   })

// ─── Type Exports ─────────────────────────────────────────────────────────────

export type {
  Capability,
  CapabilityParam,
  NavGraphConfig,
  Manifest,
  MatchResult,
  ResolveResult,
  AskResult,
  ValidationResult,
  DriftReport,
  CorpusEntry,
  EnrichmentMeta,
  Resolver,
  ApiResolver,
  NavResolver,
  HybridResolver,
  PrivacyScope,
  ResolverType,
  HttpMethod,
} from './types'

// ─── Generator Exports ────────────────────────────────────────────────────────

export {
  generate,
  enrich,
  loadConfig,
  writeManifest,
  readManifest,
  validate,
  generateStarterConfig,
} from './generator'

// ─── Matcher Exports ──────────────────────────────────────────────────────────

export {
  match,
  matchWithLLM,
  matchCascade,
} from './matcher'

export type { LLMMatcherOptions } from './matcher'

// ─── Resolver Exports ─────────────────────────────────────────────────────────

export { resolve } from './resolver'
export type { ResolveOptions } from './types'

// ─── Drift Exports ────────────────────────────────────────────────────────────

export { detectDrift, formatDriftReport } from './drift'

// ─── Corpus Exports ───────────────────────────────────────────────────────────

export {
  CorpusLogger,
  FileCorpusStorage,
  MemoryCorpusStorage,
} from './corpus'

export type { CorpusStorage } from './corpus'

// ─── ask() — The main convenience function ───────────────────────────────────
// Match + resolve in one call. This is the function most consuming code
// should use. It runs the three-tier cascade matcher then resolves.

import { matchCascade }        from './matcher'
import { resolve as _resolve } from './resolver'
import type { Manifest, AskResult } from './types'
import type { LLMMatcherOptions }   from './matcher'
import type { ResolveOptions }      from './types'

export interface AskOptions extends ResolveOptions {
  /** Optional LLM function. If omitted, only keyword matching is used. */
  llm?: LLMMatcherOptions['llm']
}

/**
 * ask() — Match a user query to a capability and resolve it in one call.
 *
 * @example
 * // Simple — keyword matching only
 * const result = await ask("show my orders", manifest, {
 *   baseUrl: 'https://api.myapp.com',
 * })
 *
 * @example
 * // With LLM fallback for ambiguous queries
 * const result = await ask("I want to see what I bought", manifest, {
 *   baseUrl:   'https://api.myapp.com',
 *   authToken: req.headers.authorization,
 *   llm: async (prompt) => {
 *     const res = await anthropic.messages.create({
 *       model:      'claude-sonnet-4-20250514',
 *       max_tokens: 500,
 *       messages:   [{ role: 'user', content: prompt }],
 *     })
 *     return res.content[0].text
 *   },
 * })
 *
 * @example
 * // Dry run — see what would be called without executing
 * const result = await ask("book the cheapest ticket", manifest, {
 *   baseUrl: 'https://api.myapp.com',
 *   dryRun:  true,
 * })
 * console.log(result.resolution.apiCalls) // [{ method: 'GET', url: '...' }]
 */
export async function ask(
  query:   string,
  manifest: Manifest,
  options: AskOptions = {}
): Promise<AskResult> {
  const { llm, ...resolveOptions } = options

  const matchResult = await matchCascade(query, manifest, llm)

  const resolution = await _resolve(
    matchResult,
    matchResult.extractedParams as Record<string, unknown>,
    resolveOptions
  )

  return { match: matchResult, resolution }
}