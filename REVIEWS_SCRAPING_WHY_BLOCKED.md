# Why Scraping Is Blocked / Bypassed

## What Happens Now

The **demo** flow (`GET /reviews/fetch-demo`) does **not** scrape Google Maps. It uses **hardcoded sample reviews** so the UI and analysis work without hitting Google.

## Why We Don’t Scrape Google Maps

When we tried scraping with Playwright we saw:

- **Timeout:** `page.goto(..., { waitUntil: 'networkidle' })` often never completes (30s timeout).
- **Bot detection:** Google detects headless browsers and can:
  - Serve different/captcha pages
  - Throttle or block requests
- **Heavy page:** Maps is very JS-heavy; “networkidle” is unreliable.
- **Legal/ToS:** Scraping Google Maps typically violates their Terms of Service.

So scraping isn’t “blocked” in one place; it’s **unreliable and discouraged** for this use case.

## Recommended Approach: Official API

Use the **Google Places API** (already in the service):

1. Set `GOOGLE_PLACES_API_KEY` in `reviews-service/.env`.
2. Call **`GET /reviews/fetch?placeId=<place_id>`** (not `fetch-demo`).
3. The service uses the official Place Details endpoint and returns real reviews.

No scraping, no Playwright, no bot issues.

## If You Still Want to Try Scraping (Demo Only)

You could:

- Increase timeout and use `waitUntil: 'domcontentloaded'` instead of `networkidle`.
- Use a real browser profile (less headless-looking).
- Accept that it may often fail or break when Google changes the page.

The code comment in `reviews.service.ts` (around `scrapeGoogleReviewsDemo`) explains that scraping is bypassed and points to the Places API for real data.
