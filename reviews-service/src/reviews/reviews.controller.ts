import { Controller, Get, Post, Patch, Query, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('fetch')
  async fetchReviews(@Query('placeId') placeId: string) {
    if (!placeId) {
      throw new HttpException('placeId query parameter is required', HttpStatus.BAD_REQUEST);
    }
    return await this.reviewsService.fetchReviews(placeId);
  }

  @Post('analyze')
  async analyzeReviews(@Query('placeId') placeId: string) {
    if (!placeId) {
      throw new HttpException('placeId query parameter is required', HttpStatus.BAD_REQUEST);
    }
    return await this.reviewsService.analyzeReviews(placeId);
  }

  @Get('insights')
  async getInsights(@Query('placeId') placeId: string) {
    if (!placeId) {
      throw new HttpException('placeId query parameter is required', HttpStatus.BAD_REQUEST);
    }
    return await this.reviewsService.getInsights(placeId);
  }

  @Get('list')
  async getReviews(@Query('placeId') placeId: string) {
    if (!placeId) {
      throw new HttpException('placeId query parameter is required', HttpStatus.BAD_REQUEST);
    }
    return await this.reviewsService.getReviews(placeId);
  }

  @Get('fetch-demo')
  async fetchDemoReviews() {
    // ⚠️ DEMO ONLY - Not for production use
    return await this.reviewsService.scrapeGoogleReviewsDemo();
  }

  @Patch('review/:id')
  async updateReview(
    @Param('id') id: string,
    @Body() body: { author_email?: string | null; department?: string | null },
  ) {
    const numId = parseInt(id, 10);
    if (Number.isNaN(numId)) {
      throw new HttpException('Invalid review ID', HttpStatus.BAD_REQUEST);
    }
    return await this.reviewsService.updateReview(numId, body);
  }
}
