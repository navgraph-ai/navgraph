// ─── NavGraph Types v1.0 ──────────────────────────────────────────────────────

export type ResolverType = 'api' | 'nav' | 'hybrid'
export type HttpMethod   = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface CapabilityParam {
  name:        string
  description: string
  required:    boolean
  source:      'user_query' | 'session' | 'context' | 'static'
  default?:    string | number | boolean
}

export interface ApiResolver {
  type: 'api'
  endpoints: Array<{
    method:  HttpMethod
    path:    string
    params?: string[]
  }>
}

export interface NavResolver {
  type:        'nav'
  destination: string
  hint?:       string
}

export interface HybridResolver {
  type: 'hybrid'
  api:  Omit<ApiResolver, 'type'>
  nav:  Omit<NavResolver, 'type'>
}

export type Resolver = ApiResolver | NavResolver | HybridResolver

export interface PrivacyScope {
  level:       'public' | 'user_owned' | 'admin'
  note?:       string
  rate_limit?: string
}

export interface EnrichmentMeta {
  intent_labels:  string[]
  confidence:     number
  reasoning:      string
  enriched_at:    string
  enriched_by:    string
  human_approved: boolean
}

export interface Capability {
  id:           string
  name:         string
  description:  string
  examples?:    string[]
  params:       CapabilityParam[]
  returns:      string[]
  resolver:     Resolver
  privacy:      PrivacyScope
  enrichment?:  EnrichmentMeta
  source_hint?: string
}

export interface Manifest {
  version:      string
  app:          string
  generatedAt:  string
  capabilities: Capability[]
  enrichedAt?:  string
  contentHash?: string
}

export interface NavGraphConfig {
  app:          string
  baseUrl?:     string
  capabilities: Capability[]
  enrich?: {
    llm?:             (prompt: string) => Promise<string>
    skipIfConfident?: number
    requireApproval?: boolean
  }
}

export interface MatchResult {
  capability:      Capability | null
  confidence:      number
  intent:          'navigation' | 'retrieval' | 'hybrid' | 'out_of_scope'
  extractedParams: Record<string, string | null>
  reasoning:       string
  matchedBy:       'keyword' | 'llm' | 'enriched_keyword' | 'none'
}

export interface ResolveResult {
  success:      boolean
  resolverType: ResolverType | null
  apiCalls?:    Array<{ method: string; url: string; params: Record<string, unknown> }>
  navTarget?:   string
  error?:       string
  dryRun?:      boolean
}

export interface AskResult {
  match:      MatchResult
  resolution: ResolveResult
}

export interface CorpusEntry {
  id:            string
  app:           string
  capability_id: string
  query:         string
  intent:        MatchResult['intent']
  confidence:    number
  matched_by:    MatchResult['matchedBy']
  resolved:      boolean
  timestamp:     string
}

export interface DriftReport {
  previous_hash:    string
  current_hash:     string
  added:            string[]
  removed:          string[]
  modified:         string[]
  semantic_changes: Array<{
    id:       string
    summary:  string
    severity: 'low' | 'medium' | 'high'
  }>
  requires_reindex: boolean
}

export interface ValidationResult {
  valid:    boolean
  errors:   string[]
  warnings: string[]
}

export interface ResolveOptions {
  baseUrl?:    string
  authToken?:  string
  /**
   * Optional validator for admin-scoped capabilities.
   * If provided, called before resolving admin capabilities.
   * Should throw or return false if the token lacks admin privileges.
   * Without this, admin scope only checks that a token exists.
   */
  adminValidator?: (token: string) => boolean | Promise<boolean>
  fetch?:      typeof globalThis.fetch
  dryRun?:     boolean
}