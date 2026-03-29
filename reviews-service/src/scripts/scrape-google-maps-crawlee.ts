/**
 * Crawlee spike: scrape Google Maps place reviews using PlaywrightCrawler.
 * Goal: evaluate stability vs existing raw Playwright script (google-maps.scraper.ts).
 *
 * Usage:
 *   npm run scrape:google-maps:crawlee -- "https://www.google.com/maps/place/..."
 *   HEADLESS=true npm run scrape:google-maps:crawlee -- "https://..."
 *
 * Outputs: total reviews, panel open success, bot/blank detection, comparison notes.
 */

import { PlaywrightCrawler } from 'crawlee';
import type { Page } from 'playwright';

const DEFAULT_PLACE_URL =
  'https://www.google.com/maps/place/SPARSH+Hospital+Yeshwanthpur+%7C+Best+Hospital+in+Yeshwanthpur/@13.0277187,77.5403566,971m/data=!3m2!1e3!4b1!4m6!3m5!1s0x3bae3d6b8e17c907:0x5c6d10b34999d043!8m2!3d13.0277135!4d77.5429315!16s%2Fg%2F11b6j5by8f!5m1!1e1?entry=ttu';

export interface CrawleeReview {
  author_name: string;
  rating: number | null;
  review_text: string;
  review_time: string;
}

const MIN_REVIEWS_TARGET = 20;
const RANDOM_DELAY_MS = { min: 800, max: 2200 };
const SCROLL_STABLE_ITERATIONS = 3; // no new content for this many checks in a row

function randomDelayMs(): number {
  return RANDOM_DELAY_MS.min + Math.random() * (RANDOM_DELAY_MS.max - RANDOM_DELAY_MS.min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ensure place URL: must be /place/ and use English. Reject placeholder URLs. */
function ensurePlaceUrl(url: string): string {
  const raw = url.trim();
  if (!raw || !raw.includes('google.com/maps')) {
    throw new Error('Invalid Google Maps URL');
  }
  if (raw.includes('Your+Place') || raw.includes('Your%20Place') || /place\/\.\.\./i.test(raw)) {
    throw new Error('Use a real place URL, not the placeholder "Your+Place/..."');
  }
  const u = new URL(raw);
  if (!u.pathname.includes('/place/')) {
    throw new Error('URL must be a Google Maps place URL (path contains /place/).');
  }
  if (!u.searchParams.has('hl')) u.searchParams.set('hl', 'en');
  return u.toString();
}

/** Dismiss cookie/consent if present. */
async function dismissConsentIfPresent(page: Page): Promise<void> {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    '[aria-label*="Accept"]',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 2000 });
        await sleep(randomDelayMs());
        return;
      }
    } catch {
      // ignore
    }
  }
}

/** Parse rating from aria-label or text (e.g. "4 stars" -> 4). */
function parseRating(s: string | null): number | null {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/(\d)/);
  if (m) return Math.min(5, Math.max(1, parseInt(m[1], 10)));
  return null;
}

/** Extract reviews from page using same selectors as existing scraper (jftiEf cards). */
async function extractReviewsFromPage(page: Page): Promise<CrawleeReview[]> {
  const raw = await page.$$eval('div.jftiEf', (nodes) =>
    nodes.map((node) => {
      const author = (node.querySelector('.d4r55') as HTMLElement)?.textContent?.trim() ?? '';
      const ratingEl = node.querySelector('.kvMYJc') as HTMLElement | null;
      const ratingText = ratingEl?.getAttribute('aria-label') ?? '';
      const text = (node.querySelector('.wiI7pd') as HTMLElement)?.textContent?.trim() ?? '';
      const fullText = (node as HTMLElement).innerText ?? '';
      const timeMatch = fullText.match(/\d+\s*(day|days|week|weeks|month|months|year|years)\s*ago/i);
      const reviewTime = timeMatch ? timeMatch[0] : '';
      return {
        author_name: author || 'Anonymous',
        rating: ratingText,
        review_text: text,
        review_time: reviewTime,
      };
    }),
  );

  return raw
    .filter((r) => r.review_text && r.review_text.length > 0)
    .map((r) => ({
      author_name: r.author_name.trim(),
      rating: parseRating(r.rating),
      review_text: r.review_text.trim(),
      review_time: r.review_time.trim(),
    }));
}

/** Fallback: extract from data-review-id and class-based selectors. */
async function extractReviewsFallback(page: Page): Promise<CrawleeReview[]> {
  const raw = await page.$$eval('div[data-review-id]', (nodes) =>
    nodes.map((node) => {
      const getText = (sel: string) =>
        node.querySelector(sel)?.textContent?.trim() ?? null;
      const author =
        getText('[class*="d4r55"]') ??
        (node.querySelector('button[aria-label]') as HTMLElement)?.getAttribute?.('aria-label') ??
        null;
      const star = node.querySelector('[aria-label*="star"], [aria-label*="Star"]') as HTMLElement | null;
      const ratingStr = star?.getAttribute('aria-label') ?? null;
      const text =
        getText('[class*="wiI7pd"]') ??
        getText('[class*="MyEned"]') ??
        (node.querySelector('span[class*="review"]') as HTMLElement)?.textContent?.trim() ??
        null;
      const fullText = (node as HTMLElement).innerText ?? '';
      const timeMatch = fullText.match(/\d+\s*(day|days|week|weeks|month|months|year|years)\s*ago/i);
      return { author_name: author, rating: ratingStr, review_text: text, review_time: timeMatch ? timeMatch[0] : '' };
    }),
  );
  return raw
    .filter((r) => r.review_text && r.review_text.length > 0)
    .map((r) => ({
      author_name: (r.author_name || 'Anonymous').trim(),
      rating: parseRating(r.rating),
      review_text: r.review_text!.trim(),
      review_time: (r.review_time || '').trim(),
    }));
}

/** Fallback: generic extraction by star + text in container. */
async function extractReviewsGeneric(page: Page): Promise<CrawleeReview[]> {
  const raw = await page.evaluate(() => {
    const rows: { author_name: string | null; rating: string | null; review_text: string; review_time: string }[] = [];
    const seen = new Set<string>();
    const starEls = document.querySelectorAll('[aria-label*="star" i], [aria-label*="Star"]');
    for (const star of starEls) {
      const ratingStr = (star as HTMLElement).getAttribute('aria-label');
      const container =
        star.closest('div[data-review-id]') ??
        star.closest('[role="listitem"]') ??
        star.closest('div[class]')?.parentElement ??
        star.parentElement?.parentElement;
      if (!container) continue;
      let reviewText: string | null = null;
      const reviewSpan = container.querySelector('[class*="wiI7pd"], [class*="MyEned"], [class*="review"]');
      if (reviewSpan) reviewText = reviewSpan.textContent?.trim() ?? null;
      if (!reviewText || reviewText.length < 15) {
        for (const s of container.querySelectorAll('span')) {
          const t = (s.textContent ?? '').trim();
          if (t.length >= 30 && t.length < 5000 && !/^\d\s*star/i.test(t)) {
            reviewText = t;
            break;
          }
        }
      }
      if (!reviewText || reviewText.length < 15 || seen.has(reviewText)) continue;
      seen.add(reviewText);
      const author =
        container.querySelector('[class*="d4r55"]')?.textContent?.trim() ??
        (container.querySelector('button[aria-label]') as HTMLElement)?.getAttribute?.('aria-label') ??
        null;
      const fullText = (container as HTMLElement).innerText ?? '';
      const timeMatch = fullText.match(/\d+\s*(day|days|week|weeks|month|months|year|years)\s*ago/i);
      rows.push({
        author_name: author,
        rating: ratingStr,
        review_text: reviewText,
        review_time: timeMatch ? timeMatch[0] : '',
      });
    }
    return rows;
  });
  return raw
    .filter((r) => r.review_text && r.review_text.length > 0)
    .map((r) => ({
      author_name: (r.author_name || 'Anonymous').trim(),
      rating: parseRating(r.rating),
      review_text: r.review_text.trim(),
      review_time: (r.review_time || '').trim(),
    }));
}

/** Check for bot detection or blank response. */
function detectBotOrBlank(page: Page): Promise<{ isBlank: boolean; botMessage: string | null }> {
  return page.evaluate(() => {
    const body = document.body?.innerText ?? '';
    const isBlank = body.length < 200;
    const botMessage =
      /unusual traffic|not a robot|automated queries|captcha|recaptcha/i.test(body)
        ? (body.match(/[^\n]{20,120}/)?.[0] ?? 'Bot/block message detected')
        : null;
    return { isBlank, botMessage };
  });
}

async function main(): Promise<void> {
  const argUrl = process.argv[2]?.trim();
  const placeUrl = argUrl || DEFAULT_PLACE_URL;
  const headless = process.env.HEADLESS === 'true';

  let loadUrl: string;
  try {
    loadUrl = ensurePlaceUrl(placeUrl);
  } catch (e) {
    console.error('Invalid URL:', (e as Error).message);
    if (!argUrl) {
      console.log('Example: npm run scrape:google-maps:crawlee -- \'https://www.google.com/maps/place/SPARSH+Hospital+...\'');
    }
    process.exit(1);
  }
  if (!argUrl) {
    console.log('Using default place URL (Sparsh Hospital). Pass a URL as first argument to scrape another place.');
  }
  console.log('Scraping:', loadUrl);

  let reviewsPanelOpened = false;
  let totalReviewsExtracted = 0;
  let botOrBlank: { isBlank: boolean; botMessage: string | null } = { isBlank: false, botMessage: null };
  const allReviews: CrawleeReview[] = [];

  const crawler = new PlaywrightCrawler({
    launchContext: {
      launchOptions: {
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      },
    },
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: 120,
    preNavigationHooks: [
      async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
      },
    ],
    async requestHandler({ request, page, log }) {
      log.info('Loading place URL...', { url: request.url });
      await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(4000);
      await dismissConsentIfPresent(page);
      await sleep(2000);

      await page.waitForSelector('h1', { timeout: 15000 }).catch(() => {
        log.warning('Place title (h1) not found; page may not have loaded correctly.');
      });
      await sleep(2000);

      // Open reviews panel: try several selectors (same as Playwright scraper)
      const panelSelectors = [
        { sel: 'text=/\\d+\\s*reviews?/i', name: 'X reviews text' },
        { sel: 'text=/\\d+ reviews/', name: 'X reviews (exact)' },
        { sel: 'button:has-text("Reviews")', name: 'Reviews button' },
        { sel: '[aria-label="Reviews"]', name: 'aria-label Reviews' },
        { sel: '[role="tab"]:has-text("Reviews")', name: 'Reviews tab' },
      ];
      for (const { sel, name } of panelSelectors) {
        try {
          const el = page.locator(sel).first();
          if ((await el.count()) > 0 && (await el.isVisible())) {
            await el.click({ timeout: 5000 });
            reviewsPanelOpened = true;
            log.info('Opened reviews panel via: ' + name);
            break;
          }
        } catch {
          // try next
        }
      }
      if (!reviewsPanelOpened) {
        log.warning('Could not find any reviews panel trigger.');
      } else {
        await sleep(2000);
      }

      if (!reviewsPanelOpened) {
        console.error('\n[SPIKE RESULT] Reviews panel did NOT open. Will still try to extract.');
      }

      // Wait for reviews feed
      try {
        await page.waitForSelector('div[role="feed"]', { timeout: 10000 });
      } catch {
        log.warning('div[role="feed"] not found; continuing anyway.');
      }

      const feed = page.locator('div[role="feed"]').first();
      if ((await feed.count()) > 0) {
        // Scroll until no new content (compare scrollHeight), with ~2s delay like Playwright
        let lastScrollHeight = 0;
        let stableCount = 0;
        for (let i = 0; i < 30; i++) {
          const currentScrollHeight = await feed.evaluate((el) => el.scrollHeight);
          await feed.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          await sleep(Math.max(1800, randomDelayMs()));

          const newScrollHeight = await feed.evaluate((el) => el.scrollHeight);
          if (newScrollHeight === currentScrollHeight && currentScrollHeight === lastScrollHeight) {
            stableCount++;
            if (stableCount >= SCROLL_STABLE_ITERATIONS) {
              log.info('Scroll height stable; no new reviews loading.', { scrollHeight: newScrollHeight });
              break;
            }
          } else {
            stableCount = 0;
          }
          lastScrollHeight = newScrollHeight;
        }
      } else {
        log.warning('No feed element; cannot scroll. Extracting whatever is on page.');
      }

      await sleep(2000);

      let reviews = await extractReviewsFromPage(page);
      if (reviews.length === 0) {
        reviews = await extractReviewsFallback(page);
      }
      if (reviews.length === 0) {
        reviews = await extractReviewsGeneric(page);
      }
      totalReviewsExtracted = reviews.length;
      allReviews.push(...reviews);

      log.info('Extraction complete.', { count: totalReviewsExtracted });

      botOrBlank = await detectBotOrBlank(page);
    },
    failedRequestHandler({ request, log }) {
      log.error('Request failed.', { url: request.url });
    },
  });

  await crawler.addRequests([loadUrl]);
  await crawler.run();

  // --- Summary ---
  console.log('\n========== CRAWLEE SPIKE SUMMARY ==========');
  console.log('Total reviews extracted:', totalReviewsExtracted);
  console.log('Reviews panel opened:', reviewsPanelOpened ? 'Yes' : 'No');
  console.log('Bot/blank detection:', botOrBlank.botMessage ?? (botOrBlank.isBlank ? 'Page very short (possible blank)' : 'None observed'));
  if (totalReviewsExtracted >= MIN_REVIEWS_TARGET) {
    console.log('Target (≥' + MIN_REVIEWS_TARGET + ' reviews): Met');
  } else {
    console.log('Target (≥' + MIN_REVIEWS_TARGET + ' reviews): Not met');
  }
  console.log('============================================\n');

  if (allReviews.length > 0) {
    console.log('Sample (first 3):');
    allReviews.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.author_name} | ${r.rating ?? 'N/A'} | ${r.review_time || 'N/A'} | ${r.review_text.slice(0, 80)}...`);
    });
  }

  console.log('\n--- Comparison vs Playwright-only (google-maps.scraper.ts) ---');
  console.log('- Crawlee: managed browser/page, single-URL flow, same selectors (jftiEf, d4r55, kvMYJc, wiI7pd), scroll by scrollHeight until stable.');
  console.log('- Playwright-only: manual launch/context/page, same panel open (click "X reviews") and feed scroll.');
  console.log('- Evaluate: run both multiple times and compare success rate, bot blocks, and review count consistency.');
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
