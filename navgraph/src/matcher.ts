import type { Capability, Manifest, MatchResult } from './types'

const KEYWORD_THRESHOLD = 45
const MIN_CONFIDENCE    = 25

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(w => w.length > 1)
}

function scoreCapability(query: string, cap: Capability): number {
  const qWords = tokenize(query)
  let score    = 0

  // Examples: 50%
  const examples = cap.examples ?? []
  if (examples.length > 0) {
    let best = 0
    for (const ex of examples) {
      const exWords = tokenize(ex)
      const overlap = exWords.filter(w => qWords.includes(w)).length
      best = Math.max(best, (overlap / exWords.length) * 100)
    }
    score += best * 0.50
  }

  // Intent labels from enrichment: 20%
  const labels = cap.enrichment?.intent_labels ?? []
  if (labels.length > 0) {
    let best = 0
    for (const label of labels) {
      const lWords  = tokenize(label)
      const overlap = lWords.filter(w => qWords.includes(w)).length
      best = Math.max(best, (overlap / lWords.length) * 100)
    }
    score += best * 0.20
  } else {
    // No enrichment — redistribute 20% back to examples
    if (examples.length > 0) {
      let best = 0
      for (const ex of examples) {
        const exWords = tokenize(ex)
        const overlap = exWords.filter(w => qWords.includes(w)).length
        best = Math.max(best, (overlap / exWords.length) * 100)
      }
      score += best * 0.20
    }
  }

  // Description: 20%
  const descWords   = tokenize(cap.description)
  const descOverlap = descWords.filter(w => qWords.includes(w)).length
  score += (descOverlap / Math.max(descWords.length, 1)) * 100 * 0.20

  // Name: 10%
  const nameWords   = tokenize(cap.name)
  const nameOverlap = nameWords.filter(w => qWords.includes(w)).length
  score += (nameOverlap / Math.max(nameWords.length, 1)) * 100 * 0.10

  return Math.min(Math.round(score), 100)
}

function resolverToIntent(cap: Capability): MatchResult['intent'] {
  const t = cap.resolver.type
  if (t === 'api')    return 'retrieval'
  if (t === 'nav')    return 'navigation'
  if (t === 'hybrid') return 'hybrid'
  return 'out_of_scope'
}

function extractParams(query: string, cap: Capability): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const param of cap.params ?? [] ) {
    if (param.source === 'session')  { result[param.name] = '[from_session]';  continue }
    if (param.source === 'context')  { result[param.name] = '[from_context]';  continue }
    if (param.source === 'static')   { result[param.name] = String(param.default ?? ''); continue }
    const q      = query.toLowerCase()
    const needle = param.name.toLowerCase().replace(/_/g, ' ')
    const idx    = q.indexOf(needle)
    if (idx !== -1) {
      const after = q.slice(idx + needle.length).trim()
      result[param.name] = after.split(/\s+/)[0] || null
    } else {
      const tokens = query.trim().split(/\s+/)
      result[param.name] = tokens[tokens.length - 1] || null
    }
  }
  return result
}

function outOfScope(confidence: number, reason: string): MatchResult {
  return { capability: null, confidence, intent: 'out_of_scope', extractedParams: {}, reasoning: reason, matchedBy: 'none' }
}

export function match(query: string, manifest: Manifest): MatchResult {
  if (!query?.trim()) return outOfScope(0, 'Empty query')

  let best: Capability | null = null
  let bestScore = 0

  for (const cap of manifest.capabilities) {
    const score = scoreCapability(query, cap)
    if (score > bestScore) { bestScore = score; best = cap }
  }

  if (!best || bestScore < KEYWORD_THRESHOLD) {
    return outOfScope(bestScore, `Best score ${bestScore}% below threshold ${KEYWORD_THRESHOLD}%`)
  }

  const isEnriched = !!best.enrichment?.intent_labels?.length
  return {
    capability:      best,
    confidence:      bestScore,
    intent:          resolverToIntent(best),
    extractedParams: extractParams(query, best),
    reasoning:       `Matched "${best.id}" via ${isEnriched ? 'enriched ' : ''}keyword scoring (${bestScore}%)`,
    matchedBy:       isEnriched ? 'enriched_keyword' : 'keyword',
  }
}

export interface LLMMatcherOptions {
  llm: (prompt: string) => Promise<string>
}

export async function matchWithLLM(
  query: string, manifest: Manifest, options: LLMMatcherOptions
): Promise<MatchResult> {
  const summary = manifest.capabilities.map(c => {
    const examples = c.examples?.slice(0, 2).join(', ') ?? ''
    const labels   = c.enrichment?.intent_labels?.slice(0, 3).join(', ') ?? ''
    return [
      `- ${c.id} (${c.resolver.type}, ${c.privacy.level})`,
      `  desc: ${c.description.slice(0, 100)}`,
      examples ? `  e.g.: ${examples}` : '',
      labels   ? `  also: ${labels}`   : '',
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const prompt = `You are an intent matcher for NavGraph.
App: ${manifest.app}
Capabilities:\n${summary}
User query: "${query}"
Be conservative — wrong match is worse than OUT_OF_SCOPE.
Respond ONLY in valid JSON:
{"matched_capability":"<id or OUT_OF_SCOPE>","confidence":<0-100>,"intent":"<navigation|retrieval|hybrid|out_of_scope>","reasoning":"<one sentence>","extracted_params":{}}`

  try {
    const raw    = await options.llm(prompt)
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    const isOOS  = parsed.matched_capability === 'OUT_OF_SCOPE'
    const capability = isOOS ? null : manifest.capabilities.find(c => c.id === parsed.matched_capability) ?? null
    const confidence: number = parsed.confidence ?? 0

    if (!capability || confidence < MIN_CONFIDENCE) {
      return outOfScope(confidence, parsed.reasoning ?? 'LLM found no confident match')
    }
    return { capability, confidence, intent: parsed.intent ?? resolverToIntent(capability), extractedParams: parsed.extracted_params ?? {}, reasoning: parsed.reasoning ?? '', matchedBy: 'llm' }
  } catch (err) {
    console.warn('[navgraph] LLM match failed, falling back to keyword:', err)
    return match(query, manifest)
  }
}

export async function matchCascade(
  query: string, manifest: Manifest, llm?: LLMMatcherOptions['llm']
): Promise<MatchResult> {
  const keywordResult = match(query, manifest)
  if (keywordResult.confidence >= KEYWORD_THRESHOLD || !llm) return keywordResult
  return matchWithLLM(query, manifest, { llm })
}