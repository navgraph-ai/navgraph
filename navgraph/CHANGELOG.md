# Changelog

## v1.0.1 — 2026-03-18

### Bug Fixes

- **`cap.params` null guard** — `extractParams` in `matcher.ts` now uses
  `cap.params ?? []` to prevent a crash when params is undefined at runtime.
  The type declares params as required but JavaScript callers can omit it.

- **HTTP error handling** — `resolveApi` in `resolver.ts` now checks
  `response.ok` on every fetch result. Previously a 404 or 500 from the
  upstream API was reported as `success: true`. Now it returns
  `success: false` with the HTTP status in the error message.

- **Enrichment mutation** — `enrichCapability` in `generator.ts` no longer
  mutates the shared `privacy` object via a shallow-spread reference.
  It now returns a new `privacy` object which the caller applies cleanly.

### Improvements

- **Scoring weight fix** — keyword scoring no longer double-counts examples
  when enrichment labels are absent. The 20% weight redistributes to
  description instead.

- **Content-aware manifest hash** — `hashCapabilities` now includes resolver
  type, privacy level, and description prefix in the hash, not just IDs.

- **LLM prompt trimming** — `matchWithLLM` now sends at most 2 examples and
  3 intent labels per capability to prevent prompt bloat at scale.

- **Sequential test runner** — test output no longer interleaves section
  headers with async results.

- **Corpus count performance** — `FileCorpusStorage.count()` now maintains
  an in-memory counter instead of reading the entire file on every call.

- **Admin validator option** — `ResolveOptions` now accepts an
  `adminValidator` callback for proper admin privilege checking.

### ⚠️ Breaking Change — `loadConfig()` is now async

`loadConfig()` now returns `Promise<NavGraphConfig>` instead of
`NavGraphConfig`. This was necessary to support projects using
`"type": "module"` in `package.json` (ESM), which is the default
in Next.js 14+, Vite, and modern Node projects.

**Before (v1.0.0 — no longer works):**
```typescript
const config   = loadConfig()
const manifest = generate(config)
```

**After (v1.0.1 — required):**
```typescript
const config   = await loadConfig()
const manifest = generate(config)
```

The CLI (`bin/navgraph.js`) is already updated.
If you call `loadConfig` directly in your own code, add `await`.
```

---

## Summary of Every Change
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILE                    ACTION        LINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
src/generator.ts        ADD           16 lines of JSDoc
                                      inserted above line 105
                                      (currently blank line 104)

bin/navgraph.js         NOTHING       already correct
                                      line 106: async function
                                      line 117: await loadConfig()
                                      verified, do not touch

src/index.ts            NOTHING       line 36 is a re-export,
                                      not a call — do not touch

CHANGELOG.md            CREATE NEW    new file at navgraph/
                                      documents breaking change
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total lines added:  ~50 (all documentation)
Total lines changed: 0
Total lines removed: 0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━