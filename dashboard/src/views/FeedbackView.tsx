import { useState, useEffect } from 'react';
import axios from 'axios';
import { ReviewDetail } from '../components/ReviewDetail';
import type { ReviewForDetail } from '../components/ReviewDetail';
import './FeedbackView.css';

interface Review {
  id: number;
  author_name: string;
  author_email?: string | null;
  department?: string | null;
  suggested_department?: string;
  rating: number;
  review_text: string;
  summary?: string;
  review_time: number | null;
  created_at: string;
}

interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

interface Insights {
  sentiment_summary: {
    positive: number;
    neutral: number;
    negative: number;
  };
  top_positive_themes: string[];
  top_complaints: string[];
  risk_keywords: string[];
  executive_summary: string;
  improvement_opportunities?: string[];
}

interface ReviewsData {
  reviews: Review[];
  ratingDistribution: RatingDistribution;
  total: number;
}

const DEFAULT_PLACE_ID = 'demo_hospital'; // Built-in demo reviews (no Google Place)
/** Example Google Place ID for testing (generic hospital — not tied to a brand in the UI). */
const EXAMPLE_HOSPITAL_PLACE_ID = 'ChIJ448M01Y-rjsRTczIOZHyjso';
const DEMO_CACHE_KEY = 'feedback_demo_hospital_v3';

function formatFeedbackError(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : String(raw ?? '');
  const lower = s.toLowerCase();
  if (
    lower.includes('api key') ||
    lower.includes('expired') ||
    lower.includes('api_key') ||
    lower.includes('generativelanguage') ||
    lower.includes('genai') ||
    lower.includes('not configured')
  ) {
    return 'AI analysis needs a valid GEMINI_API_KEY in reviews-service/.env (renew the key if it expired).';
  }
  const oneLine = s.split('\n')[0]?.trim() || 'Something went wrong';
  return oneLine.length > 220 ? `${oneLine.slice(0, 217)}…` : oneLine;
}

export function FeedbackView() {
  const [placeId, setPlaceId] = useState(DEFAULT_PLACE_ID);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewsData, setReviewsData] = useState<ReviewsData | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNegativeOnly, setShowNegativeOnly] = useState(true);
  const [selectedReview, setSelectedReview] = useState<ReviewForDetail | null>(null);

  const fetchReviewsFromGoogle = async () => {
    const id = placeId?.trim() || '';
    if (!id) {
      setError('Enter a Google Place ID first');
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const response = await axios.get('/reviews/fetch', {
        params: { placeId: id },
      });
      const data = response.data;
      setReviewsData(data);
      setInsights(null);
      if (data.total === 0) {
        setError(
          'Google returned 0 reviews for this place. Check the Place ID (use the correct one from Place ID Finder) or use the built-in demo hospital reviews from the default field.',
        );
      } else {
        await runAnalysis(id);
      }
    } catch (err: any) {
      const msg = formatFeedbackError(
        err.response?.data?.message || err.message || 'Failed to fetch reviews from Google',
      );
      setError(msg);
    } finally {
      setFetching(false);
    }
  };

  const runAnalysis = async (
    placeIdToUse: string,
    options?: { silent?: boolean },
  ) => {
    setAnalyzing(true);
    if (!options?.silent) {
      setError(null);
    }
    try {
      const response = await axios.post('/reviews/analyze', null, {
        params: { placeId: placeIdToUse },
      });
      setInsights(response.data);
    } catch (err: any) {
      if (!options?.silent) {
        setError(
          formatFeedbackError(err.response?.data?.message || err.message || 'Analysis failed'),
        );
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const loadData = async () => {
    setError(null);
    if (placeId === DEFAULT_PLACE_ID) {
      try {
        const cached = localStorage.getItem(DEMO_CACHE_KEY);
        if (cached) {
          const { reviewsData: cachedData, insights: cachedInsights } = JSON.parse(cached);
          const hasAnalysis =
            cachedInsights &&
            typeof cachedInsights.executive_summary === 'string' &&
            cachedInsights.executive_summary.trim().length > 0;
          if (cachedData?.total > 0 && hasAnalysis) {
            setReviewsData(cachedData);
            setInsights(cachedInsights);
            return;
          }
        }
      } catch {
        // ignore parse error, fetch below
      }
    }

    setLoading(true);
    try {
      const reviewsResponse = await axios.get('/reviews/list', {
        params: { placeId },
      });
      const data = reviewsResponse.data;
      setReviewsData(data);

      const insightsResponse = await axios.get('/reviews/insights', {
        params: { placeId },
      });
      let insightsData = insightsResponse.data ?? null;
      setInsights(insightsData);

      if (placeId === DEFAULT_PLACE_ID) {
        if (!data.total || data.total === 0) {
          try {
            const demoRes = await axios.get('/reviews/fetch-demo');
            const demo = demoRes.data;
            const reviews = demo.reviews || [];
            const total = reviews.length;
            const ratingDistribution = demo.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            const demoData = { reviews, ratingDistribution, total };
            setReviewsData(demoData);
            try {
              await runAnalysis(DEFAULT_PLACE_ID, { silent: true });
              const updatedInsights = await axios
                .get('/reviews/insights', { params: { placeId: DEFAULT_PLACE_ID } })
                .then((r) => r.data);
              setInsights(updatedInsights ?? null);
              insightsData = updatedInsights ?? null;
            } catch {
              // GenAI missing or analysis failed — UI shows "No analysis" with hint
            }
            localStorage.setItem(
              DEMO_CACHE_KEY,
              JSON.stringify({ reviewsData: demoData, insights: insightsData }),
            );
          } catch (_) {
            // ignore
          }
        } else {
          if (!insightsData?.executive_summary?.trim()) {
            try {
              await runAnalysis(DEFAULT_PLACE_ID, { silent: true });
              const again = await axios
                .get('/reviews/insights', { params: { placeId: DEFAULT_PLACE_ID } })
                .then((r) => r.data);
              insightsData = again ?? null;
              setInsights(insightsData);
            } catch {
              // leave null
            }
          }
          localStorage.setItem(
            DEMO_CACHE_KEY,
            JSON.stringify({ reviewsData: data, insights: insightsData }),
          );
        }
      }
    } catch (err: any) {
      setError(
        formatFeedbackError(err.response?.data?.message || err.message || 'Failed to load data'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [placeId]);

  const positivePercent = insights
    ? Math.round(insights.sentiment_summary.positive)
    : reviewsData
    ? Math.round(
        (reviewsData.reviews.filter((r) => r.rating >= 4).length / reviewsData.total) * 100
      )
    : 0;

  const negativePercent = insights
    ? Math.round(insights.sentiment_summary.negative)
    : reviewsData
    ? Math.round(
        (reviewsData.reviews.filter((r) => r.rating <= 2).length / reviewsData.total) * 100
      )
    : 0;

  // Get negative reviews (1-2 stars) for improvement analysis
  const negativeReviews = reviewsData
    ? reviewsData.reviews.filter((r) => r.rating <= 2)
    : [];

  // Get improvement opportunities from insights or generate from negative reviews
  const improvementOpportunities = insights?.improvement_opportunities || 
    (insights?.top_complaints || []).map(complaint => `Address: ${complaint}`);

  if (loading) {
    return (
      <div className="feedback-loading">
        <div className="loading-spinner">Loading review data...</div>
      </div>
    );
  }

  return (
    <div className="feedback-view">
      <div className="feedback-header">
        <div className="feedback-header-content">
          <h1>Review Intelligence</h1>
          <div className="feedback-controls">
            <div className="feedback-place-row">
              <div className="feedback-input-row">
                <input
                  type="text"
                  className="feedback-place-input"
                  placeholder="Paste Place ID (e.g. from Place ID Finder)"
                  value={placeId}
                  onChange={(e) => setPlaceId(e.target.value)}
                />
                <button
                  type="button"
                  className="feedback-btn feedback-btn-small feedback-btn-link"
                  onClick={() => setPlaceId(EXAMPLE_HOSPITAL_PLACE_ID)}
                  title="Insert example Google Place ID for a hospital"
                >
                  Use example hospital ID
                </button>
              </div>
              <p className="feedback-place-hint">
                To get the correct Place ID: open{' '}
                <a
                  href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Place ID Finder
                </a>
                , search for your hospital by name, open the correct listing, and copy the Place ID. Each location has a different ID.
              </p>
            </div>
            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-btn feedback-btn-small feedback-btn-api"
                onClick={fetchReviewsFromGoogle}
                disabled={fetching}
                title="Fetch up to 5 reviews from Google Places API"
              >
                {fetching ? '...' : 'Get reviews from Google'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="feedback-error">
          <p>{error}</p>
        </div>
      )}

      {reviewsData && reviewsData.total > 0 ? (
        <>
        <div className="feedback-content">
          {/* Section 1: Customers (summary at top) */}
          <h2 className="feedback-section-title">Customers</h2>
          <div className="feedback-overview">
            <div className="feedback-card">
              <div className="feedback-card-label">Total Reviews</div>
              <div className="feedback-card-value">{reviewsData.total}</div>
            </div>
            <div className="feedback-card">
              <div className="feedback-card-label">Positive %</div>
              <div className="feedback-card-value feedback-positive">{positivePercent}%</div>
            </div>
            <div className="feedback-card">
              <div className="feedback-card-label">Negative %</div>
              <div className="feedback-card-value feedback-negative">{negativePercent}%</div>
            </div>
          </div>

          {/* Reviews of customers — at top, right after summary */}
          <div className="feedback-section">
            <div className="feedback-section-header">
              <h2 className="feedback-section-title">Reviews</h2>
              <button
                type="button"
                className="feedback-filter-btn"
                onClick={() => setShowNegativeOnly(!showNegativeOnly)}
              >
                {showNegativeOnly ? 'Show All' : 'Negative only'}
              </button>
            </div>
            <div className="feedback-reviews-list">
              {(showNegativeOnly ? negativeReviews : reviewsData.reviews)
                .sort((a, b) => a.rating - b.rating)
                .map((review) => (
                  <div
                    key={review.id}
                    role="button"
                    tabIndex={0}
                    className={`feedback-review-row ${review.rating <= 2 ? 'feedback-review-negative' : ''}`}
                    onClick={() => setSelectedReview(review as ReviewForDetail)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedReview(review as ReviewForDetail);
                      }
                    }}
                  >
                    <span className="feedback-review-row-rating">
                      {'⭐'.repeat(review.rating)} ({review.rating}/5)
                    </span>
                    <span className="feedback-review-row-author">{review.author_name}</span>
                    <span className="feedback-review-row-dept" title={review.department ? undefined : `Suggested: ${review.suggested_department || ''}`}>
                      {review.department || review.suggested_department || '—'}
                    </span>
                    <span className="feedback-review-row-preview" title={review.review_text}>
                      {review.summary || review.review_text}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Section 2: AI Analysis — Critical Issues, Summary, What's Working Well, Improvement Opportunities at end */}
          {insights ? (
            <>
              {/* Critical Issues — second after customers summary (overview cards above) */}
              {insights.top_complaints.length > 0 && (
                <div className="feedback-section">
                  <h2 className="feedback-section-title">Critical Issues to Address</h2>
                  <div className="feedback-risks">
                    <ul className="feedback-risks-list">
                      {insights.top_complaints.map((complaint, idx) => (
                        <li key={idx} className="feedback-risk-item">
                          {complaint}
                        </li>
                      ))}
                    </ul>
                    {negativeReviews.length > 0 && (
                      <div className="feedback-risk-alert">
                        {negativeReviews.length} negative reviews ({negativePercent}%) require immediate attention
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Executive Summary */}
              <div className="feedback-section">
                <h2 className="feedback-section-title">Executive Summary</h2>
                <div className="feedback-summary-card">
                  <p className="feedback-summary-text">{insights.executive_summary}</p>
                </div>
              </div>

              {/* What's Working Well */}
              {insights.top_positive_themes.length > 0 && (
                <div className="feedback-section">
                  <h2 className="feedback-section-title">What's Working Well</h2>
                  <div className="feedback-themes">
                    {insights.top_positive_themes.map((theme, idx) => (
                      <span key={idx} className="feedback-theme-chip">
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Improvement Opportunities — at end */}
              {improvementOpportunities.length > 0 && (
                <div className="feedback-section feedback-improvement-section">
                  <h2 className="feedback-section-title">Improvement Opportunities</h2>
                  <div className="feedback-improvements">
                    {improvementOpportunities.map((opportunity, idx) => (
                      <div key={idx} className="feedback-improvement-item">
                        <span className="improvement-number">{idx + 1}</span>
                        <span className="improvement-text">{opportunity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="feedback-section">
              <div className="feedback-no-insights">
                <p>{analyzing ? 'Analyzing reviews...' : 'No analysis available yet.'}</p>
              </div>
            </div>
          )}
        </div>

        {selectedReview && (
          <ReviewDetail
            review={selectedReview}
            onClose={() => setSelectedReview(null)}
            onUpdate={(updated) => {
              if (!reviewsData) return;
              setReviewsData({
                ...reviewsData,
                reviews: reviewsData.reviews.map((r) =>
                  r.id === updated.id
                    ? { ...r, author_email: updated.author_email, department: updated.department }
                    : r,
                ),
              });
              setSelectedReview(updated);
            }}
          />
        )}
        </>
      ) : (
        <div className="feedback-empty">
          <p>No reviews loaded. 30 demo reviews load automatically for the demo place, or enter a Google Place ID and click <strong>Get reviews from Google</strong> (up to 5).</p>
          <p className="feedback-empty-hint">
            Example hospital Place ID: <code className="feedback-place-id">{EXAMPLE_HOSPITAL_PLACE_ID}</code>
            <button
              type="button"
              className="feedback-copy-id"
              onClick={() => {
                setPlaceId(EXAMPLE_HOSPITAL_PLACE_ID);
              }}
            >
              Use this ID
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
