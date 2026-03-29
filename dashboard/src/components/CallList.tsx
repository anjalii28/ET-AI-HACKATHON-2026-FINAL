import { CallData } from '../types';
import { useState, useMemo, useEffect } from 'react';
import {
  isActionRequired,
  isHighAnxiety,
  getWaitingSince,
  getSLARemaining,
  getLastTouched,
  getRiskScore,
  getWhyThisMatters,
  getConsequenceHint,
  getHistorySignals,
  getRelatedTo,
} from '../utils/callIntelligence';
import { RELATED_TO_VALUES } from '../types';

interface CallListProps {
  calls: CallData[];
  onCallSelect: (call: CallData) => void;
  searchQuery: string;
  focusMode: boolean;
  onFocusModeChange: (v: boolean) => void;
}

type FilterType = 'ALL' | 'LEAD' | 'TICKET';
type SortType = 'impact' | 'latest' | 'oldest';

function extractCallCategoryFromFilename(filename?: string): string {
  if (!filename) return 'OTHER';
  const upper = filename.toUpperCase();
  if (upper.includes('POST_DISCHARGE') || upper.includes('POSTDISCHARGE')) return 'POST_DISCHARGE';
  if (upper.includes('EMERGENCY')) return 'EMERGENCY';
  if (upper.includes('HOMECARE') || upper.includes('HOME_CARE')) return 'CUSTOMER_CARE';
  if (upper.includes('APPOINTMENT') || upper.includes('APPT')) return 'APPOINTMENT';
  if (upper.includes('CUSTOMER_CARE') || upper.includes('CUSTOMERCARE')) return 'CUSTOMER_CARE';
  return 'OTHER';
}

export function CallList({ calls, onCallSelect, searchQuery, focusMode, onFocusModeChange }: CallListProps) {
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [sortBy, setSortBy] = useState<SortType>('impact');
  const [actionRequiredFilter, setActionRequiredFilter] = useState<'ALL' | 'YES' | 'NO'>('ALL');
  const [callClassificationFilter, setCallClassificationFilter] = useState<string>('ALL');
  const [sentimentFilter, setSentimentFilter] = useState<string>('ALL');
  const [hospitalFilter, setHospitalFilter] = useState<string>('ALL');
  const [callCategoryFilter, setCallCategoryFilter] = useState<string>('ALL');
  const [relatedToFilter, setRelatedToFilter] = useState<string>('ALL');
  const [quickFilter, setQuickFilter] = useState<'all' | 'action' | 'anxiety' | 'repeat'>('all');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const phoneCounts = useMemo(() => {
    const m = new Map<string, number>();
    calls.forEach((c) => {
      const phone = c.phone_number?.trim();
      if (phone) m.set(phone, (m.get(phone) || 0) + 1);
    });
    return m;
  }, [calls]);

    const uniqueValues = useMemo(() => {
    const classifications = new Set<string>();
    const sentiments = new Set<string>();
    const hospitals = new Set<string>();
    const categories = new Set<string>();
    calls.forEach((call) => {
      if (call.call_classification) classifications.add(call.call_classification);
      // Include both customer and agent sentiments, with backward compatibility
      if (call.customer_sentiment_label) sentiments.add(call.customer_sentiment_label);
      if (call.agent_sentiment_label) sentiments.add(`Agent: ${call.agent_sentiment_label}`);
      if (call.sentiment_label) sentiments.add(call.sentiment_label); // Backward compatibility
      if (call.hospital_name) hospitals.add(call.hospital_name);
      categories.add(extractCallCategoryFromFilename(call.filename));
    });
    const categoryOrder = ['APPOINTMENT', 'CUSTOMER_CARE', 'EMERGENCY', 'POST_DISCHARGE', 'OTHER'];
    const sortedCategories = Array.from(categories).sort((a, b) => {
      const iA = categoryOrder.indexOf(a);
      const iB = categoryOrder.indexOf(b);
      if (iA === -1 && iB === -1) return a.localeCompare(b);
      if (iA === -1) return 1;
      if (iB === -1) return -1;
      return iA - iB;
    });
    return {
      classifications: Array.from(classifications).sort(),
      sentiments: Array.from(sentiments).sort(),
      hospitals: Array.from(hospitals).sort(),
      categories: sortedCategories,
    };
  }, [calls]);

  const filteredAndSortedCalls = useMemo(() => {
    let filtered = [...calls];

    if (filter !== 'ALL') {
      filtered = filtered.filter((call) => {
        const rt = call.recordType?.toUpperCase();
        if (filter === 'TICKET') return rt === 'TICKET' || rt === 'TICKET_CONFUSION' || rt === 'CONFUSION';
        return rt === filter;
      });
    }

    if (quickFilter === 'action') {
      filtered = filtered.filter(isActionRequired);
    } else if (quickFilter === 'anxiety') {
      filtered = filtered.filter(isHighAnxiety);
    } else if (quickFilter === 'repeat') {
      filtered = filtered.filter((c) => (c.phone_number && (phoneCounts.get(c.phone_number.trim()) || 0) >= 2));
    }

    if (actionRequiredFilter === 'YES') {
      filtered = filtered.filter(isActionRequired);
    } else if (actionRequiredFilter === 'NO') {
      filtered = filtered.filter((c) => !isActionRequired(c));
    }

    if (callClassificationFilter !== 'ALL') {
      filtered = filtered.filter((c) => c.call_classification === callClassificationFilter);
    }
    if (sentimentFilter !== 'ALL') {
      filtered = filtered.filter((c) => {
        // Check customer sentiment (with backward compatibility)
        if (sentimentFilter.startsWith('Agent: ')) {
          const agentSentiment = sentimentFilter.replace('Agent: ', '');
          return c.agent_sentiment_label === agentSentiment;
        }
        return c.customer_sentiment_label === sentimentFilter || 
               c.sentiment_label === sentimentFilter; // Backward compatibility
      });
    }
    if (hospitalFilter !== 'ALL') {
      filtered = filtered.filter((c) => c.hospital_name === hospitalFilter);
    }
    if (callCategoryFilter !== 'ALL') {
      filtered = filtered.filter((c) => extractCallCategoryFromFilename(c.filename) === callCategoryFilter);
    }

    if (relatedToFilter !== 'ALL') {
      filtered = filtered.filter((c) => getRelatedTo(c).value === relatedToFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((call) => {
        const fields = [
          call.notes,
          call.ticket_solution,
          call.customer_sentiment_summary,
          call.agent_sentiment_summary,
          call.sentiment_summary, // Backward compatibility
          call.customer_name,
          call.doctor_name,
          call.hospital_name,
          call.LeadNotes,
          call.department,
          call.services,
          call.filename,
          call.transcript,
          (call as { ticket_notes?: string }).ticket_notes,
        ];
        return fields.some((f) => f && String(f).toLowerCase().includes(q));
      });
    }

    filtered.sort((a, b) => {
      if (sortBy === 'impact') {
        const isRepeatA = a.phone_number && (phoneCounts.get(a.phone_number.trim()) || 0) >= 2;
        const isRepeatB = b.phone_number && (phoneCounts.get(b.phone_number.trim()) || 0) >= 2;
        const waitA = a.timestamp ? now - new Date(a.timestamp).getTime() : 0;
        const waitB = b.timestamp ? now - new Date(b.timestamp).getTime() : 0;
        const countA = phoneCounts.get(a.phone_number?.trim() || '') || 1;
        const countB = phoneCounts.get(b.phone_number?.trim() || '') || 1;
        const { score: scoreA } = getRiskScore(a, !!isRepeatA, waitA, countA);
        const { score: scoreB } = getRiskScore(b, !!isRepeatB, waitB, countB);
        return scoreB - scoreA;
      }
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return sortBy === 'oldest' ? tA - tB : tB - tA;
    });

    return filtered;
  }, [
    calls,
    filter,
    sortBy,
    actionRequiredFilter,
    callClassificationFilter,
    sentimentFilter,
    hospitalFilter,
    callCategoryFilter,
    relatedToFilter,
    searchQuery,
    quickFilter,
    phoneCounts,
    now,
  ]);

  const getSentimentColor = (sentiment?: string): string => {
    if (!sentiment) return '#64748b';
    const s = sentiment.toLowerCase();
    if (s.includes('positive') || s.includes('happy')) return '#059669';
    if (s.includes('negative') || s.includes('angry') || s.includes('frustrated')) return '#dc2626';
    if (s.includes('neutral')) return '#64748b';
    return '#d97706';
  };

  const getRecordTypeClass = (recordType?: string): string => {
    if (!recordType) return 'unknown';
    const u = recordType.toUpperCase();
    if (u === 'TICKET' || u === 'TICKET_CONFUSION' || u === 'CONFUSION') return 'ticket';
    return recordType.toLowerCase();
  };

  const getDisplayRecordType = (recordType?: string): string => {
    if (!recordType) return 'UNKNOWN';
    const u = recordType.toUpperCase();
    if (u === 'TICKET_CONFUSION' || u === 'CONFUSION') return 'TICKET';
    return recordType;
  };

  return (
    <section className={`dashboard-section calls-section ${focusMode ? 'focus-mode' : ''}`}>
      <h2 className="section-heading">Calls</h2>
      <div className="call-list-card">
      <div className="filters-bar">
        <div className="quick-filters-row">
          <div className="quick-filters">
            <button
              className={`quick-filter-chip ${quickFilter === 'all' ? 'active' : ''}`}
              onClick={() => setQuickFilter('all')}
            >
              All calls
            </button>
            <button
              className={`quick-filter-chip ${quickFilter === 'action' ? 'active' : ''}`}
              onClick={() => setQuickFilter('action')}
            >
              Needs action now
            </button>
            <button
              className={`quick-filter-chip ${quickFilter === 'anxiety' ? 'active' : ''}`}
              onClick={() => setQuickFilter('anxiety')}
            >
              High anxiety
            </button>
            <button
              className={`quick-filter-chip ${quickFilter === 'repeat' ? 'active' : ''}`}
              onClick={() => setQuickFilter('repeat')}
            >
              Repeat callers
            </button>
          </div>
          <label className="focus-mode-toggle">
            <input
              type="checkbox"
              checked={focusMode}
              onChange={(e) => onFocusModeChange(e.target.checked)}
            />
            <span className="focus-mode-label">
              Focus Mode: Critical only
            </span>
          </label>
        </div>

        <div className="filters-row">
          <div className="filter-group">
            <label>Record type</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as FilterType)}>
              <option value="ALL">All</option>
              <option value="LEAD">Lead</option>
              <option value="TICKET">Ticket</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Action required</label>
            <select value={actionRequiredFilter} onChange={(e) => setActionRequiredFilter(e.target.value as 'ALL' | 'YES' | 'NO')}>
              <option value="ALL">All</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Classification</label>
            <select value={callClassificationFilter} onChange={(e) => setCallClassificationFilter(e.target.value)}>
              <option value="ALL">All</option>
              {uniqueValues.classifications.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Sentiment</label>
            <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)}>
              <option value="ALL">All</option>
              {uniqueValues.sentiments.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Hospital</label>
            <select value={hospitalFilter} onChange={(e) => setHospitalFilter(e.target.value)}>
              <option value="ALL">All</option>
              {uniqueValues.hospitals.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Category</label>
            <select value={callCategoryFilter} onChange={(e) => setCallCategoryFilter(e.target.value)}>
              <option value="ALL">All</option>
              {uniqueValues.categories.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Related to</label>
            <select value={relatedToFilter} onChange={(e) => setRelatedToFilter(e.target.value)}>
              <option value="ALL">All</option>
              {RELATED_TO_VALUES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Sort by</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortType)}>
              <option value="impact">Risk first</option>
              <option value="latest">Latest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <div className="results-count">
            {filteredAndSortedCalls.length} of {calls.length} calls
            {focusMode && ' (critical only)'}
          </div>
        </div>
      </div>

      <div className="call-list">
        {filteredAndSortedCalls.length === 0 ? (
          <div className="empty-state">
            {focusMode
              ? 'No critical calls. Turn off Focus Mode to see all.'
              : searchQuery.trim() || quickFilter !== 'all'
                ? 'No calls match your filters or search.'
                : 'No calls loaded.'}
          </div>
        ) : (
          filteredAndSortedCalls.map((call, index) => {
            const actionReq = isActionRequired(call);
            const phoneCount = phoneCounts.get(call.phone_number?.trim() || '') || 1;
            const isRepeat = phoneCount >= 2;
            const waiting = getWaitingSince(call.timestamp, now);
            const sla = getSLARemaining(call.timestamp, call.filename, now);
            const lastTouched = getLastTouched(call.timestamp, now);
            const { score: riskScore, tier: riskTier } = getRiskScore(call, isRepeat, waiting.ms, phoneCount);
            const whyMatters = getWhyThisMatters(call, phoneCount);
            const consequence = getConsequenceHint(call, riskScore, isRepeat);
            const historySignals = getHistorySignals(call, phoneCount);
            const callerName = call.customer_name || 'Unknown caller';
            const isCritical = riskTier === 'high' || (actionReq && riskTier === 'medium');

            return (
              <div
                key={call.filename || `call-${index}`}
                className={`call-row ${actionReq ? 'action-required' : ''} ${focusMode && isCritical ? 'focus-mode-row' : ''}`}
                onClick={() => onCallSelect(call)}
              >
                <div className="call-row-risk">
                  <span className={`risk-score risk-${riskTier}`} title={`Risk score: ${riskScore}/100`}>
                    {riskScore}
                  </span>
                  <span className="risk-tier">{riskTier}</span>
                </div>

                <div className="call-row-main">
                  <div className="call-row-header">
                    <span className="call-row-caller">{callerName}</span>
                    {historySignals.map((sig, i) => (
                      <span key={i} className="history-signal" title={sig.label}>
                        {sig.short}
                      </span>
                    ))}
                  </div>
                  <div className="call-row-why">{whyMatters}</div>
                  {consequence && (
                    <div className="call-row-consequence">If ignored: {consequence}</div>
                  )}
                  <div className="call-row-time">
                    <span title="Waiting since call received">Waiting: {waiting.text}</span>
                    <span className={`sla-badge sla-${sla.urgency}`} title="SLA countdown">
                      {sla.text}
                    </span>
                    <span title="Last activity">Last: {lastTouched}</span>
                  </div>
                </div>

                <div className="call-row-meta">
                  <div className="call-row-badges">
                    <span className={`record-type-badge ${getRecordTypeClass(call.recordType)}`}>
                      {getDisplayRecordType(call.recordType)}
                    </span>
                    {call.call_classification && (
                      <span className="classification-badge">{call.call_classification}</span>
                    )}
                    {actionReq && <span className="action-badge">Action</span>}
                  </div>
                  <div className="sentiment-pill">
                    {(call.customer_sentiment_label || call.sentiment_label) && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span
                          className="sentiment-dot"
                          style={{ backgroundColor: getSentimentColor(call.customer_sentiment_label || call.sentiment_label) }}
                        />
                        <span>C: {call.customer_sentiment_label || call.sentiment_label || 'Unknown'}</span>
                      </span>
                    )}
                    {call.agent_sentiment_label && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
                        <span
                          className="sentiment-dot"
                          style={{ backgroundColor: getSentimentColor(call.agent_sentiment_label) }}
                        />
                        <span>A: {call.agent_sentiment_label}</span>
                      </span>
                    )}
                    {!call.customer_sentiment_label && !call.sentiment_label && !call.agent_sentiment_label && (
                      <span>Unknown</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      </div>
    </section>
  );
}
