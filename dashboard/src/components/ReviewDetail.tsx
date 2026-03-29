import { useState, useEffect } from 'react';
import axios from 'axios';

export interface ReviewForDetail {
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

const DEPARTMENT_OPTIONS = [
  '— Select department —',
  'Customer Care',
  'Billing',
  'Medical',
  'Operations',
  'Admin',
  'Patient Experience',
  'Quality',
  'Other',
];

interface ReviewDetailProps {
  review: ReviewForDetail | null;
  onClose: () => void;
  onUpdate: (updated: ReviewForDetail) => void;
}

export function ReviewDetail({ review, onClose, onUpdate }: ReviewDetailProps) {
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (review) {
      setEmail(review.author_email ?? '');
      setDepartment(review.department ?? review.suggested_department ?? '');
    }
  }, [review]);

  if (!review) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await axios.patch(`/reviews/review/${review.id}`, {
        author_email: email.trim() || null,
        department: department && department !== DEPARTMENT_OPTIONS[0] ? department : null,
      });
      onUpdate({ ...review, author_email: res.data.author_email, department: res.data.department });
    } finally {
      setSaving(false);
    }
  };

  const dateStr = review.review_time
    ? new Date(review.review_time * 1000).toLocaleDateString()
    : new Date(review.created_at).toLocaleDateString();

  return (
    <div className="review-detail-overlay" onClick={onClose}>
      <div className="review-detail-content" onClick={(e) => e.stopPropagation()}>
        <div className="review-detail-header">
          <h2>Review</h2>
          <button type="button" className="review-detail-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="review-detail-body">
          <section className="review-detail-section">
            <h3>Username</h3>
            <p className="review-detail-username">{review.author_name}</p>
          </section>

          <section className="review-detail-section">
            <h3>Email (optional — to reply)</h3>
            <input
              type="email"
              className="review-detail-input"
              placeholder="e.g. customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </section>

          <section className="review-detail-section">
            <h3>
              Department to handle
              {review.suggested_department && (
                <span className="review-detail-suggested">Suggested: {review.suggested_department}</span>
              )}
            </h3>
            <select
              className="review-detail-select"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              {DEPARTMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt === DEPARTMENT_OPTIONS[0] ? '' : opt}>
                  {opt}
                </option>
              ))}
            </select>
          </section>

          <section className="review-detail-section">
            <h3>Rating</h3>
            <p className="review-detail-rating">
              {'⭐'.repeat(review.rating)}
              {'☆'.repeat(5 - review.rating)} ({review.rating}/5)
            </p>
          </section>

          {review.summary && (
            <section className="review-detail-section review-detail-summary-wrap">
              <h3>Summary</h3>
              <p className="review-detail-summary">{review.summary}</p>
            </section>
          )}
          <section className="review-detail-section">
            <h3>Full review</h3>
            <p className="review-detail-text">{review.review_text}</p>
          </section>

          <section className="review-detail-section">
            <span className="review-detail-date">{dateStr}</span>
          </section>

          <div className="review-detail-actions">
            <button
              type="button"
              className="review-detail-save"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save email & department'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
