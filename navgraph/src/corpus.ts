import * as fs     from 'fs'
import * as path   from 'path'
import * as crypto from 'crypto'
import type { CorpusEntry, MatchResult } from './types'

export interface CorpusStorage {
  append: (entry: CorpusEntry) => void
  query:  (filter?: Partial<CorpusEntry>) => CorpusEntry[]
  count:  () => number
}

export class FileCorpusStorage implements CorpusStorage {
  private filePath: string
  constructor(filePath = 'navgraph.corpus.jsonl') {
    this.filePath = path.resolve(process.cwd(), filePath)
  }
  append(entry: CorpusEntry): void {
    fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')
  }
  query(filter?: Partial<CorpusEntry>): CorpusEntry[] {
    if (!fs.existsSync(this.filePath)) return []
    const all = fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l) as CorpusEntry } catch { return null } })
      .filter(Boolean) as CorpusEntry[]
    if (!filter) return all
    return all.filter(e => Object.entries(filter).every(([k, v]) => e[k as keyof CorpusEntry] === v))
  }
  count(): number {
    if (!fs.existsSync(this.filePath)) return 0
    return fs.readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean).length
  }
}

export class MemoryCorpusStorage implements CorpusStorage {
  private entries: CorpusEntry[] = []
  append(entry: CorpusEntry): void { this.entries.push(entry) }
  query(filter?: Partial<CorpusEntry>): CorpusEntry[] {
    if (!filter) return [...this.entries]
    return this.entries.filter(e => Object.entries(filter).every(([k, v]) => e[k as keyof CorpusEntry] === v))
  }
  count(): number { return this.entries.length }
}

export class CorpusLogger {
  constructor(private app: string, private storage: CorpusStorage) {}

  log(query: string, result: MatchResult, resolved: boolean): CorpusEntry {
    const entry: CorpusEntry = {
      id:            crypto.randomUUID(),
      app:           this.app,
      capability_id: result.capability?.id ?? 'out_of_scope',
      query:         query.trim().toLowerCase(),
      intent:        result.intent,
      confidence:    result.confidence,
      matched_by:    result.matchedBy,
      resolved,
      timestamp:     new Date().toISOString(),
    }
    this.storage.append(entry)
    return entry
  }

  getUnmatched(): CorpusEntry[] {
    return this.storage.query({ capability_id: 'out_of_scope' })
  }

  getTopUnmatchedPatterns(limit = 10): Array<{ query: string; count: number }> {
    const freq = new Map<string, number>()
    for (const e of this.getUnmatched()) freq.set(e.query, (freq.get(e.query) ?? 0) + 1)
    return Array.from(freq.entries()).sort(([, a], [, b]) => b - a).slice(0, limit).map(([query, count]) => ({ query, count }))
  }

  getCapabilityStats(): Array<{ capability_id: string; count: number; avg_confidence: number; llm_fallback_rate: number }> {
    const all    = this.storage.query()
    const byId   = new Map<string, CorpusEntry[]>()
    for (const e of all) { const arr = byId.get(e.capability_id) ?? []; arr.push(e); byId.set(e.capability_id, arr) }
    return Array.from(byId.entries()).map(([capability_id, entries]) => ({
      capability_id,
      count:             entries.length,
      avg_confidence:    Math.round(entries.reduce((s, e) => s + e.confidence, 0) / entries.length),
      llm_fallback_rate: Math.round(entries.filter(e => e.matched_by === 'llm').length / entries.length * 100),
    }))
  }

  count(): number { return this.storage.count() }
}