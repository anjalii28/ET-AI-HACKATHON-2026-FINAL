/**
 * Standalone script to scrape Google Maps reviews and log to console.
 * Usage: npm run scrape:google-maps -- "https://www.google.com/maps/place/..."
 * Or: npx ts-node -r tsconfig-paths/register src/scripts/scrape-google-maps.ts "https://..."
 */

import { scrapeGoogleReviews } from '../scraper/google-maps.scraper';

const url =
  process.argv[2]?.trim() ||
  'https://www.google.com/maps/place/SPARSH+Hospital+Yeshwanthpur+%7C+Best+Hospital+in+Yeshwanthpur/@13.0277187,77.5403566,971m/data=!3m2!1e3!4b1!4m6!3m5!1s0x3bae3d6b8e17c907:0x5c6d10b34999d043!8m2!3d13.0277135!4d77.5429315!16s%2Fg%2F11b6j5by8f!5m1!1e1?entry=ttu';

async function main() {
  console.log('Scraping Google Maps reviews from:', url);
  try {
    const reviews = await scrapeGoogleReviews(url);
    console.log(`\nExtracted ${reviews.length} reviews:\n`);
    reviews.forEach((r, i) => {
      console.log(`--- Review ${i + 1} ---`);
      console.log('Author:', r.author_name);
      console.log('Rating:', r.rating ?? 'N/A');
      console.log('Text:', r.review_text?.slice(0, 200) + (r.review_text?.length > 200 ? '...' : ''));
      console.log('');
    });
    console.log(`Total: ${reviews.length} reviews`);
  } catch (err) {
    console.error('Scrape failed:', (err as Error).message);
    process.exit(1);
  }
}

main();
