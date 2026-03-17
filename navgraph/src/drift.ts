// ─── NavGraph Drift Detector ──────────────────────────────────────────────────
// Compares two manifest versions and reports what changed.
//
// NavGraph-only feature — not in capman.
// Runs on every deployment. Produces a DriftReport that tells the team:
//   - Which capabilities were added, removed, or modified
//   - Whether changes are semantic (needs reindex) or structural
//   - Severity of each change
//
// The report is used by the CLI to decide whether to trigger re-enrichment
// and warn the operator if resolver mappings may be stale.

import type { Manifest, Capability, DriftReport } from './types'
import * as crypto from 'crypto'

// ─── Compare ──────────────────────────────────────────────────────────────────

export function detectDrift(previous: Manifest, current: Manifest): DriftReport {
  const prevMap = new Map(previous.capabilities.map(c => [c.id, c]))
  const currMap = new Map(current.capabilities.map(c => [c.id, c]))

  const added:    string[] = []
  const removed:  string[] = []
  const modified: string[] = []
  const semanticChanges: DriftReport['semantic_changes'] = []

  // Find added capabilities
  for (const id of currMap.keys()) {
    if (!prevMap.has(id)) {
      added.push(id)
      semanticChanges.push({
        id,
        summary:  `New capability "${id}" — must be enriched and indexed before it can be resolved`,
        severity: 'medium',
      })
    }
  }

  // Find removed capabilities
  for (const id of prevMap.keys()) {
    if (!currMap.has(id)) {
      removed.push(id)
      semanticChanges.push({
        id,
        summary:  `Capability "${id}" was removed — any active resolver mappings for this ID are now stale`,
        severity: 'high',
      })
    }
  }

  // Find modified capabilities
  for (const [id, curr] of currMap.entries()) {
    const prev = prevMap.get(id)
    if (!prev) continue   // already in added

    const changes = diffCapability(prev, curr)
    if (changes.length > 0) {
      modified.push(id)
      for (const change of changes) {
        semanticChanges.push({ id, ...change })
      }
    }
  }

  const requiresReindex =
    added.length > 0 ||
    removed.length > 0 ||
    modified.length > 0

  return {
    previous_hash:   previous.contentHash ?? hashManifest(previous),
    current_hash:    current.contentHash  ?? hashManifest(current),
    added,
    removed,
    modified,
    semantic_changes: semanticChanges,
    requires_reindex: requiresReindex,
  }
}

// ─── Capability Diff ──────────────────────────────────────────────────────────

function diffCapability(
  prev: Capability,
  curr: Capability
): Array<{ summary: string; severity: DriftReport['semantic_changes'][0]['severity'] }> {
  const changes: Array<{ summary: string; severity: DriftReport['semantic_changes'][0]['severity'] }> = []

  // Description changed
  if (prev.description !== curr.description) {
    changes.push({
      summary:  `Description changed — re-enrichment recommended to update intent labels`,
      severity: 'medium',
    })
  }

  // Resolver type changed — high severity
  if (prev.resolver.type !== curr.resolver.type) {
    changes.push({
      summary:  `Resolver type changed from "${prev.resolver.type}" to "${curr.resolver.type}" — existing resolver mappings are invalid`,
      severity: 'high',
    })
  }

  // API endpoints changed
  if (prev.resolver.type === 'api' && curr.resolver.type === 'api') {
    const prevEndpoints = JSON.stringify(prev.resolver.endpoints)
    const currEndpoints = JSON.stringify(curr.resolver.endpoints)
    if (prevEndpoints !== currEndpoints) {
      changes.push({
        summary:  `API endpoints changed — resolver will call updated paths on next resolution`,
        severity: 'high',
      })
    }
  }

  // Nav destination changed
  if (prev.resolver.type === 'nav' && curr.resolver.type === 'nav') {
    if (prev.resolver.destination !== curr.resolver.destination) {
      changes.push({
        summary:  `Nav destination changed from "${prev.resolver.destination}" to "${curr.resolver.destination}"`,
        severity: 'medium',
      })
    }
  }

  // Privacy level changed
  if (prev.privacy.level !== curr.privacy.level) {
    changes.push({
      summary:  `Privacy level changed from "${prev.privacy.level}" to "${curr.privacy.level}" — access control has changed`,
      severity: 'high',
    })
  }

  // Examples changed (affects matching quality)
  const prevExCount = prev.examples?.length ?? 0
  const currExCount = curr.examples?.length ?? 0
  if (prevExCount !== currExCount) {
    changes.push({
      summary:  `Examples count changed (${prevExCount} → ${currExCount}) — keyword matching scores will differ`,
      severity: 'low',
    })
  }

  // Params changed
  const prevParamNames = (prev.params ?? []).map(p => p.name).sort().join(',')
  const currParamNames = (curr.params ?? []).map(p => p.name).sort().join(',')
  if (prevParamNames !== currParamNames) {
    changes.push({
      summary:  `Params changed (${prevParamNames || 'none'} → ${currParamNames || 'none'}) — param extraction may fail`,
      severity: 'high',
    })
  }

  return changes
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashManifest(manifest: Manifest): string {
  const ids = manifest.capabilities.map(c => c.id).sort().join(',')
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16)
}

// ─── Format Report ────────────────────────────────────────────────────────────
// Pretty-prints a drift report for CLI output.

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = []
  lines.push(`Drift Report`)
  lines.push(`  prev: ${report.previous_hash}  →  curr: ${report.current_hash}`)
  lines.push('')

  if (!report.requires_reindex) {
    lines.push('  ✓ No significant changes detected. Index is current.')
    return lines.join('\n')
  }

  if (report.added.length > 0)
    lines.push(`  + Added:    ${report.added.join(', ')}`)
  if (report.removed.length > 0)
    lines.push(`  - Removed:  ${report.removed.join(', ')}`)
  if (report.modified.length > 0)
    lines.push(`  ~ Modified: ${report.modified.join(', ')}`)

  lines.push('')
  for (const change of report.semantic_changes) {
    const icon = change.severity === 'high' ? '⚠' : change.severity === 'medium' ? '~' : 'i'
    lines.push(`  ${icon} [${change.severity}] ${change.id}: ${change.summary}`)
  }

  if (report.requires_reindex) {
    lines.push('')
    lines.push('  → Re-index required. Run: npx navgraph generate --enrich')
  }

  return lines.join('\n')
}