// ─── NavGraph Test Suite ──────────────────────────────────────────────────────
// Full integration test using the Conduit (RealWorld) blogging app.
// Tests keyword matcher, LLM cascade, resolver (dry-run), drift detection,
// and corpus logging — all against a real manifest.
//
// Run with: npx ts-node test/test-navgraph.ts
// Run with LLM: ANTHROPIC_API_KEY=sk-... npx ts-node test/test-navgraph.ts --llm

import {
  generate,
  match,
  matchCascade,
  resolve,
  ask,
  validate,
  detectDrift,
  formatDriftReport,
  CorpusLogger,
  MemoryCorpusStorage,
} from '../src/index'

import type { NavGraphConfig, Manifest } from '../src/types'

// ─── Conduit Config ───────────────────────────────────────────────────────────
// Same real-world app Marcus used for testing.
// Fully typed and enriched with examples.

const conduitConfig: NavGraphConfig = {
  app:     'conduit',
  baseUrl: 'https://conduit.productionready.io/api',
  capabilities: [
    {
      id:          'get_global_articles',
      name:        'Get global articles',
      description: 'Fetch a list of all articles from the global feed, with optional tag, author, or pagination filters.',
      examples:    ['Show me the latest articles', 'Get all articles', 'What articles are available?', 'Show articles by tag javascript', 'List recent posts'],
      params: [
        { name: 'tag',    description: 'Filter by tag',       required: false, source: 'user_query' },
        { name: 'author', description: 'Filter by author',    required: false, source: 'user_query' },
        { name: 'limit',  description: 'Number of results',   required: false, source: 'static', default: 10 },
        { name: 'offset', description: 'Pagination offset',   required: false, source: 'static', default: 0 },
      ],
      returns:  ['articles', 'articlesCount'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
      privacy:  { level: 'public', note: 'No auth required' },
    },
    {
      id:          'get_article_by_slug',
      name:        'Get article by slug',
      description: 'Fetch a single article by its slug identifier, including full body, tags, and author info.',
      examples:    ['Show me the article how-to-train-your-dragon', 'Get article with slug my-first-post', 'Fetch article introduction-to-react', 'Read article build-a-rest-api'],
      params: [
        { name: 'slug', description: 'The article slug', required: true, source: 'user_query' },
      ],
      returns:  ['article', 'author', 'tags', 'body'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles/{slug}' }] },
      privacy:  { level: 'public' },
    },
    {
      id:          'get_tags',
      name:        'Get popular tags',
      description: 'Fetch the list of all popular tags used across articles on the platform.',
      examples:    ['What tags are available?', 'Show me popular tags', 'List all tags', 'What topics exist?', 'Get all categories'],
      params:   [],
      returns:  ['tags'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/tags' }] },
      privacy:  { level: 'public' },
    },
    {
      id:          'get_user_profile',
      name:        'Get user profile',
      description: 'Fetch the public profile of a user by their username, including bio and follower info.',
      examples:    ['Show me the profile for johndoe', 'Get user profile for jane', 'Who is the user techwriter42?', 'Show profile information for username sam'],
      params: [
        { name: 'username', description: 'The username to look up', required: true, source: 'user_query' },
      ],
      returns:  ['profile', 'bio', 'following', 'image'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/profiles/{username}' }] },
      privacy:  { level: 'public' },
    },
    {
      id:          'get_personal_feed',
      name:        'Get my personal feed',
      description: 'Fetch articles from authors the current authenticated user follows.',
      examples:    ['Show my personal feed', 'Articles from people I follow', 'My feed', 'What have the people I follow posted?', 'Show followed authors articles'],
      params: [
        { name: 'limit',  description: 'Number of results', required: false, source: 'static', default: 10 },
        { name: 'offset', description: 'Pagination offset', required: false, source: 'static', default: 0 },
      ],
      returns:  ['articles', 'articlesCount'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles/feed' }] },
      privacy:  { level: 'user_owned', note: 'Requires JWT auth token' },
    },
    {
      id:          'navigate_to_article',
      name:        'Navigate to article page',
      description: 'Route the user to the article detail page for a specific article slug.',
      examples:    ['Take me to the article how-to-train-your-dragon', 'Open article my-first-post', 'Go to article page for introduction-to-react', 'Navigate to the article build-a-rest-api'],
      params: [
        { name: 'slug', description: 'The article slug', required: true, source: 'user_query' },
      ],
      returns:  ['deep_link'],
      resolver: { type: 'nav', destination: '/#/article/{slug}' },
      privacy:  { level: 'public' },
    },
    {
      id:          'navigate_to_profile',
      name:        'Navigate to profile page',
      description: 'Route the user to the public profile page of a specific username.',
      examples:    ['Take me to the profile page for johndoe', 'Open profile of jane', 'Go to user page for techwriter42', 'Navigate to profile sam'],
      params: [
        { name: 'username', description: 'The username', required: true, source: 'user_query' },
      ],
      returns:  ['deep_link'],
      resolver: { type: 'nav', destination: '/#/profile/{username}' },
      privacy:  { level: 'public' },
    },
    {
      id:          'get_article_with_comments',
      name:        'Get article with comments',
      description: 'Fetch an article and its comments together, then navigate to the article page to view them.',
      examples:    ['Show me the article and comments for how-to-train-your-dragon', 'Read article my-first-post with its comments', 'Open article introduction-to-react and show comments', 'Show discussion on article build-a-rest-api'],
      params: [
        { name: 'slug', description: 'The article slug', required: true, source: 'user_query' },
      ],
      returns:  ['article', 'comments', 'deep_link'],
      resolver: {
        type: 'hybrid',
        api:  { endpoints: [{ method: 'GET', path: '/articles/{slug}' }, { method: 'GET', path: '/articles/{slug}/comments' }] },
        nav:  { destination: '/#/article/{slug}' },
      },
      privacy: { level: 'public' },
    },
  ],
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

const pass:  string[] = []
const fail:  string[] = []
const skip:  string[] = []

type TestCase = { name: string; fn: () => void | Promise<void>; section?: string }
const tests: TestCase[] = []
let pendingSection: string | undefined

function section(name: string): void {
  pendingSection = name
}

function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn, section: pendingSection })
  pendingSection = undefined
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

async function runTests(): Promise<void> {
  for (const { name, fn, section } of tests) {
    if (section) console.log(`\n  ── ${section} ${'─'.repeat(46 - section.length)}\n`)
    try {
      await fn()
      console.log(`  \x1b[32m✓\x1b[0m  ${name}`)
      pass.push(name)
    } catch (err: any) {
      console.log(`  \x1b[31m✗\x1b[0m  ${name}`)
      console.log(`     \x1b[31m${err.message}\x1b[0m`)
      fail.push(name)
    }
  }
}

// ─── Section: Validation ──────────────────────────────────────────────────────

section('Validation')

test('manifest validates without errors', () => {
  const manifest = generate(conduitConfig)
  const result   = validate(manifest)
  assert(result.valid, `Validation failed: ${result.errors.join(', ')}`)
})

test('manifest has correct capability count', () => {
  const manifest = generate(conduitConfig)
  assert(manifest.capabilities.length === 8, `Expected 8 capabilities, got ${manifest.capabilities.length}`)
})

test('manifest has content hash', () => {
  const manifest = generate(conduitConfig)
  assert(!!manifest.contentHash, 'Expected contentHash to be set')
  assert(manifest.contentHash!.length === 16, `Expected 16-char hash, got ${manifest.contentHash!.length}`)
})

test('invalid manifest fails validation', () => {
  const bad = generate({ app: '', baseUrl: '', capabilities: [] })
  const result = validate(bad)
  assert(!result.valid, 'Empty manifest should fail validation')
  assert(result.errors.length > 0, 'Should have at least one error')
})

// ─── Section: Keyword Matching ────────────────────────────────────────────────

section('Keyword Matcher')

const manifest = generate(conduitConfig)

const shouldMatch: Array<[string, string]> = [
  ['Show me the latest articles',              'get_global_articles'],
  ['What tags are popular?',                   'get_tags'],
  ['Get profile for johndoe',                  'get_user_profile'],
  ['My personal feed',                         'get_personal_feed'],
  ['Take me to article how-to-train-dragon',   'navigate_to_article'],
  ['Show article and comments for react-post', 'get_article_with_comments'],
  ['List all tags',                            'get_tags'],
  ['Show followed authors articles',           'get_personal_feed'],
]

for (const [query, expectedId] of shouldMatch) {
  test(`"${query}" → ${expectedId}`, () => {
    const result = match(query, manifest)
    assert(
      result.capability?.id === expectedId,
      `Expected "${expectedId}", got "${result.capability?.id ?? 'OUT_OF_SCOPE'}" (confidence: ${result.confidence}%)`
    )
  })
}

const shouldBeOOS = [
  'Is the server down?',
  'Delete my account',
  'What is the weather today?',
  'Send an email to john',
]

for (const query of shouldBeOOS) {
  test(`"${query}" → OUT_OF_SCOPE`, () => {
    const result = match(query, manifest)
    assert(
      result.capability === null,
      `Expected OUT_OF_SCOPE but got "${result.capability?.id}" (confidence: ${result.confidence}%)`
    )
    assert(result.intent === 'out_of_scope', `Expected intent out_of_scope, got ${result.intent}`)
  })
}

test('empty query returns out_of_scope', () => {
  const r = match('', manifest)
  assert(r.capability === null, 'Empty query should be out_of_scope')
  assert(r.confidence === 0, 'Empty query should have 0 confidence')
})

test('matched result has correct matchedBy field', () => {
  const r = match('Show me the latest articles', manifest)
  assert(r.matchedBy === 'keyword', `Expected 'keyword', got '${r.matchedBy}'`)
})

// ─── Section: Resolver ────────────────────────────────────────────────────────

section('Resolver')

test('API capability resolves in dry-run', async () => {
  const matchResult = match('Show me the latest articles', manifest)
  const result = await resolve(matchResult, {}, { baseUrl: 'https://api.conduit.io', dryRun: true })
  assert(result.success, `Expected success, got: ${result.error}`)
  assert(result.resolverType === 'api', `Expected api, got ${result.resolverType}`)
  assert(result.apiCalls!.length > 0, 'Expected at least one API call')
  assert(result.apiCalls![0].url.includes('/articles'), `Unexpected URL: ${result.apiCalls![0].url}`)
  assert(result.dryRun === true, 'Expected dryRun flag to be true')
})

test('Nav capability resolves correctly', async () => {
  const matchResult = match('Take me to article how-to-train-dragon', manifest)
  const result = await resolve(matchResult, { slug: 'how-to-train-your-dragon' }, { dryRun: true })
  assert(result.success, `Expected success`)
  assert(result.resolverType === 'nav', `Expected nav, got ${result.resolverType}`)
  assert(result.navTarget?.includes('how-to-train-your-dragon') === true, `Unexpected navTarget: ${result.navTarget}`)
})

test('Hybrid capability resolves both API and nav', async () => {
  const matchResult = match('Show article and comments for react-post', manifest)
  const result = await resolve(matchResult, { slug: 'intro-to-react' }, { baseUrl: 'https://api.conduit.io', dryRun: true })
  assert(result.success, `Expected success`)
  assert(result.resolverType === 'hybrid', `Expected hybrid, got ${result.resolverType}`)
  assert(result.apiCalls!.length === 2, `Expected 2 API calls, got ${result.apiCalls!.length}`)
  assert(!!result.navTarget, `Expected navTarget to be set`)
})

test('unmatched query resolves to clean failure', async () => {
  const matchResult = match('Is the server down?', manifest)
  const result = await resolve(matchResult, {}, { dryRun: true })
  assert(!result.success, 'Unmatched should fail')
  assert(result.resolverType === null, 'resolverType should be null')
  assert(!!result.error, 'Should have an error message')
})

test('user_owned capability without auth token is rejected', async () => {
  const matchResult = match('My personal feed', manifest)
  // No authToken provided
  const result = await resolve(matchResult, {}, { baseUrl: 'https://api.conduit.io', dryRun: true })
  assert(!result.success, 'Should fail without auth token')
  assert(!!(result.error?.includes('user_owned') || result.error?.includes('authentication')), `Unexpected error: ${result.error}`)
})

test('user_owned capability with auth token succeeds', async () => {
  const matchResult = match('My personal feed', manifest)
  const result = await resolve(matchResult, {}, {
    baseUrl:   'https://api.conduit.io',
    authToken: 'test-token-123',
    dryRun:    true,
  })
  assert(result.success, `Expected success with auth token, got: ${result.error}`)
})

// ─── Section: ask() convenience ───────────────────────────────────────────────

section('ask() convenience')

test('ask() returns match + resolution in one call', async () => {
  const result = await ask('What tags are popular?', manifest, { dryRun: true })
  assert(result.match.capability?.id === 'get_tags', `Match: expected get_tags, got ${result.match.capability?.id}`)
  assert(result.resolution.success, 'Resolution should succeed')
})

test('ask() handles out_of_scope cleanly', async () => {
  const result = await ask('Send an email to john', manifest, { dryRun: true })
  assert(result.match.capability === null, 'Should be out_of_scope')
  assert(!result.resolution.success, 'Resolution should fail when no match')
})

// ─── Section: Drift Detection ─────────────────────────────────────────────────

section('Drift Detection')

test('no drift when manifests are identical', () => {
  const m1 = generate(conduitConfig)
  const m2 = generate(conduitConfig)
  const report = detectDrift(m1, m2)
  assert(!report.requires_reindex, 'Identical manifests should not require reindex')
  assert(report.added.length === 0, 'No capabilities should be added')
  assert(report.removed.length === 0, 'No capabilities should be removed')
})

test('drift detected when capability is added', () => {
  const m1 = generate(conduitConfig)
  const m2 = generate({
    ...conduitConfig,
    capabilities: [
      ...conduitConfig.capabilities,
      {
        id: 'new_capability', name: 'New', description: 'A brand new capability',
        examples: [], params: [], returns: [],
        resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/new' }] },
        privacy: { level: 'public' },
      },
    ],
  })
  const report = detectDrift(m1, m2)
  assert(report.added.includes('new_capability'), `Expected new_capability in added: ${report.added}`)
  assert(report.requires_reindex, 'Should require reindex')
})

test('drift detected when capability is removed', () => {
  const m1 = generate(conduitConfig)
  const m2 = generate({ ...conduitConfig, capabilities: conduitConfig.capabilities.slice(1) })
  const report = detectDrift(m1, m2)
  assert(report.removed.includes('get_global_articles'), `Expected get_global_articles in removed: ${report.removed}`)
})

test('drift detected when resolver type changes', () => {
  const modified = conduitConfig.capabilities.map(c =>
    c.id === 'get_tags'
      ? { ...c, resolver: { type: 'nav' as const, destination: '/tags' } }
      : c
  )
  const m1 = generate(conduitConfig)
  const m2 = generate({ ...conduitConfig, capabilities: modified })
  const report = detectDrift(m1, m2)
  assert(report.modified.includes('get_tags'), `Expected get_tags in modified: ${report.modified}`)
  const highSeverity = report.semantic_changes.find(c => c.id === 'get_tags' && c.severity === 'high')
  assert(!!highSeverity, 'Resolver type change should be high severity')
})

test('formatDriftReport produces readable output', () => {
  const m1     = generate(conduitConfig)
  const m2     = generate({ ...conduitConfig, capabilities: conduitConfig.capabilities.slice(1) })
  const report = detectDrift(m1, m2)
  const text   = formatDriftReport(report)
  assert(text.includes('get_global_articles'), 'Report should mention the removed capability')
  assert(text.length > 50, 'Report should have meaningful content')
})

// ─── Section: Corpus ──────────────────────────────────────────────────────────

section('Corpus')

test('corpus logger records entries', () => {
  const storage = new MemoryCorpusStorage()
  const logger  = new CorpusLogger('conduit', storage)
  const result  = match('Show me the latest articles', manifest)
  logger.log('Show me the latest articles', result, true)
  assert(storage.count() === 1, `Expected 1 entry, got ${storage.count()}`)
})

test('corpus logger tracks unmatched queries', () => {
  const storage = new MemoryCorpusStorage()
  const logger  = new CorpusLogger('conduit', storage)
  const r1 = match('Is the server down?', manifest)
  const r2 = match('Delete my account', manifest)
  const r3 = match('Show me articles', manifest)
  logger.log('Is the server down?', r1, false)
  logger.log('Delete my account', r2, false)
  logger.log('Show me articles', r3, true)
  const unmatched = logger.getUnmatched()
  assert(unmatched.length === 2, `Expected 2 unmatched, got ${unmatched.length}`)
})

test('corpus stats show correct capability counts', () => {
  const storage = new MemoryCorpusStorage()
  const logger  = new CorpusLogger('conduit', storage)
  for (let i = 0; i < 5; i++) {
    const r = match('Show me the latest articles', manifest)
    logger.log('Show me the latest articles', r, true)
  }
  const r2 = match('What tags are popular?', manifest)
  logger.log('What tags are popular?', r2, true)
  const stats = logger.getCapabilityStats()
  const articleStat = stats.find(s => s.capability_id === 'get_global_articles')
  assert(articleStat?.count === 5, `Expected 5 for get_global_articles, got ${articleStat?.count}`)
})

// ─── Summary ──────────────────────────────────────────────────────────────────

runTests().then(() => {
  console.log()
  console.log('  ─────────────────────────────────────────────────────────')
  console.log()
  const total = pass.length + fail.length
  if (fail.length === 0) {
    console.log(`  \x1b[32m✓ All ${total} tests passed\x1b[0m`)
  } else {
    console.log(`  \x1b[32m${pass.length} passed\x1b[0m  \x1b[31m${fail.length} failed\x1b[0m  (${total} total)`)
    if (fail.length > 0) {
      console.log()
      console.log('  Failed:')
      for (const f of fail) console.log(`    \x1b[31m✗ ${f}\x1b[0m`)
    }
  }
  console.log()
  process.exit(fail.length > 0 ? 1 : 0)
})