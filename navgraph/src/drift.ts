import * as crypto from 'crypto'
import type { Manifest, DriftReport, Capability } from './types'

function hashCapability(cap: Capability): string {
  const key = JSON.stringify({
    id:       cap.id,
    resolver: cap.resolver,
    params:   cap.params,
    returns:  cap.returns,
    privacy:  cap.privacy,
  })
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
}

export function detectDrift(previous: Manifest, current: Manifest): DriftReport {
  const prevMap = new Map(previous.capabilities.map(c => [c.id, c]))
  const currMap = new Map(current.capabilities.map(c => [c.id, c]))

  const added   = current.capabilities.filter(c => !prevMap.has(c.id)).map(c => c.id)
  const removed = previous.capabilities.filter(c => !currMap.has(c.id)).map(c => c.id)

  const modified: string[] = []
  const semantic_changes: DriftReport['semantic_changes'] = []

  for (const [id, currCap] of currMap.entries()) {
    const prevCap = prevMap.get(id)
    if (!prevCap) continue

    const prevHash = hashCapability(prevCap)
    const currHash = hashCapability(currCap)

    if (prevHash !== currHash) {
      modified.push(id)

      if (prevCap.resolver.type !== currCap.resolver.type) {
        semantic_changes.push({
          id,
          summary:  `Resolver type changed from ${prevCap.resolver.type} to ${currCap.resolver.type}`,
          severity: 'high',
        })
      } else if (prevCap.privacy.level !== currCap.privacy.level) {
        semantic_changes.push({
          id,
          summary:  `Privacy level changed from ${prevCap.privacy.level} to ${currCap.privacy.level}`,
          severity: 'high',
        })
      } else if (JSON.stringify(prevCap.params) !== JSON.stringify(currCap.params)) {
        semantic_changes.push({ id, summary: 'Params changed', severity: 'medium' })
      } else {
        semantic_changes.push({ id, summary: 'Minor changes (description, examples, etc.)', severity: 'low' })
      }
    }
  }

  const requires_reindex = added.length > 0 || removed.length > 0 || modified.length > 0

  return {
    previous_hash: previous.contentHash ?? '',
    current_hash:  current.contentHash ?? '',
    added,
    removed,
    modified,
    semantic_changes,
    requires_reindex,
  }
}

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = []
  lines.push('NavGraph Drift Report')
  lines.push('─────────────────────')
  lines.push(`Previous hash:    ${report.previous_hash}`)
  lines.push(`Current hash:     ${report.current_hash}`)
  lines.push(`Requires reindex: ${report.requires_reindex}`)
  lines.push('')

  if (report.added.length > 0) {
    lines.push(`Added (${report.added.length}):`)
    for (const id of report.added) lines.push(`  + ${id}`)
  }
  if (report.removed.length > 0) {
    lines.push(`Removed (${report.removed.length}):`)
    for (const id of report.removed) lines.push(`  - ${id}`)
  }
  if (report.modified.length > 0) {
    lines.push(`Modified (${report.modified.length}):`)
    for (const id of report.modified) lines.push(`  ~ ${id}`)
  }
  if (report.semantic_changes.length > 0) {
    lines.push('')
    lines.push('Semantic Changes:')
    for (const c of report.semantic_changes) {
      lines.push(`  [${c.severity.toUpperCase()}] ${c.id}: ${c.summary}`)
    }
  }

  return lines.join('\n')
}
