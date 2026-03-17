// navgraph.config.js
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
