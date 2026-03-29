/**
 * Firecrawl spike: scrape Google Maps place reviews via Firecrawl API (free tier).
 * Goal: evaluate stability vs Playwright/Crawlee.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=fc-xxx npm run scrape:google-maps:firecrawl -- 'https://www.google.com/maps/place/...'
 *   Or set FIRECRAWL_API_KEY in .env
 *
 * Logs: total reviews, login wall, bot detection, reason if <3 reviews.
 * Output: structured JSON (reviews array).
 */

import 'dotenv/config';
import { Firecrawl } from '@mendable/firecrawl-js';

const DEFAULT_PLACE_URL =
  'https://www.google.com/maps/place/SPARSH+Hospital+Yeshwanthpur+%7C+Best+Hospital+in+Yeshwanthpur/@13.0277187,77.5403566,971m/data=!3m2!1e3!4b1!4m6!3m5!1s0x3bae3d6b8e17c907:0x5c6d10b34999d043!8m2!3d13.0277135!4d77.5429315!16s%2Fg%2F11b6j5by8f!5m1!1e1?entry=ttu';

export interface FirecrawlReview {
  author_name: string;
  rating: number | null;
  review_text: string;
  review_time: string;
}

const MIN_REVIEWS_TARGET = 30;

function ensurePlaceUrl(url: string): string {
  const raw = url.trim();
  if (!raw || !raw.includes('google.com/maps')) throw new Error('Invalid Google Maps URL');
  if (raw.includes('Your+Place') || raw.includes('Your%20Place') || /place\/\.\.\./i.test(raw)) {
    throw new Error('Use a real place URL, not the placeholder.');
  }
  const u = new URL(raw);
  if (!u.pathname.includes('/place/')) throw new Error('URL must be a Google Maps place URL.');
  if (!u.searchParams.has('hl')) u.searchParams.set('hl', 'en');
  return u.toString();
}

/** Detect login wall from content. */
function detectLoginWall(markdown: string, html: string): boolean {
  const combined = (markdown || '') + (html || '');
  return (
    /sign\s*in\s*(to\s*)?google/i.test(combined) ||
    /create\s*(an\s*)?account/i.test(combined) ||
    /log\s*in\s*to\s*continue/i.test(combined) ||
    /before you continue/i.test(combined)
  );
}

/** Detect bot/captcha block. */
function detectBotBlock(markdown: string, html: string): { detected: boolean; message: string | null } {
  const combined = (markdown || '') + (html || '');
  if (/unusual\s*traffic/i.test(combined)) return { detected: true, message: 'Unusual traffic message' };
  if (/not a robot|captcha|recaptcha|automated/i.test(combined)) return { detected: true, message: 'Bot/captcha block' };
  return { detected: false, message: null };
}

/**
 * Parse reviews from Firecrawl markdown (and optionally HTML).
 * Google Maps in markdown may appear as bold names, star ratings, "X time ago", and paragraphs.
 */
function parseReviewsFromContent(markdown: string, _html?: string): FirecrawlReview[] {
  const reviews: FirecrawlReview[] = [];
  const text = (markdown || '').trim();
  if (!text) return reviews;

  // Pattern: optional bold/name line, then optional "X star(s)" or "★", then optional "X days/months ago", then review text (multi-line until next name or end)
  const relativeTimeRe = /\d+\s*(day|week|month|year)s?\s*ago/i;
  const starRe = /(\d)\s*star|★|⭐|[\u2605\u2B50]/i;

  // Split into blocks by double newline or by lines that look like headers (short line then long)
  const blocks = text.split(/\n\n+/);
  let current: Partial<FirecrawlReview> = {};
  const flush = () => {
    if (current.review_text && current.review_text.length >= 10) {
      reviews.push({
        author_name: (current.author_name || 'Anonymous').trim(),
        rating: current.rating ?? null,
        review_text: current.review_text.trim(),
        review_time: (current.review_time || '').trim(),
      });
    }
    current = {};
  };

  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const first = lines[0];
    const starMatch = first.match(starRe) || block.match(starRe);
    const timeMatch = block.match(relativeTimeRe);
    const looksLikeName = first.length < 60 && !/^\d+\s*star/i.test(first) && !relativeTimeRe.test(first);

    if (looksLikeName && (starMatch || timeMatch || lines.some((l) => l.length > 80))) {
      flush();
      current.author_name = looksLikeName ? first.replace(/\*+/g, '').trim() : undefined;
      if (starMatch) current.rating = Math.min(5, Math.max(1, parseInt(starMatch[1] || '0', 10) || 0));
      if (timeMatch) current.review_time = timeMatch[0];
      const textLines = lines.slice(1).filter((l) => l.length > 20 && !/^\d\s*star/i.test(l));
      if (textLines.length > 0) current.review_text = textLines.join(' ');
      else current.review_text = lines.slice(1).join(' ');
    } else if (current.review_text !== undefined && block.length > 30) {
      current.review_text = (current.review_text + ' ' + block).trim();
    } else if (block.length >= 50 && (starMatch || timeMatch)) {
      flush();
      if (starMatch) current.rating = Math.min(5, Math.max(1, parseInt(starMatch[1] || '0', 10) || 0));
      if (timeMatch) current.review_time = timeMatch[0];
      current.review_text = block.replace(relativeTimeRe, '').replace(starRe, '').trim();
    }
  }
  flush();

  // Fallback: find any "X star" and pull surrounding text as one review each
  if (reviews.length < MIN_REVIEWS_TARGET && text.length > 200) {
    const starBlocks = text.split(/(?=\d\s*star|\★|\⭐)/i);
    for (const blk of starBlocks) {
      const m = blk.match(/(\d)\s*star|★|⭐/i);
      const timeM = blk.match(relativeTimeRe);
      const nameM = blk.match(/^\s*\*?\*?([^\n*]{2,50})\*?\*?\s*$/m);
      const rest = blk.replace(/\d\s*star|★|⭐|[\d]+\s*(day|week|month|year)s?\s*ago/gi, '').trim();
      if (rest.length >= 30 && !reviews.some((r) => r.review_text === rest.slice(0, 100))) {
        reviews.push({
          author_name: nameM ? nameM[1].trim() : 'Anonymous',
          rating: m ? Math.min(5, Math.max(1, parseInt(m[1] || '0', 10) || 0)) : null,
          review_text: rest.slice(0, 2000),
          review_time: timeM ? timeM[0] : '',
        });
      }
    }
  }

  return reviews.slice(0, 50);
}

function reasonFewerThanThree(
  count: number,
  loginWall: boolean,
  botBlock: boolean,
  contentLength: number,
): string {
  if (count >= MIN_REVIEWS_TARGET) return '';
  if (loginWall) return 'Login wall detected; Firecrawl did not bypass it.';
  if (botBlock) return 'Bot/captcha block detected; Firecrawl did not bypass it.';
  if (contentLength < 500) return 'Firecrawl returned very little content (likely Maps JS did not render reviews).';
  return `Only ${count} review(s) could be parsed from content; structure may not match expected pattern.`;
}

async function main(): Promise<void> {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    console.error('FIRECRAWL_API_KEY is required. Set it in .env or: FIRECRAWL_API_KEY=fc-xxx npm run scrape:google-maps:firecrawl');
    process.exit(1);
  }

  const argUrl = process.argv[2]?.trim();
  const placeUrl = argUrl || DEFAULT_PLACE_URL;
  let loadUrl: string;
  try {
    loadUrl = ensurePlaceUrl(placeUrl);
  } catch (e) {
    console.error('URL error:', (e as Error).message);
    process.exit(1);
  }

  if (!argUrl) console.log('Using default place URL (Sparsh Hospital).');
  console.log('Scraping with Firecrawl:', loadUrl);

  const firecrawl = new Firecrawl({ apiKey });
  let markdown = '';
  let html = '';
  let pageError: string | null = null;
  let success = false;

  try {
    const doc = await firecrawl.scrape(loadUrl, {
      formats: ['markdown', 'html'],
      onlyMainContent: false,
      waitFor: 5000,
      timeout: 60000,
      actions: [
        // Give Maps time to render
        { type: 'wait', milliseconds: 8000 },
        // Scroll the main page repeatedly to try to trigger lazy loading / limited view expansion
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
        { type: 'scroll', direction: 'down' },
        { type: 'wait', milliseconds: 2000 },
      ],
    });
    markdown = (doc as { markdown?: string }).markdown ?? '';
    html = (doc as { html?: string }).html ?? '';
    const meta = (doc as { metadata?: { pageError?: string } }).metadata;
    pageError = meta?.pageError ?? null;
    success = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Firecrawl scrape failed:', msg);
    if (msg.includes('402') || msg.includes('Payment')) {
      console.error('Free tier limit or payment required.');
    }
    process.exit(1);
  }

  const loginWall = detectLoginWall(markdown, html);
  const botBlock = detectBotBlock(markdown, html);
  const contentLength = markdown.length + html.length;

  const reviews = parseReviewsFromContent(markdown, html);
  const total = reviews.length;
  const reason = reasonFewerThanThree(total, loginWall, botBlock.detected, contentLength);

  // --- Structured JSON output ---
  const output = {
    success,
    url: loadUrl,
    total_reviews: total,
    reviews,
    evaluation: {
      login_wall_appeared: loginWall,
      bot_detection_bypassed: !botBlock.detected,
      bot_message: botBlock.message,
      page_error: pageError,
      content_length: contentLength,
      reason_fewer_than_three: reason || null,
    },
  };
  console.log('\n--- Structured output (JSON) ---');
  console.log(JSON.stringify(output, null, 2));

  // --- Log summary ---
  console.log('\n========== FIRECRAWL SPIKE SUMMARY ==========');
  console.log('Total reviews extracted:', total);
  console.log('Login wall appeared:', loginWall ? 'Yes' : 'No');
  console.log('Firecrawl bypassed bot detection:', !botBlock.detected ? 'Yes' : 'No', botBlock.message || '');
  if (total < MIN_REVIEWS_TARGET) {
    console.log('Reason (< 3 reviews):', reason);
  } else {
    console.log('Target (≥ 3 reviews): Met');
  }
  console.log('================================================\n');

  if (total > 0) {
    console.log('Sample (first 3):');
    reviews.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.author_name} | ${r.rating ?? 'N/A'} | ${r.review_time || 'N/A'} | ${r.review_text.slice(0, 60)}...`);
    });
  }
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
