# Google Maps review scraper (demo only)

Playwright-based scraper for local dev/demo. **Not production-grade.**

## Run instructions

**Important:** All npm commands must be run from the `reviews-service/` directory (where `package.json` lives), not from the repo root.

```bash
cd reviews-service
```

### 1. Standalone script (log reviews to console)

```bash
# From reviews-service/
npm install
npx playwright install chromium

# Scrape a place URL (defaults to Sparsh Hospital if no URL given)
# Use single quotes so zsh doesn't treat ( ) in URLs as globs
npm run scrape:google-maps -- 'https://www.google.com/maps/place/Your+Place+Name/...'

# Or run with default URL (Sparsh Hospital)
npm run scrape:google-maps

# If you get 0 reviews: run with browser visible to debug (consent, selectors, etc.)
HEADLESS=false npm run scrape:google-maps

# When 0 reviews, a screenshot is saved to scrape-debug.png in reviews-service/ for inspection.
```

### 1b. Crawlee spike (evaluate stability vs raw Playwright)

Uses `PlaywrightCrawler` from Crawlee; same place URL and reviews-panel flow, with random delays and scroll-by-scrollHeight. Outputs total reviews, panel open success, and bot/blank detection.

```bash
# From reviews-service/ — headful by default
npm run scrape:google-maps:crawlee -- 'https://www.google.com/maps/place/...'

# Headless
HEADLESS=true npm run scrape:google-maps:crawlee
```

### 1c. Firecrawl spike (API-based, free tier)

Uses [Firecrawl](https://firecrawl.dev) API to scrape a single place URL (rendered markdown/HTML). Logs total reviews, login wall, bot detection, and reason if &lt;3 reviews. Output is structured JSON.

```bash
# Set API key (get from firecrawl.dev); can also add FIRECRAWL_API_KEY to .env
FIRECRAWL_API_KEY=fc-xxx npm run scrape:google-maps:firecrawl -- 'https://www.google.com/maps/place/...'

# Default place URL if omitted
FIRECRAWL_API_KEY=fc-xxx npm run scrape:google-maps:firecrawl
```

### 2. Via API (POST /reviews/scrape)

Start the reviews service, then:

```bash
curl -X POST http://localhost:3003/reviews/scrape \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.google.com/maps/place/Your+Place+Name/..."}'
```

Response: `{ "count": N, "reviews": [ { "author_name", "rating", "review_text" }, ... ] }`

### Programmatic use

```ts
import { scrapeGoogleReviews } from './scraper/google-maps.scraper';

const reviews = await scrapeGoogleReviews('https://www.google.com/maps/place/...');
// reviews: { author_name, rating, review_text }[]
```

No database persistence; no Gemini integration. Isolated from existing review ingestion.
