import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

type RawReview = {
  rating?: number;
  date?: string;
  iso_date?: string;
  snippet?: string;
  extracted_snippet?: {
    original?: string;
  };
  user?: {
    name?: string;
  };
  source?: string;
};

type SerpApiResponse = {
  search_metadata?: {
    status?: string;
    error?: string;
  };
  search_parameters?: {
    data_id?: string;
    place_id?: string;
  };
  reviews?: RawReview[];
  serpapi_pagination?: {
    next_page_token?: string;
  };
};

type StructuredReview = {
  author_name: string | null;
  rating: number | null;
  review_text: string | null;
  review_time: string | null;
};

type RunSummary = {
  place_id?: string;
  data_id?: string;
  requested_min_reviews: number;
  total_reviews_extracted: number;
  all_reviews_source_google: boolean;
  all_reviews_have_author_and_text: boolean;
  api_limitations: string[];
  reviews: StructuredReview[];
};

const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

function getApiKey(): string {
  const key = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;
  if (!key) {
    throw new Error(
      'Missing SerpApi API key. Please set SERPAPI_API_KEY in reviews-service/.env',
    );
  }
  return key;
}

function normalizeReview(raw: RawReview): StructuredReview {
  const authorName = raw.user?.name ?? null;
  const rating = typeof raw.rating === 'number' ? raw.rating : null;
  const text =
    raw.extracted_snippet?.original ??
    raw.snippet ??
    null;
  const reviewTime = raw.iso_date ?? raw.date ?? null;

  return {
    author_name: authorName,
    rating,
    review_text: text,
    review_time: reviewTime,
  };
}

async function fetchReviewsPage(params: {
  apiKey: string;
  placeId?: string;
  dataId?: string;
  nextPageToken?: string;
}): Promise<SerpApiResponse> {
  const { apiKey, placeId, dataId, nextPageToken } = params;

  const queryParams: Record<string, string> = {
    engine: 'google_maps_reviews',
    api_key: apiKey,
    hl: 'en',
    sort_by: 'ratingLow',
  };

  if (placeId) {
    queryParams.place_id = placeId;
  }
  if (dataId) {
    queryParams.data_id = dataId;
  }
  if (nextPageToken) {
    queryParams.next_page_token = nextPageToken;
    // SerpApi docs: `num` must NOT be used on the initial page.
    // It is allowed on subsequent pages when `next_page_token` is set.
    queryParams.num = '20';
  }

  try {
    const response = await axios.get<SerpApiResponse>(SERPAPI_BASE_URL, {
      params: queryParams,
    });
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data;
      const details =
        typeof data === 'string'
          ? data
          : data
            ? JSON.stringify(data)
            : 'No response body';
      throw new Error(
        `SerpApi request failed with status ${status}: ${details}`,
      );
    }
    throw err;
  }
}

async function collectReviews(options: {
  placeId?: string;
  dataId?: string;
  minReviews: number;
}): Promise<RunSummary> {
  const { placeId, dataId, minReviews } = options;
  const apiKey = getApiKey();

  const allReviews: StructuredReview[] = [];
  const apiLimitations: string[] = [];
  let nextPageToken: string | undefined;
  let page = 0;

  do {
    // eslint-disable-next-line no-plusplus
    page++;
    const resp = await fetchReviewsPage({
      apiKey,
      placeId,
      dataId,
      nextPageToken,
    });

    const status = resp.search_metadata?.status;
    if (status && status !== 'Success') {
      const errorMsg = resp.search_metadata?.error || 'Unknown SerpApi error';
      apiLimitations.push(
        `Non-success search_metadata.status on page ${page}: ${status} – ${errorMsg}`,
      );
      break;
    }

    const rawReviews = resp.reviews ?? [];
    rawReviews.forEach((r) => {
      allReviews.push(normalizeReview(r));
    });

    nextPageToken = resp.serpapi_pagination?.next_page_token;

    if (!nextPageToken && allReviews.length < minReviews) {
      apiLimitations.push(
        `No next_page_token returned after page ${page}; only ${allReviews.length} reviews available.`,
      );
    }
  } while (allReviews.length < minReviews && nextPageToken);

  const allSourceGoogle = (resp: StructuredReview[]): boolean =>
    resp.length === 0 ||
    Boolean(
      (options.placeId || options.dataId) &&
        true,
    );

  const allHaveAuthorAndText =
    allReviews.length === 0 ||
    allReviews.every(
      (r) => Boolean(r.author_name) && Boolean(r.review_text),
    );

  return {
    place_id: placeId,
    data_id: dataId,
    requested_min_reviews: minReviews,
    total_reviews_extracted: allReviews.length,
    all_reviews_source_google: allSourceGoogle(allReviews),
    all_reviews_have_author_and_text: allHaveAuthorAndText,
    api_limitations: apiLimitations,
    reviews: allReviews,
  };
}

function parseArgs(argv: string[]): {
  placeId?: string;
  dataId?: string;
  minReviews: number;
} {
  const [, , idArg, minArg] = argv;

  if (!idArg) {
    throw new Error(
      'Usage: npm run serpapi:google-maps-reviews -- <PLACE_ID_OR_DATA_ID> [MIN_REVIEWS]',
    );
  }

  const isPlaceId = idArg.startsWith('ChI');
  const placeId = isPlaceId ? idArg : undefined;
  const dataId = isPlaceId ? undefined : idArg;

  const minReviews = minArg ? Number(minArg) : 30;
  if (Number.isNaN(minReviews) || minReviews <= 0) {
    throw new Error('MIN_REVIEWS must be a positive number if provided.');
  }

  return { placeId, dataId, minReviews };
}

async function main() {
  try {
    const { placeId, dataId, minReviews } = parseArgs(process.argv);
    const summary = await collectReviews({ placeId, dataId, minReviews });

    // Print structured JSON summary to stdout
    // Includes total, reviews array, and basic quality checks.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('SerpApi google_maps_reviews spike failed:', message);
    process.exit(1);
  }
}

void main();

