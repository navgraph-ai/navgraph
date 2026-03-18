import * as fs     from 'fs'
import * as path   from 'path'
import * as crypto from 'crypto'
import type {
  NavGraphConfig, Manifest, Capability,
  EnrichmentMeta, ValidationResult, PrivacyScope,
} from './types'

export function generate(config: NavGraphConfig): Manifest {
  const capabilities = config.capabilities
  return {
    version:     '1.0.0',
    app:         config.app,
    generatedAt: new Date().toISOString(),
    capabilities,
    contentHash: hashCapabilities(capabilities),
  }
}

export async function enrich(
  manifest: Manifest,
  llm: (prompt: string) => Promise<string>,
  options: { skipIfConfident?: number; model?: string; verbose?: boolean } = {}
): Promise<Manifest> {
  const { skipIfConfident = 85, model = 'navgraph-enricher', verbose = false } = options
  const enriched: Capability[] = []

  for (const cap of manifest.capabilities) {
    if (cap.enrichment && cap.enrichment.confidence >= skipIfConfident) {
      if (verbose) console.log(`[navgraph] skip "${cap.id}" (confidence ${cap.enrichment.confidence})`)
      enriched.push(cap)
      continue
    }
    if (verbose) console.log(`[navgraph] enriching "${cap.id}"...`)
    try {
      const { meta, privacy } = await enrichCapability(cap, llm, model)
      enriched.push({ ...cap, privacy, enrichment: meta })
    } catch (err) {
      console.warn(`[navgraph] enrichment failed for "${cap.id}":`, err)
      enriched.push(cap)
    }
  }

  return { ...manifest, capabilities: enriched, enrichedAt: new Date().toISOString() }
}

async function enrichCapability(
  cap: Capability,
  llm: (prompt: string) => Promise<string>,
  model: string
): Promise<{ meta: EnrichmentMeta; privacy: PrivacyScope }> {
  const prompt = `You are a capability enrichment engine for NavGraph.

Capability:
  id:          ${cap.id}
  name:        ${cap.name}
  description: ${cap.description}
  examples:    ${(cap.examples ?? []).join(' | ') || 'none'}
  resolver:    ${cap.resolver.type}
  privacy:     ${cap.privacy.level}

Generate 5 alternative phrasings a user might use to trigger this capability.

Respond ONLY in valid JSON:
{
  "intent_labels": ["phrase 1", "phrase 2", "phrase 3", "phrase 4", "phrase 5"],
  "confidence": <50-100>,
  "reasoning": "<one sentence>",
  "rate_limit_detected": null
}`

  const raw    = await llm(prompt)
  const clean  = raw.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean)

  const privacy: PrivacyScope = parsed.rate_limit_detected
    ? { ...cap.privacy, rate_limit: parsed.rate_limit_detected }
    : cap.privacy

  const meta: EnrichmentMeta = {
    intent_labels:  parsed.intent_labels  ?? [],
    confidence:     parsed.confidence     ?? 70,
    reasoning:      parsed.reasoning      ?? '',
    enriched_at:    new Date().toISOString(),
    enriched_by:    model,
    human_approved: false,
  }

  return { meta, privacy }
}

function hashCapabilities(capabilities: Capability[]): string {
  const content = capabilities
    .map(c => [
      c.id,
      c.resolver.type,
      c.privacy.level,
      c.description.slice(0, 64),
    ].join(':'))
    .sort()
    .join('|')
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}
/**
 * Load the navgraph config file from disk.
 *
 * Searches for navgraph.config.js, navgraph.config.json, or capman.config.js
 * in the current working directory, or at the explicitly provided path.
 *
 * ⚠️  ASYNC — this function returns a Promise. Always await it:
 *
 *   const config = await loadConfig()
 *   const manifest = generate(config)
 *
 * This changed from synchronous in v1.0.0 to async in v1.0.1 to support
 * ESM projects (type: "module" in package.json). Any caller that does not
 * await this will receive a Promise object instead of a NavGraphConfig,
 * causing generate() to fail silently with wrong types.
 */
export async function loadConfig(configPath?: string): Promise<NavGraphConfig> {
  const candidates = configPath
    ? [configPath]
    : ['navgraph.config.js', 'navgraph.config.json', 'capman.config.js']

  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (!fs.existsSync(resolved)) continue

    if (candidate.endsWith('.json')) {
      const mod = require(resolved)
      return mod.default ?? mod
    }

    try {
      const mod = await import(resolved)
      return mod.default ?? mod
    } catch {
      const mod = require(resolved)
      return mod.default ?? mod
    }
  }
  throw new Error('No config file found. Run: npx navgraph init')
}

export function writeManifest(manifest: Manifest, outputPath = 'navgraph.manifest.json'): string {
  const resolved = path.resolve(process.cwd(), outputPath)
  fs.writeFileSync(resolved, JSON.stringify(manifest, null, 2))
  return resolved
}

export function readManifest(manifestPath = 'navgraph.manifest.json'): Manifest {
  const candidates = [manifestPath, 'manifest.json']
  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate)
    if (fs.existsSync(resolved)) {
      return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as Manifest
    }
  }
  throw new Error('No manifest found. Run: npx navgraph generate')
}

export function validate(manifest: Manifest): ValidationResult {
  const errors:   string[] = []
  const warnings: string[] = []
  const ids = new Set<string>()

  if (!manifest.app?.trim())
    errors.push('manifest.app is required')

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0)
    errors.push('manifest.capabilities must be a non-empty array')

  for (const cap of manifest.capabilities ?? []) {
    if (!cap.id)   errors.push('A capability is missing an "id"')
    if (!cap.name) errors.push(`Capability "${cap.id}" is missing a "name"`)
    if (!cap.description || cap.description.length < 10)
      errors.push(`Capability "${cap.id}" needs a longer description (min 10 chars)`)
    if (!cap.resolver) errors.push(`Capability "${cap.id}" is missing a "resolver"`)
    if (!cap.privacy)  errors.push(`Capability "${cap.id}" is missing a "privacy" scope`)

    if (ids.has(cap.id)) errors.push(`Duplicate capability id: "${cap.id}"`)
    ids.add(cap.id)

    if (!cap.examples?.length)
      warnings.push(`"${cap.id}" has no examples — add 3–5 natural phrases to improve matching`)
    else if (cap.examples.length < 3)
      warnings.push(`"${cap.id}" has only ${cap.examples.length} example(s) — 3–5 is recommended`)

    if (cap.resolver?.type === 'api' && !cap.resolver.endpoints?.length)
      errors.push(`"${cap.id}" api resolver has no endpoints`)
    if (cap.resolver?.type === 'nav' && !cap.resolver.destination)
      errors.push(`"${cap.id}" nav resolver has no destination`)
    if (cap.resolver?.type === 'hybrid') {
      if (!cap.resolver.api?.endpoints?.length)
        errors.push(`"${cap.id}" hybrid resolver missing api.endpoints`)
      if (!cap.resolver.nav?.destination)
        errors.push(`"${cap.id}" hybrid resolver missing nav.destination`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

export function generateStarterConfig(): string {
  return `// navgraph.config.js
module.exports = {
  app: 'your-app-name',
  baseUrl: 'https://api.your-app.com',
  capabilities: [
    {
      id: 'get_resource',
      name: 'Get a resource',
      description: 'Fetch a specific resource by name or ID.',
      examples: ['Show me the resource details', 'Find resource by ID', 'Look up resource by name'],
      params: [{ name: 'resource_id', description: 'Resource ID', required: true, source: 'user_query' }],
      returns: ['resource'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/resources/{resource_id}' }] },
      privacy: { level: 'public' },
    },
  ],
}
`
}
