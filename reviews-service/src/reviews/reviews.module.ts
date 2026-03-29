import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { ExternalReview } from './entities/external-review.entity';
import { ReviewInsight } from './entities/review-insight.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ExternalReview, ReviewInsight])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
