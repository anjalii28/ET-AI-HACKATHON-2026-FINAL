import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReviewsService } from '../reviews/reviews.service';

const DEMO_PLACE_ID = 'demo_hospital';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const reviewsService = app.get(ReviewsService);

    console.log('Seeding demo reviews (30) for placeId=', DEMO_PLACE_ID);
    await reviewsService.scrapeGoogleReviewsDemo();

    console.log('Running Gemini analysis for demo place only:', DEMO_PLACE_ID);

    for (const placeId of [DEMO_PLACE_ID]) {
      try {
        console.log(`Analyzing reviews for placeId="${placeId}"...`);
        const insight = await reviewsService.analyzeReviews(placeId);
        const summary = insight?.sentiment_summary;
        console.log(
          `✔ Completed analysis for ${placeId}: positive=${summary?.positive?.toFixed(
            1,
          )}% neutral=${summary?.neutral?.toFixed(
            1,
          )}% negative=${summary?.negative?.toFixed(1)}%`,
        );
      } catch (err) {
        console.error(
          `✖ Failed analysis for ${placeId}: ${
            (err as Error).message || String(err)
          }`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error while running analyze-reviews CLI:', err);
  process.exit(1);
});

