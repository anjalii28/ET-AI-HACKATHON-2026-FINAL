/**
 * Basic Google Maps review scraper for local dev/demo only.
 * NOT production-grade. Uses Playwright, headless.
 */

import { chromium, Page } from 'playwright';

export interface Review {
  author_name: string;
  rating: number | null;
  review_text: string;
}

const TARGET_REVIEWS = 25;
const FEED_SCROLL_ITERATIONS = 8;
const FEED_SCROLL_DELAY_MS = 1500;
const FEED_SCROLL_AMOUNT = 1000;

interface RawRow {
  author_name: string | null;
  rating: string | null;
  review_text: string | null;
}

function parseRating(rating: string | null): number | null {
  if (!rating || typeof rating !== 'string') return null;
  const match = rating.match(/(\d)/);
  if (match) return Math.min(5, Math.max(1, parseInt(match[1], 10)));
  return null;
}

function normalize(rows: RawRow[]): Review[] {
  const result: Review[] = [];
  for (const r of rows) {
    const rating = parseRating(r.rating);
    if (!r.review_text?.trim()) continue;
    result.push({
      author_name: (r.author_name || 'Anonymous').trim(),
      rating: rating ?? null,
      review_text: r.review_text.trim(),
    });
  }
  return result.slice(0, TARGET_REVIEWS);
}

/** Dismiss "Before you continue to Google" / cookie consent so main content is usable. */
async function dismissConsentIfPresent(page: Page): Promise<void> {
  try {
    await page.locator('button:has-text("Accept all")').first().click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    return;
  } catch {
    // try alternatives
  }
  const consentSelectors = [
    'button:has-text("Accept All")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    '[aria-label*="Accept"], [aria-label*="accept"]',
    'form[action*="consent"] button[type="submit"]',
  ];
  for (const sel of consentSelectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        return;
      }
    } catch {
      // ignore
    }
  }
}

/**
 * Primary extraction: Google uses div.jftiEf for each review card in the feed.
 * Author: .d4r55, rating: .kvMYJc aria-label, text: .wiI7pd
 */
async function extractReviewsJftiEf(page: Page): Promise<RawRow[]> {
  const reviews = await page.$$eval('div.jftiEf', (nodes) =>
    nodes.map((node) => {
      const author =
        (node.querySelector('.d4r55') as HTMLElement)?.textContent?.trim() ?? '';
      const ratingEl = node.querySelector('.kvMYJc') as HTMLElement | null;
      const ratingText = ratingEl?.getAttribute('aria-label') ?? '';
      const ratingMatch = ratingText.match(/\d/);
      const rating = ratingMatch ? ratingMatch[0] : null;
      const text = (node.querySelector('.wiI7pd') as HTMLElement)?.textContent?.trim() ?? '';
      return {
        author_name: author || null,
        rating: rating ? `${rating} star` : null,
        review_text: text || null,
      };
    }),
  );
  return reviews.filter((r) => r.review_text && r.review_text.length > 0);
}

async function extractReviewsWithSelectors(page: Page): Promise<RawRow[]> {
  const selector = 'div[data-review-id]';
  const count = await page.$$eval(selector, (nodes) => nodes.length);
  if (count === 0) return [];

  return page.$$eval(selector, (nodes) =>
    nodes.map((node) => {
      const getText = (sel: string) =>
        node.querySelector(sel)?.textContent?.trim() ?? null;
      const author =
        getText('[class*="d4r55"]') ??
        (node.querySelector('button[aria-label]') as HTMLElement)?.ariaLabel ??
        null;
      const ariaStar = node.querySelector(
        '[aria-label*="star"], [aria-label*="Star"]',
      ) as HTMLElement | null;
      const ratingStr = ariaStar?.getAttribute('aria-label') ?? null;
      const text =
        getText('[class*="wiI7pd"]') ??
        getText('[class*="MyEned"]') ??
        (node.querySelector('span[class*="review"]') as HTMLElement)?.textContent?.trim() ??
        null;
      return { author_name: author, rating: ratingStr, review_text: text };
    }),
  );
}

async function extractReviewsFallback(page: Page): Promise<RawRow[]> {
  return page.$$eval(
    '[class*="wiI7pd"], [class*="MyEned"]',
    (nodes) => {
      const seen = new Set<string>();
      return nodes
        .map((node) => {
          const reviewText = node.textContent?.trim() ?? null;
          if (!reviewText || reviewText.length < 10 || seen.has(reviewText)) return null;
          seen.add(reviewText);
          const container =
            node.closest('div[data-review-id]') ??
            node.parentElement?.closest('[role="listitem"]') ??
            node.parentElement?.parentElement;
          if (!container)
            return { author_name: null, rating: null, review_text: reviewText };
          const author =
            container.querySelector('[class*="d4r55"]')?.textContent?.trim() ??
            (container.querySelector('button[aria-label]') as HTMLElement)?.ariaLabel ??
            null;
          const star = container.querySelector(
            '[aria-label*="star"], [aria-label*="Star"]',
          ) as HTMLElement | null;
          const ratingStr = star?.getAttribute('aria-label') ?? null;
          return { author_name: author, rating: ratingStr, review_text: reviewText };
        })
        .filter((r): r is RawRow => r != null);
    },
  );
}

/**
 * Broader extraction: find elements that look like review blocks (star + text)
 * when data-review-id / class-based selectors fail (e.g. after Maps DOM changes).
 */
async function extractReviewsGeneric(page: Page): Promise<RawRow[]> {
  return page.evaluate(() => {
    const rows: { author_name: string | null; rating: string | null; review_text: string | null }[] = [];
    const seen = new Set<string>();

    const starEls = document.querySelectorAll(
      '[aria-label*="star" i], [aria-label*="Star"]',
    );
    for (const star of starEls) {
      const ratingStr = (star as HTMLElement).getAttribute('aria-label');
      const container =
        star.closest('div[data-review-id]') ??
        star.closest('[role="listitem"]') ??
        star.closest('div[role="listitem"]') ??
        star.closest('div[class]')?.parentElement ??
        star.parentElement?.parentElement;
      if (!container) continue;

      let reviewText: string | null = null;
      const reviewSpan = container.querySelector(
        '[class*="wiI7pd"], [class*="MyEned"], [class*="review"]',
      );
      if (reviewSpan) {
        reviewText = reviewSpan.textContent?.trim() ?? null;
      }
      if (!reviewText || reviewText.length < 15) {
        const allSpans = container.querySelectorAll('span');
        for (const s of allSpans) {
          const t = s.textContent?.trim() ?? '';
          if (t.length >= 30 && t.length < 5000 && !/^\d\s*star/i.test(t)) {
            reviewText = t;
            break;
          }
        }
      }
      if (!reviewText || reviewText.length < 15 || seen.has(reviewText)) continue;
      seen.add(reviewText);

      const authorBtn = container.querySelector('button[aria-label]');
      const author =
        container.querySelector('[class*="d4r55"]')?.textContent?.trim() ??
        (authorBtn as HTMLElement)?.getAttribute?.('aria-label') ??
        null;

      rows.push({
        author_name: author,
        rating: ratingStr,
        review_text: reviewText,
      });
    }
    return rows;
  });
}

/**
 * Last resort: find list items or divs that contain a rating (1-5) and a long text block.
 */
async function extractReviewsByStructure(page: Page): Promise<RawRow[]> {
  return page.evaluate(() => {
    const rows: { author_name: string | null; rating: string | null; review_text: string | null }[] = [];
    const seen = new Set<string>();
    const candidates = document.querySelectorAll('[role="listitem"], div[data-review-id]');
    for (const el of candidates) {
      const text = el.textContent ?? '';
      const ratingMatch = text.match(/\b([1-5])\s*star/i) ?? text.match(/\b([1-5])\s*\/\s*5/);
      if (!ratingMatch) continue;
      const ratingNum = ratingMatch[1];
      const spans = el.querySelectorAll('span');
      let bestReview = '';
      for (const s of spans) {
        const t = (s.textContent ?? '').trim();
        if (t.length > 50 && t.length < 4000 && !/^\d\s*star/i.test(t) && t !== text) {
          bestReview = t;
          break;
        }
      }
      if (!bestReview && text.length > 80) {
        const parts = text.split(/\d\s*star/i);
        const afterStar = parts[1]?.trim();
        if (afterStar && afterStar.length > 30) bestReview = afterStar.slice(0, 3000);
      }
      if (!bestReview || bestReview.length < 20 || seen.has(bestReview)) continue;
      seen.add(bestReview);
      const author =
        el.querySelector('button[aria-label]')?.getAttribute('aria-label') ??
        el.querySelector('[class*="d4r55"]')?.textContent?.trim() ??
        null;
      rows.push({ author_name: author, rating: `${ratingNum} star`, review_text: bestReview });
    }
    return rows;
  });
}

/** Ensure URL has English locale for consistent "Reviews" / "See all" text. */
function ensureEnglishUrl(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has('hl')) u.searchParams.set('hl', 'en');
  return u.toString();
}

/**
 * Scrapes ~20–30 reviews from a Google Maps place URL.
 * Opens the page, clicks Reviews tab, scrolls the panel, extracts author_name, rating, review_text.
 * Demo/local use only — no rate limiting or proxy.
 */
export async function scrapeGoogleReviews(placeUrl: string): Promise<Review[]> {
  const url = placeUrl.trim();
  if (!url || !url.includes('google.com/maps')) {
    throw new Error('Invalid Google Maps place URL');
  }
  const loadUrl = ensureEnglishUrl(url);

  const headless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    await page.goto(loadUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await page.waitForTimeout(4000);
    await dismissConsentIfPresent(page);
    await page.waitForTimeout(2000);

    // Wait for hospital title
    await page.waitForSelector('h1', { timeout: 10000 });

    // Small delay to let panel render
    await page.waitForTimeout(2000);

    // Click the reviews count text (e.g. "123 reviews")
    const reviewsText = page.locator('text=/\\d+ reviews/');
    if ((await reviewsText.count()) > 0) {
      await reviewsText.first().click();
      console.log('Clicked reviews text.');
    } else {
      console.log('Could not find reviews text.');
    }

    // Wait for reviews feed
    try {
      await page.waitForSelector('div[role=\"feed\"]', { timeout: 10000 });
    } catch {
      // Modal may not have opened; scroll fallback will use generic container if needed
    }

    // Scroll the feed until no new reviews load (dynamic scroll to bottom)
    const feed = page.locator('div[role="feed"]').first();
    if ((await feed.count()) > 0) {
      let previousCount = 0;
      for (let i = 0; i < 20; i++) {
        await feed.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });

        await page.waitForTimeout(2000);

        const currentCount = await page.locator('div.jftiEf').count();
        console.log('Current review count:', currentCount);

        if (currentCount === previousCount) {
          console.log('No new reviews loaded. Stopping scroll.');
          break;
        }

        previousCount = currentCount;
      }
    } else {
      const scrollSelector =
        'div[role="main"], [class*="m6QErb"], [role="main"]';
      const scrollContainer = page.locator(scrollSelector).first();
      if ((await scrollContainer.count()) > 0) {
        for (let i = 0; i < FEED_SCROLL_ITERATIONS; i++) {
          await scrollContainer.evaluate(
            (el, amount) => {
              el.scrollBy(0, amount);
            },
            FEED_SCROLL_AMOUNT,
          );
          await page.waitForTimeout(FEED_SCROLL_DELAY_MS);
        }
      }
    }

    await page.waitForTimeout(2000);

    // Debug: review cards count (div.jftiEf = review card in feed). If 0 → modal didn't open; if >0 but 0 extracted → extraction logic.
    const cardCount = await page.locator('div.jftiEf').count();
    console.log('Review cards found (div.jftiEf):', cardCount);

    let raw = await extractReviewsJftiEf(page);
    if (raw.length === 0) {
      raw = await extractReviewsWithSelectors(page);
    }
    if (raw.length === 0) {
      raw = await extractReviewsFallback(page);
    }
    if (raw.length === 0) {
      raw = await extractReviewsGeneric(page);
    }
    if (raw.length === 0) {
      raw = await extractReviewsByStructure(page);
    }

    if (raw.length === 0) {
      try {
        await page.screenshot({ path: 'scrape-debug.png', fullPage: false });
        console.error('Scraper: 0 reviews extracted. Review cards found:', cardCount, '- Screenshot: scrape-debug.png. Run with HEADLESS=false to watch the browser.');
      } catch {
        // ignore screenshot errors
      }
    }

    return normalize(raw);
  } finally {
    await browser.close();
  }
}
