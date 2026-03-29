import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ExternalReview } from './entities/external-review.entity';
import { ReviewInsight } from './entities/review-insight.entity';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { chromium, Page } from 'playwright';

const DEMO_PLACE_ID = 'demo_hospital';
/** Old demo id — insights may still be keyed here until migrated in getInsights */
const LEGACY_DEMO_PLACE_ID = 'demo_sparsh_hospital';
const DEMO_SOURCE = 'google_scrape_demo';
const DEMO_MAX_REVIEWS = 32; // Built-in demo reviews — always show 32
const SOURCE_GOOGLE_API = 'google_api';
const SOURCE_GOOGLE_SCRAPE = 'google_scrape';
const CACHE_HOURS = 24;
const PLACES_API_V1_BASE = 'https://places.googleapis.com/v1';
const SPARSH_MAPS_URL = 'https://www.google.com/maps/place/Sparsh+Hospital/';
const TARGET_REVIEWS = 30;
const SCROLL_ITERATIONS = 15;
const SCROLL_DELAY_MS = 1500;

interface ScrapedReviewRow {
  author_name: string | null;
  rating: string | null;
  review_text: string | null;
}

@Injectable()
export class ReviewsService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor(
    @InjectRepository(ExternalReview)
    private readonly reviewRepository: Repository<ExternalReview>,
    @InjectRepository(ReviewInsight)
    private readonly insightRepository: Repository<ReviewInsight>,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Mode switcher: REVIEWS_MODE=api uses Google Places API (Backend v1);
   * REVIEWS_MODE=scrape uses Playwright demo bulk.
   * Returns { mode, totalFetched, reviews, ratingDistribution, total } for dashboard compatibility.
   */
  async fetchReviews(placeId: string): Promise<{
    mode: 'api' | 'scrape';
    totalFetched: number;
    reviews: Array<{
      id: number;
      author_name: string;
      rating: number;
      review_text: string;
      review_time: number | null;
      created_at: Date;
    }>;
    ratingDistribution: Record<number, number>;
    total: number;
  }> {
    const mode = (process.env.REVIEWS_MODE || 'api').toLowerCase();
    let saved: ExternalReview[] = [];
    if (mode === 'api') {
      saved = await this.fetchFromGoogleAPI(placeId);
    } else if (mode === 'scrape') {
      try {
        saved = await this.runScraperAndSave(placeId, SOURCE_GOOGLE_SCRAPE);
      } catch (err) {
        if (err instanceof HttpException) throw err;
        throw new HttpException(
          `Scrape mode failed: ${(err as Error).message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else {
      throw new HttpException(
        `Invalid REVIEWS_MODE: "${process.env.REVIEWS_MODE}". Use "api" or "scrape".`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const reviews = saved.map((r) => ({
      id: r.id,
      author_name: r.author_name,
      author_email: r.author_email ?? null,
      department: r.department ?? null,
      suggested_department: this.suggestDepartment(r.review_text, r.rating),
      rating: r.rating,
      review_text: r.review_text,
      review_time: r.review_time,
      created_at: r.created_at,
    }));
    const ratingDistribution = this.buildRatingDistribution(saved);
    const total = saved.length;
    return {
      mode: mode as 'api' | 'scrape',
      totalFetched: total,
      reviews,
      ratingDistribution,
      total,
    };
  }

  /**
   * Fetches up to 5 reviews from Google Places API. Tries Places API (New) v1 first, then legacy Place Details.
   */
  async fetchFromGoogleAPI(placeId: string): Promise<ExternalReview[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new HttpException(
        'Google Places API key not configured. Set GOOGLE_PLACES_API_KEY in .env.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    let rows: Array<{
      place_id: string;
      author_name: string;
      rating: number;
      review_text: string;
      review_time: number | null;
      source: string;
    }> = [];

    const fromV1 = await this.fetchFromPlacesAPIv1(placeId, apiKey);
    if (fromV1.success) {
      rows = fromV1.rows;
    } else if (fromV1.status === 404) {
      throw new HttpException(
        'Place not found. Check the Place ID.',
        HttpStatus.NOT_FOUND,
      );
    } else if (fromV1.status === 403 || fromV1.status === 400) {
      const fromLegacy = await this.fetchFromPlacesLegacy(placeId, apiKey);
      if (!fromLegacy.success) {
        throw new HttpException(
          fromLegacy.message || 'Google Places API error. Enable Places API (or Place Details) for this key.',
          HttpStatus.BAD_REQUEST,
        );
      }
      rows = fromLegacy.rows;
    } else {
      throw new HttpException(
        fromV1.message || 'Failed to fetch place reviews.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const saved: ExternalReview[] = [];
    for (const row of rows.slice(0, 5)) {
      if (!row.review_text?.trim()) continue;
      const existing = await this.reviewRepository.findOne({
        where: {
          place_id: placeId,
          author_name: row.author_name,
          source: SOURCE_GOOGLE_API,
          review_time: row.review_time,
        },
      });
      if (existing) {
        saved.push(existing);
        continue;
      }
      const entity = this.reviewRepository.create(row);
      saved.push(await this.reviewRepository.save(entity));
    }
    return saved;
  }

  private async fetchFromPlacesAPIv1(
    placeId: string,
    apiKey: string,
  ): Promise<{
    success: boolean;
    status?: number;
    message?: string;
    rows: Array<{
      place_id: string;
      author_name: string;
      rating: number;
      review_text: string;
      review_time: number | null;
      source: string;
    }>;
  }> {
    const url = `${PLACES_API_V1_BASE}/places/${encodeURIComponent(placeId)}`;
    try {
      const response = await axios.get(url, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,rating,reviews',
        },
      });
      const data = response.data as {
        reviews?: Array<{
          authorAttribution?: { displayName?: string };
          rating?: number;
          text?: { text?: string };
          publishTime?: string;
        }>;
      };
      const reviews = data?.reviews ?? [];
      const rows = reviews.slice(0, 5).map((r) => ({
        place_id: placeId,
        author_name: r.authorAttribution?.displayName?.trim() || 'Anonymous',
        rating: typeof r.rating === 'number' ? Math.min(5, Math.max(1, r.rating)) : 3,
        review_text: r.text?.text?.trim() || '',
        review_time: r.publishTime
          ? Math.floor(new Date(r.publishTime).getTime() / 1000)
          : null,
        source: SOURCE_GOOGLE_API,
      }));
      return { success: true, rows };
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) {
        return { success: false, message: (err as Error).message, rows: [] };
      }
      const status = err.response?.status;
      const body = err.response?.data;
      const msg =
        typeof body?.error?.message === 'string'
          ? body.error.message
          : body?.message || err.message;
      return {
        success: false,
        status,
        message: msg || `Request failed: ${status}`,
        rows: [],
      };
    }
  }

  private async fetchFromPlacesLegacy(
    placeId: string,
    apiKey: string,
  ): Promise<{
    success: boolean;
    message?: string;
    rows: Array<{
      place_id: string;
      author_name: string;
      rating: number;
      review_text: string;
      review_time: number | null;
      source: string;
    }>;
  }> {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        {
          params: {
            place_id: placeId,
            fields: 'reviews,rating',
            key: apiKey,
          },
        },
      );
      const data = response.data as {
        status: string;
        result?: {
          reviews?: Array<{
            author_name?: string;
            rating?: number;
            text?: string;
            time?: number;
          }>;
        };
      };
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        return {
          success: false,
          message: data.status === 'REQUEST_DENIED'
            ? 'Places API key invalid or API not enabled.'
            : `Places API: ${data.status}`,
          rows: [],
        };
      }
      const reviews = data.result?.reviews ?? [];
      const rows = reviews.slice(0, 5).map((r) => ({
        place_id: placeId,
        author_name: (r.author_name || 'Anonymous').trim(),
        rating: typeof r.rating === 'number' ? Math.min(5, Math.max(1, r.rating)) : 3,
        review_text: (r.text || '').trim(),
        review_time: typeof r.time === 'number' ? r.time : null,
        source: SOURCE_GOOGLE_API,
      }));
      return { success: true, rows };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error_message?: string })?.error_message || err.message
        : (err as Error).message;
      return { success: false, message: msg, rows: [] };
    }
  }

  async analyzeReviews(placeId: string) {
    if (!this.genAI) {
      throw new HttpException(
        'GenAI not configured',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const reviews = await this.reviewRepository.find({
      where: { place_id: placeId },
      order: { created_at: 'DESC' },
    });
    if (reviews.length === 0) {
      throw new HttpException(
        'No reviews found for this place',
        HttpStatus.NOT_FOUND,
      );
    }
    const reviewTexts = reviews
      .map((r) => `Rating: ${r.rating}/5\n${r.review_text}`)
      .join('\n\n---\n\n');
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
    });
    const prompt = `Analyze the following Google reviews for a hospital and provide insights focused on improvement opportunities. Pay special attention to negative reviews (1-2 stars) to identify what needs to be fixed.

Reviews:
${reviewTexts}

Provide a comprehensive analysis with:
1. Sentiment distribution (percentage of positive, neutral, negative)
2. Top 5 positive themes mentioned (what's working well)
3. Top 5 complaints/issues mentioned (what needs attention)
4. Recurring risk keywords (words/phrases that indicate problems)
5. Executive summary (5-7 lines summarizing key insights)
6. Improvement opportunities (5-7 actionable items based on negative reviews - focus on what can be improved)

Return ONLY valid JSON in this exact format:
{
  "sentiment_summary": {
    "positive": 65.5,
    "neutral": 20.0,
    "negative": 14.5
  },
  "top_positive_themes": ["theme1", "theme2", "theme3", "theme4", "theme5"],
  "top_complaints": ["complaint1", "complaint2", "complaint3", "complaint4", "complaint5"],
  "risk_keywords": ["keyword1", "keyword2", "keyword3"],
  "executive_summary": "5-7 line summary paragraph",
  "improvement_opportunities": ["actionable improvement 1", "actionable improvement 2", "actionable improvement 3", "actionable improvement 4", "actionable improvement 5"]
}`;
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();
      text = text.trim();
      if (text.startsWith('```json')) text = text.slice(7);
      if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();
      const analysis = JSON.parse(text);
      const existingInsight = await this.insightRepository.findOne({
        where: { place_id: placeId },
        order: { created_at: 'DESC' },
      });
      if (existingInsight) {
        existingInsight.sentiment_summary = analysis.sentiment_summary;
        existingInsight.top_positive_themes = analysis.top_positive_themes;
        existingInsight.top_complaints = analysis.top_complaints;
        existingInsight.risk_keywords = analysis.risk_keywords;
        existingInsight.executive_summary = analysis.executive_summary;
        existingInsight.improvement_opportunities =
          analysis.improvement_opportunities || [];
        existingInsight.updated_at = new Date();
        await this.insightRepository.save(existingInsight);
        return existingInsight;
      }
      const newInsight = this.insightRepository.create({
        place_id: placeId,
        sentiment_summary: analysis.sentiment_summary,
        top_positive_themes: analysis.top_positive_themes,
        top_complaints: analysis.top_complaints,
        risk_keywords: analysis.risk_keywords,
        executive_summary: analysis.executive_summary,
        improvement_opportunities: analysis.improvement_opportunities || [],
      });
      return await this.insightRepository.save(newInsight);
    } catch (error) {
      throw new HttpException(
        this.messageForAnalyzeFailure(error),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** Short client-facing message; avoids dumping raw Gemini HTTP bodies into the UI. */
  private messageForAnalyzeFailure(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();
    if (
      lower.includes('api key') ||
      lower.includes('api_key_invalid') ||
      lower.includes('expired') ||
      lower.includes('permission denied') ||
      lower.includes('generativelanguage.googleapis.com')
    ) {
      return 'Gemini API key is missing, invalid, or expired. Set GEMINI_API_KEY in reviews-service/.env.';
    }
    if (lower.includes('genai not configured') || lower.includes('not configured')) {
      return 'GenAI is not configured. Set GEMINI_API_KEY in reviews-service/.env.';
    }
    const trimmed = msg.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= 180) {
      return `Analysis failed: ${trimmed}`;
    }
    return 'Analysis failed. Check reviews-service logs for details.';
  }

  async getInsights(placeId: string) {
    let insight = await this.insightRepository.findOne({
      where: { place_id: placeId },
      order: { created_at: 'DESC' },
    });
    if (!insight && placeId === DEMO_PLACE_ID) {
      const legacy = await this.insightRepository.findOne({
        where: { place_id: LEGACY_DEMO_PLACE_ID },
        order: { created_at: 'DESC' },
      });
      if (legacy) {
        legacy.place_id = DEMO_PLACE_ID;
        await this.insightRepository.save(legacy);
        insight = legacy;
      }
    }
    return insight ?? null;
  }

  async getReviews(placeId: string) {
    if (placeId === DEMO_PLACE_ID) {
      await this.seedDemoReviewsToDb();
    }
    await this.fillSummariesForPlace(placeId);
    if (placeId === DEMO_PLACE_ID) {
      let reviews = await this.reviewRepository.find({
        where: { place_id: placeId, source: DEMO_SOURCE },
        order: { rating: 'DESC', created_at: 'DESC' },
      });
      if (reviews.length > DEMO_MAX_REVIEWS) {
        reviews = reviews.slice(0, DEMO_MAX_REVIEWS);
      }
      return this.buildReviewsResponse(reviews);
    }
    const reviews = await this.reviewRepository.find({
      where: { place_id: placeId },
      order: { rating: 'DESC', created_at: 'DESC' },
    });
    return this.buildReviewsResponse(reviews);
  }

  /**
   * For reviews that have no summary, asks Gemini to generate a short 2-line summary per review,
   * then saves to DB. Uses batch prompts to stay within token limits.
   */
  private async fillSummariesForPlace(placeId: string): Promise<void> {
    // Demo mode should be fast and fully offline-friendly; don't call Gemini here.
    if (placeId === DEMO_PLACE_ID) {
      return;
    }
    const reviews = await this.reviewRepository.find({
      where: { place_id: placeId },
      order: { id: 'ASC' },
    });
    const needSummary = reviews.filter((r) => !r.summary?.trim());
    if (needSummary.length === 0) return;
    if (!this.genAI) {
      return;
    }
    const BATCH_SIZE = 15;
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    for (let i = 0; i < needSummary.length; i += BATCH_SIZE) {
      const batch = needSummary.slice(i, i + BATCH_SIZE);
      const numbered = batch
        .map((r, idx) => `${idx + 1}. [Rating: ${r.rating}/5]\n${(r.review_text || '').slice(0, 1500)}`)
        .join('\n\n');
      const prompt = `You are given hospital patient reviews. For each review below, write one short summary in 1-2 lines that captures the main point and what (if anything) needs to be fixed. Be accurate and concise.

Return ONLY a JSON array of strings: one summary per review, in the same order (1st summary for review 1, etc). No other text. Example: ["Summary one.", "Summary two."]

Reviews:
${numbered}`;
      try {
        const result = await model.generateContent(prompt);
        let text = (await result.response).text().trim();
        if (text.startsWith('```json')) text = text.slice(7);
        if (text.startsWith('```')) text = text.slice(3);
        if (text.endsWith('```')) text = text.slice(0, -3);
        text = text.trim();
        const summaries: string[] = JSON.parse(text);
        for (let j = 0; j < batch.length && j < summaries.length; j++) {
          const review = batch[j];
          const summary = (summaries[j] || '').trim().slice(0, 500);
          if (summary) {
            review.summary = summary;
            await this.reviewRepository.save(review);
          }
        }
      } catch {
        // Skip batch on parse/API error; fallback to getTwoLineSummary in response
      }
    }
  }

  private buildReviewsResponse(reviews: ExternalReview[]) {
    const ratingDistribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    reviews.forEach((r) => {
      ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1;
    });
    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        author_name: r.author_name,
        author_email: r.author_email ?? null,
        department: r.department ?? null,
        suggested_department: this.suggestDepartment(r.review_text, r.rating),
        rating: r.rating,
        review_text: r.review_text,
        summary: r.summary?.trim() || this.getTwoLineSummary(r.review_text),
        review_time: r.review_time,
        created_at: r.created_at,
      })),
      ratingDistribution,
      total: reviews.length,
    };
  }

  /** Fallback when Gemini summary is not available: first 2 sentences or ~220 chars. */
  private getTwoLineSummary(reviewText: string): string {
    const t = (reviewText || '').trim();
    if (!t) return '';
    const maxLen = 220;
    const sentences = t.split(/(?<=[.!?])\s+/);
    if (sentences.length >= 2) {
      const two = (sentences[0] + ' ' + sentences[1]).trim();
      return two.length <= maxLen ? two : two.slice(0, maxLen).replace(/\s+\S*$/, '');
    }
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen).replace(/\s+\S*$/, '').trim() + '…';
  }

  private suggestDepartment(reviewText: string, rating: number): string {
    const t = (reviewText || '').toLowerCase();
    if (/\bbill|billing|payment|charge|cost|price|money|refund\b/.test(t)) return 'Billing';
    if (/\bdoctor|medical|treatment|surgery|nurse|patient care|diagnosis\b/.test(t)) return 'Medical';
    if (/\bwait|waiting|delay|slow|appointment|schedule\b/.test(t)) return 'Operations';
    if (/\badmin|administration|paperwork|document\b/.test(t)) return 'Admin';
    if (/\bclean|hygiene|facility|room\b/.test(t)) return 'Operations';
    if (rating <= 2) return 'Customer Care';
    return 'Patient Experience';
  }

  async updateReview(
    id: number,
    updates: { author_email?: string | null; department?: string | null },
  ): Promise<ExternalReview> {
    const review = await this.reviewRepository.findOne({ where: { id } });
    if (!review) {
      throw new HttpException('Review not found', HttpStatus.NOT_FOUND);
    }
    if (updates.author_email !== undefined) review.author_email = updates.author_email || null;
    if (updates.department !== undefined) review.department = updates.department || null;
    return await this.reviewRepository.save(review);
  }

  /**
   * DEMO ONLY — Always returns the built-in demo hospital reviews (no cache).
   * Seeds DB and returns; analysis runs on this set. Not for production use.
   */
  async scrapeGoogleReviewsDemo(): Promise<{
    cached: boolean;
    message: string;
    total: number;
    ratingDistribution: Record<number, number>;
    reviews: Array<{
      id: number;
      author_name: string;
      rating: number;
      review_text: string;
      summary?: string;
      review_time: number | null;
      created_at: Date;
      scraped_at?: Date | null;
    }>;
  }> {
    return this.seedAndReturnDemoReviews(
      'Demo: built-in hospital reviews loaded. Run Analysis for insights.',
    );
  }

  /** Sample hospital reviews — used when demo place ID is selected. */
  private static DEMO_REVIEWS_RAW: Array<{ author_name: string; rating: number; text: string }> = [
    {
      author_name: 'Umesh Biradar',
      rating: 2,
      text: `Be aware of the unreasonably expensive charges at this hospital. 35,000 for a regular dental cleaning (27,000) and 3 fillings is steep(2500 each). This included laser assisted cleaning. The entire procedure was little over 75 minutes.

The cost compares to about 8,000-11,000 quoted at another facility nearby. Borderline fraud. Unfortunately, I got to compare costs after the procedure.

Quality of the procedure itself was decent. No complaints or complications. Just that corporate greed seems to have taken over substantially.

Ask before you commit; shop around and compare costs with other facilities.`,
    },
    {
      author_name: 'LAKSHMI SUBRAMONIAN',
      rating: 2,
      text: `We had a very bad experience here. My mother was asked to take an ultrasound scan for abdomen and a Doppler scan for both legs. We had to wait for more than 2 hours to get our slot. The receptionist initially told it will take 1 hour. So we were prepared for that. The patients who came after her were taken for scan. On enquiry the nurse told that since she had to take two scans it will take some time. For others since it was only abdomen scan it will take less time. So they were finishing for others. My mother was referred for total hip replacement surgery the next week and she had to wait for more than 2 hours for the scan. I would like to remind the management that these issues will be small for you but not for the patients. If you value customer satisfaction please try to correct these kind of behaviour from your staff.`,
    },
    {
      author_name: 'C.Mahesh Reddy',
      rating: 1,
      text: `The health check-up process here is extremely disappointing. There is a minimum wait time of two hours at every testing section. I personally had to wait almost three hours for the ultrasound, and as a result, the entire day was spent in the hospital for what is supposed to be a routine health check-up.
If the hospital is unable to handle the patient load, it should not accept so many appointments. The overall process reflects very poor planning and management.
The 4.7 online rating is misleading. There are two staff members actively asking patients for reviews even before the tests begin, likely because they are aware that feedback after completion would not be favorable. These resources would be better utilized in core operational roles to help reduce the excessive waiting times.
Waiting two hours for every section is unacceptable, and to make matters worse, registration alone took 45 minutes. I also attempted to provide feedback on the spot but could not find any responsible person available. The feedback contact shared (Santosh) was unreachable, and there was no customer survey manager at the reception, despite being told that someone named Pooja would be available.
Overall, this was a highly frustrating and disappointing experience. Poor execution, lack of accountability, and inefficient processes made this visit a complete waste of time. Frankly, government hospitals seem far better managed in comparison.`,
    },
    {
      author_name: 'Anushree DA',
      rating: 1,
      text: `I had a lot of faith in this hospital, but remarks after consulting, I realized that this is a money-grubbing hospital. My father took treatment. But the doctor did not come and examine the patient, only Nurses are just the ones who come and give treatment. Just for 3 days 2 lakh bill has been made. We took him to the hospital in the hope of getting him well, but we just gave 2 lakhs to the hospital and he didn't even get better. Only 2 bottles of blood were given. And some tests, they put a bill for that, and We were shocked. And they behaved very negligently, when we called and said that they had not given any treatment, the nurses came and put NS fluid and left. Since we had taken insurance under treatment, it was 11:30pm at night when we were discharged, so at that time we had to pay the remaining bill and leave immediately, otherwise we would have to pay one day's ward rent. Since we had to travel 40kms, we requested that we go in the morning but they did not agree. Then the pharmacy said that they would not discharge anyone at this time. How did they do it? So before going to the hospital, please know this first.`,
    },
    {
      author_name: 'Akhilesh Pg',
      rating: 1,
      text: `Had a very bad experience with doctor ishwar amalazari gastroenterologist. He is just looking ways to loot money from the patients. I have a chronic Gastro problem. I had fever when I met him regarding my issues. He went through all my reports and told me to get blood test done, even though I had blood test report of just 20 days back in the report. As everyone knows blood report won't be accurate during fever, so I told him I'll get it done when I am cured from fever. But still, he didn't write down the gastric tablets when I requested him to give the tablets he indirectly blackmail my dad saying I'll write the tablets down, but if anything happens to him, I'm not responsible. My father got scared and got all my the blood test done for around 4000. After the test, he started forcing me to go to pulmonology department for again consultation which is 1100 rs more. When I told him I'll visit it some other time he got angry. And while giving the tablets he particularly mentioned. I'm only looking for gastric. If you have any other issues, you have to visit someone else. I won't write down any other tablets for you. If this is the case, why did he force me and indirectly blackmail my dad to get my blood test done? This is a daylight robbery. The hospital has many good doctors, but I really didn't expect someone to be money minded like him. Totally disappointed with the experience.`,
    },
    {
      author_name: 'Shreekrishna Karthik B',
      rating: 5,
      text: `Neat and clean hospital. Facility of paid parking is available. Parking fee of ₹20 per first hour and after that ₹10 for every hour for two wheelers. I visited here for corporate health check up. Registered at 7 am morning. Completed all tests at 10.45am. They are providing breakfast with this plan. (any one item Idli vada, rice bath, poori). After completing the tests report follows after 2 hr. After that consultation with doctor will be there. All the reports will be available in the hospital patient app.

Dear hospital team,

I wanted to express my sincere appreciation for the excellent health check services provided to Resil Laboratories employees. The team was professional, and the facilities were top-notch. The process was smooth and efficient, and we appreciate the care taken to ensure our well-being.

Thank you for your dedication to healthcare excellence Mrs Latha and Mr Saran.`,
    },
    {
      author_name: 'Umesh Matapathi',
      rating: 5,
      text: `Dr Satish treating very good 👍 Thank you again for your support and dedication to providing top-notch care. Please keep up the great work! Hospital team. I received excellent care and treatment during my recent visit. The staff were helpful, and the facilities were great. Thank you for your support! 🙏`,
    },
    {
      author_name: 'thirumalesh kothapalli',
      rating: 5,
      text: `I underwent surgery at this hospital and received excellent treatment. From admission to discharge, the care provided was outstanding. Special thanks to Dr. Muralidhar and his entire team for their expert treatment and compassionate care. I would also like to sincerely thank Ms. Rekha from the marketing team for her continuous support and guidance throughout the process. The doctors, nurses, and support staff were very professional, kind, and attentive. I truly felt cared for at every step. Highly recommended.`,
    },
    {
      author_name: 'Ramegowda M',
      rating: 5,
      text: `I am really grateful to the exceptional care provided by doctor Shivakumar and Dr Abhinandan and Neuro science team. The supporting staff including nurses, billing, housekeeping were also very helpful. Overall we had a positive experience. And I would like to thanks Ms Rinisha she helped me in insurance and she guided nicely from admission to till discharge. Overall nice experience at this hospital. Thanks.`,
    },
    {
      author_name: 'Ani C J',
      rating: 5,
      text: `He was struggling to talk and walk. Luckily I could rush him to this hospital and the casualty and neuroscience team headed by Dr Sreenivas M were very quick and cooperative and were happy to receive a patient in emergency.`,
    },
    {
      author_name: 'Sheela G S',
      rating: 5,
      text: `My husband got admitted under Dr. Shivakumar/ Dr Abhinandhan and team neuroscience. I am very satisfied with all services from starting admission to till discharge. I would like to say thanks to nursing, housekeeping they are…`,
    },
    {
      author_name: 'Aum Aadishankaracharya Namah',
      rating: 5,
      text: `My wife has been treating for spine issues with neuroscience team. The doctor name is Dr. Shivakumar Kupunar (NST) and Dr. Mahesh Chandra Pai (General Physician). They diagnosed the issue and treating very well. My wife feels…`,
    },
    {
      author_name: 'Raghavendra Kmurthy',
      rating: 5,
      text: `Excellent service from doctors and all other staff. Hygienic and quality service. Got service from Neuroscience Team, Cardiology and Pulmonology and it's just excellent. Thank you. Now she is doing very well…`,
    },
    {
      author_name: 'Anil Pn Anil',
      rating: 5,
      text: `Thanks for everything especially for neuroscience team, general ward team members, housekeepers, and especially OT member Anjan sir thank you so much. Thank you for Dr Shivakumar and Team. Billing and insurance team is…`,
    },
    {
      author_name: 'Narayana M',
      rating: 5,
      text: `Dr Sunil excellent doctor. They made sure my mother was very comfortable during every minute of the treatment. We would definitely recommend them for any neuroscience related issues.`,
    },
    {
      author_name: 'mayank dwivedi',
      rating: 1,
      text: `I can't give less than one star. Please don't come to this hospital. It's the worst hospital ever, simply looting people's money. They destroyed our child. It's my humble request, please don't visit this hospital Yeshwantpur branch. It's not good…`,
    },
    {
      author_name: 'PACIFIC PRECAST',
      rating: 1,
      text: `Worst experience. They told me to discharge my patient at morning 10 o'clock. Doctor also told the same, but management formalities went up to night 10 o'clock. I literally waited for 12 hours due to mismanagement only.`,
    },
    {
      author_name: 'danish dosani',
      rating: 1,
      text: `I don't even want to give 1 star. Worst hospital to visit. Been there for stomach pain and they gave paracetamol drop literally and asked for ECF for stomach pain and charged 4500 for a drip. They are looting people and no clarity as well…`,
    },
    {
      author_name: 'kshama',
      rating: 1,
      text: `A BIG NO!!!
I had recommended this hospital for my niece's treatment solely because my trusted doctor practices here. I have complete faith in his medical judgment and…`,
    },
    {
      author_name: 'Kavya Sriram',
      rating: 1,
      text: `Horrible experience. Poor communication from the staff, little to no explanation about the condition, neglect from the staff and the doctor, inconsiderate of the pain of the ailment, judgment from the pharmacist. Overall would not recommend.`,
    },
    {
      author_name: 'Shreya J',
      rating: 1,
      text: `One of the worst hospital I have seen. This hospital is only for big and rich people. They will delay for everything. The faculty members are very careless. Even though the patient is alright they…`,
    },
    {
      author_name: 'sumathi c',
      rating: 2,
      text: `Doctors will not be available in given appointment timings. Every time patients need to wait minimum 1–2 hours even if there is any emergency.`,
    },
    {
      author_name: 'Chetna Anjali',
      rating: 1,
      text: `One of the worst medical experiences of my life was at this hospital. The doctors here are only money minded. They keep their profits even above the well being of the patients. I was in extreme pain for 3 days yet they kept…`,
    },
    {
      author_name: 'Nikhil Duddi Ramesh',
      rating: 1,
      text: `Never ever visit here. Everyone are cheaters. I took my dad for simple 3 injections and they admitted him stating some complication and charged me 2 lakhs for 3 days. Really worst hospital and money minded staff. I suspect doctor…`,
    },
    {
      author_name: 'arun kumar',
      rating: 1,
      text: `Never go to this hospital. The service is very bad. The staff are very rude.`,
    },
    {
      author_name: 'Diwakar Narayan',
      rating: 2,
      text: `I went to this hospital for health check-up. The testing procedure was fine, however the doctors' consultation part of the health check plan is botched up. For an OBG consultation, I got sent to two junior doctors, who were very dismissive…`,
    },
    {
      author_name: 'manjunath D',
      rating: 1,
      text: `One of the worst hospital in Bangalore. I lost my father after admitting to this hospital. They will make normal patient serious and put them into ICU bed simply for the sole reason of taking more money. They will charge 80,000 rs for ICU…`,
    },
    {
      author_name: 'Mehran Shifa',
      rating: 1,
      text: `Worst hospital ever seen. They don't give treatment for the patient if billing is pending. They give priority for money rather than the patient's life. I highly recommend to think twice before visiting this hospital.`,
    },
    {
      author_name: 'Vaishnavi M V',
      rating: 1,
      text: `Vile management. One of our relatives was admitted for vomiting. She is around 70 years of age, has hearing problem and is diabetic. Instead of administering relevant treatment, all kinds of irrelevant tests were done and…`,
    },
    {
      author_name: 'Wisvesh B.S.',
      rating: 1,
      text: `Would like to give 0 if Google had that option. Nonsensical layout for the hospital. Was given an appointment for 10 for GI endoscopy. Was not informed prior that an RT-PCR test was required. Was charged INR 700 for the same. No one was…`,
    },
    {
      author_name: 'Shiva kumar M.R',
      rating: 1,
      text: `Don't ever go to this hospital. If you want to live your life, never ever visit this hospital…`,
    },
    {
      author_name: 'G Gouds Sharanagouda',
      rating: 1,
      text: `Hospital authority managed one staff in hospital corridor and patient waiting hall. Her work is only asking to give good ratings in Google. If you say yes she will ask your phone and she only gives 5 star rating.`,
    },
  ];

  /** Ensures DB has exactly the built-in demo reviews (replaces any existing demo data). */
  private async seedDemoReviewsToDb(): Promise<void> {
    await this.reviewRepository.delete({ place_id: DEMO_PLACE_ID });
    const balanced = ReviewsService.DEMO_REVIEWS_RAW.map((r) => ({
      author_name: r.author_name,
      rating: r.rating,
      review_text: r.text,
    }));
    await this.saveScrapedReviews(DEMO_PLACE_ID, DEMO_SOURCE, balanced);
  }

  private async seedAndReturnDemoReviews(message: string): Promise<{
    cached: boolean;
    message: string;
    total: number;
    ratingDistribution: Record<number, number>;
    reviews: Array<{
      id: number;
      author_name: string;
      rating: number;
      review_text: string;
      summary?: string;
      review_time: number | null;
      created_at: Date;
      scraped_at?: Date | null;
    }>;
  }> {
    await this.seedDemoReviewsToDb();
    await this.fillSummariesForPlace(DEMO_PLACE_ID);
    let savedReviews = await this.reviewRepository.find({
      where: { place_id: DEMO_PLACE_ID, source: DEMO_SOURCE },
      order: { created_at: 'ASC' },
    });
    if (savedReviews.length > DEMO_MAX_REVIEWS) {
      savedReviews = savedReviews.slice(0, DEMO_MAX_REVIEWS);
    }
    const ratingDistribution = this.buildRatingDistribution(savedReviews);
    return {
      cached: false,
      message,
      total: savedReviews.length,
      ratingDistribution,
      reviews: savedReviews.map((r) => ({
        id: r.id,
        author_name: r.author_name,
        rating: r.rating,
        review_text: r.review_text,
        summary: r.summary?.trim() || this.getTwoLineSummary(r.review_text),
        review_time: r.review_time,
        created_at: r.created_at,
        scraped_at: r.scraped_at ?? undefined,
        suggested_department: this.suggestDepartment(r.review_text, r.rating),
      })),
    };
  }

  private buildRatingDistribution(
    reviews: Array<{ rating: number }>,
  ): Record<number, number> {
    const dist: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    reviews.forEach((r) => {
      if (r.rating >= 1 && r.rating <= 5) dist[r.rating] = (dist[r.rating] || 0) + 1;
    });
    return dist;
  }

  private parseRating(rating: string | null): number | null {
    if (!rating || typeof rating !== 'string') return null;
    const match = rating.match(/(\d)/);
    if (match) return Math.min(5, Math.max(1, parseInt(match[1], 10)));
    return null;
  }

  private normalizeAndFilter(
    rows: ScrapedReviewRow[],
  ): Array<{ author_name: string; rating: number; review_text: string }> {
    const result: Array<{
      author_name: string;
      rating: number;
      review_text: string;
    }> = [];
    for (const r of rows) {
      const rating = this.parseRating(r.rating);
      if (rating == null || !r.review_text?.trim()) continue;
      result.push({
        author_name: (r.author_name || 'Anonymous').trim(),
        rating,
        review_text: r.review_text.trim(),
      });
    }
    return result;
  }

  private selectBalancedReviews(
    cleaned: Array<{ author_name: string; rating: number; review_text: string }>,
    maxCount: number,
  ): Array<{ author_name: string; rating: number; review_text: string }> {
    const grouped: Record<
      number,
      Array<{ author_name: string; rating: number; review_text: string }>
    > = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    cleaned.forEach((r) => {
      if (grouped[r.rating]) grouped[r.rating].push(r);
    });
    const final: Array<{
      author_name: string;
      rating: number;
      review_text: string;
    }> = [];
    for (let star = 1; star <= 5; star++) {
      final.push(...grouped[star].slice(0, 6));
    }
    return final.slice(0, maxCount);
  }

  private async saveScrapedReviews(
    placeId: string,
    source: string,
    balanced: Array<{ author_name: string; rating: number; review_text: string }>,
  ): Promise<ExternalReview[]> {
    await this.reviewRepository.delete({ place_id: placeId, source });
    const scrapedAt = new Date();
    return Promise.all(
      balanced.map((r) =>
        this.reviewRepository.save(
          this.reviewRepository.create({
            place_id: placeId,
            author_name: r.author_name || 'Anonymous',
            rating: r.rating,
            review_text: r.review_text || '',
            review_time: Math.floor(Date.now() / 1000),
            source,
            scraped_at: scrapedAt,
          }),
        ),
      ),
    );
  }

  /**
   * Runs Playwright scrape (default Maps URL), normalizes and balances to ~30, saves with given placeId and source (e.g. google_scrape).
   */
  async runScraperAndSave(
    placeId: string,
    source: string,
  ): Promise<ExternalReview[]> {
    const rawReviews = await this.runPlaywrightScrape();
    const cleaned = this.normalizeAndFilter(rawReviews);
    const balanced = this.selectBalancedReviews(cleaned, TARGET_REVIEWS);
    if (balanced.length === 0) {
      throw new HttpException(
        'No reviews could be extracted. Google Maps structure may have changed or the page did not load.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.saveScrapedReviews(placeId, source, balanced);
  }

  private async runPlaywrightScrape(): Promise<ScrapedReviewRow[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
      });

      const page = await context.newPage();

      // Use 'commit' instead of 'domcontentloaded' - faster and more reliable for SPAs
      await page.goto(SPARSH_MAPS_URL, {
        waitUntil: 'commit',
        timeout: 30000,
      });

      await page.waitForTimeout(4000);

      const moreReviewsSelectors = [
        'button[jsaction*="pane.reviewChart.moreReviews"]',
        'button[aria-label*="Reviews"]',
        '[data-tab-index="1"]',
        'button:has-text("Reviews")',
      ];
      for (const sel of moreReviewsSelectors) {
        const btn = page.locator(sel).first();
        if ((await btn.count()) > 0) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(3500);
          break;
        }
      }

      const scrollSelector =
        'div[role="main"], [class*="m6QErb"], [class*="scrollable"], div[role="region"]';
      const scrollContainer = page.locator(scrollSelector).first();
      if ((await scrollContainer.count()) > 0) {
        for (let i = 0; i < SCROLL_ITERATIONS; i++) {
          await scrollContainer.evaluate((el) => el.scrollBy(0, 2000));
          await page.waitForTimeout(SCROLL_DELAY_MS);
        }
      }

      let reviews = await this.extractReviewsWithSelectors(page);
      if (reviews.length === 0) {
        reviews = await this.extractReviewsFallback(page);
      }

      return reviews;
    } finally {
      await browser.close();
    }
  }

  private async extractReviewsWithSelectors(page: Page): Promise<ScrapedReviewRow[]> {
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

  private async extractReviewsFallback(page: Page): Promise<ScrapedReviewRow[]> {
    return page.$$eval(
      '[class*="wiI7pd"], [class*="MyEned"]',
      (nodes) => {
        const seen = new Set<string>();
        return nodes
          .map((node) => {
            const reviewText = node.textContent?.trim() ?? null;
            if (!reviewText || reviewText.length < 10 || seen.has(reviewText)) return null;
            seen.add(reviewText);
            const container = node.closest('div[data-review-id]') ?? node.parentElement?.closest('[role="listitem"]') ?? node.parentElement?.parentElement;
            if (!container) return { author_name: null, rating: null, review_text: reviewText };
            const author =
              container.querySelector('[class*="d4r55"]')?.textContent?.trim() ??
              (container.querySelector('button[aria-label]') as HTMLElement)?.ariaLabel ??
              null;
            const star = container.querySelector('[aria-label*="star"], [aria-label*="Star"]') as HTMLElement | null;
            const ratingStr = star?.getAttribute('aria-label') ?? null;
            return { author_name: author, rating: ratingStr, review_text: reviewText };
          })
          .filter((r): r is ScrapedReviewRow => r != null);
      },
    );
  }
}
