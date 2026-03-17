// navgraph.config.js — Conduit (RealWorld) Blogging App
// Run: navgraph generate && navgraph validate

module.exports = {
  app:     'conduit',
  baseUrl: 'https://conduit.productionready.io/api',
  capabilities: [
    {
      id:          'get_global_articles',
      name:        'Get global articles',
      description: 'Fetch a list of all articles from the global feed, with optional tag, author, or pagination filters.',
      examples:    ['Show me the latest articles', 'Get all articles', 'What articles are available?', 'Show articles by tag javascript', 'List recent posts'],
      params: [
        { name: 'tag',    description: 'Filter by tag',     required: false, source: 'user_query' },
        { name: 'author', description: 'Filter by author',  required: false, source: 'user_query' },
        { name: 'limit',  description: 'Number of results', required: false, source: 'static', default: 10 },
        { name: 'offset', description: 'Pagination offset', required: false, source: 'static', default: 0 },
      ],
      returns:  ['articles', 'articlesCount'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/articles' }] },
      privacy:  { level: 'public', note: 'No auth required' },
    },
    {
      id:          'get_article_by_slug',
      name:        'Get article by slug',
      description: 'Fetch a single article by its slug identifier, including full body, tags, and author info.',
      examples:    ['Show me the article how-to-train-your-dragon', 'Get article with slug my-first-post', 'Fetch article introduction-to-react'],
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
      examples:    ['What tags are available?', 'Show me popular tags', 'List all tags', 'What topics exist?'],
      params:   [],
      returns:  ['tags'],
      resolver: { type: 'api', endpoints: [{ method: 'GET', path: '/tags' }] },
      privacy:  { level: 'public' },
    },
    {
      id:          'get_personal_feed',
      name:        'Get my personal feed',
      description: 'Fetch articles from authors the current authenticated user follows.',
      examples:    ['Show my personal feed', 'Articles from people I follow', 'My feed', 'Show followed authors articles'],
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
      examples:    ['Take me to the article how-to-train-your-dragon', 'Open article my-first-post', 'Go to article page for introduction-to-react'],
      params: [
        { name: 'slug', description: 'The article slug', required: true, source: 'user_query' },
      ],
      returns:  ['deep_link'],
      resolver: { type: 'nav', destination: '/#/article/{slug}' },
      privacy:  { level: 'public' },
    },
  ],
}
