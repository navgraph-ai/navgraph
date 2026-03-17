# NavGraph

> Give AI agents a map of your app — not the whole territory.

Instead of an AI assistant clicking through your entire application
to answer a simple question, NavGraph lets your app declare what it
can do. The AI reads the map and goes directly to the answer.

---

## The Problem

When an AI agent needs to answer *"are there seats for Friday?"*,
today it navigates your app like a tourist with no map:
```
AI clicks → Home → Explore → Events → Category → Availability
9 screens. User waits. Data exposed.
```

## The Solution

Your app publishes a **capability manifest** — a machine-readable
list of what it can do, what API to call, and what data each user
is allowed to see.
```
User query → match capability → resolve via API or nav → done
1 call. Instant. Private.
```

---

## Install
```bash
npm install navgraph
```

---

## Quick Start

**1. Create your config**
```bash
npx navgraph init
```

**2. Generate the manifest**
```bash
npx navgraph generate
```

**3. Use in your AI agent**
```typescript
import { ask, readManifest } from 'navgraph'

const manifest = readManifest()

const { match, resolution } = await ask(
  "Are there seats for Friday?",
  manifest,
  { baseUrl: 'https://api.yourapp.com' }
)

console.log(match.capability?.id)   // "check_seat_availability"
console.log(resolution.apiCalls)    // [{ method: 'GET', url: '...' }]
```

---

## How It Works
```
navgraph.config.js          →   npx navgraph generate
(you define capabilities)       (produces manifest.json)

manifest.json               →   ask("user query", manifest)
(map of your app)               (matches + resolves in one call)
```

---

## Capability Config
```javascript
// navgraph.config.js
module.exports = {
  app: 'my-app',
  baseUrl: 'https://api.my-app.com',
  capabilities: [
    {
      id: 'check_availability',
      name: 'Check seat availability',
      description: 'Check if seats are available for a show on a given date.',
      examples: [
        'Are there seats for Friday?',
        'Check availability for Saturday night',
        'Any tickets left for the weekend show?',
      ],
      params: [
        { name: 'date', description: 'The date to check', required: true, source: 'user_query' },
      ],
      returns: ['available_seats', 'price_range'],
      resolver: {
        type: 'api',
        endpoints: [{ method: 'GET', path: '/shows/availability?date={date}' }],
      },
      privacy: { level: 'public' },
    },
  ],
}
```

---

## CLI Commands

| Command | What it does |
|---|---|
| `npx navgraph init` | Create a starter config |
| `npx navgraph generate` | Build manifest from config |
| `npx navgraph enrich` | Add AI intent labels (needs `ANTHROPIC_API_KEY`) |
| `npx navgraph validate` | Check for errors and warnings |
| `npx navgraph inspect` | Browse all capabilities |
| `npx navgraph diff --prev old.json` | Detect what changed between deploys |
| `npx navgraph corpus` | Analyse query patterns and gaps |

---

## Privacy

Each capability declares its own data scope:

| Level | Meaning |
|---|---|
| `public` | No auth required |
| `user_owned` | Auth required — scoped to current user only |
| `admin` | Admin role required |

Privacy is enforced **before** resolution. The AI never sees
data outside what each capability explicitly allows.

---

## Built On

NavGraph is built on
[capman]((https://github.com/Hobbydefiningdoctory/capman.git))
by  — who saw the same problem, built the seed,
and generously handed it to us to grow.

---

## License

MIT