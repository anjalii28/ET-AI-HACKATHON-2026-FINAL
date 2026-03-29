import { CallData } from '../types';
import { getRelatedTo, getNextStep, isNoActionNeeded } from '../utils/callIntelligence';

interface CallDetailProps {
  call: CallData | null;
  onClose: () => void;
}

export function CallDetail({ call, onClose }: CallDetailProps) {
  if (!call) return null;

  // Determine if action is required (matching the filter logic)
  const getActionRequired = (actionReq?: boolean | string): boolean => {
    if (typeof actionReq === 'boolean') {
      return actionReq === true;
    }
    if (typeof actionReq === 'string') {
      const upper = String(actionReq).trim().toUpperCase();
      // Check for various "action required" patterns
      return (
        upper === 'TRUE' ||
        upper === 'YES' ||
        upper === 'CALLBACK_REQUIRED' ||
        upper === 'ACTION_REQUIRED' ||
        upper === 'REQUIRED' ||
        upper.includes('REQUIRED') ||
        upper.includes('CALLBACK') ||
        (upper.includes('ACTION') && !upper.includes('NO_ACTION'))
      );
    }
    return false;
  };

  const actionRequiredRaw = getActionRequired(call.action_required);
  const noActionNeeded = isNoActionNeeded(call);
  const actionRequired = noActionNeeded ? false : actionRequiredRaw;

  const getSentimentColor = (sentiment?: string): string => {
    if (!sentiment) return '#64748b';
    const s = sentiment.toLowerCase();
    if (s.includes('positive') || s.includes('happy')) return '#34d399';
    if (s.includes('negative') || s.includes('angry') || s.includes('frustrated')) return '#f87171';
    if (s.includes('neutral')) return '#94a3b8';
    return '#fbbf24';
  };

  const formatTimestamp = (timestamp?: string): string => {
    if (!timestamp) return 'Not available';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getFollowUps = (): string[] => {
    if (!call.follow_ups) return [];
    
    if (Array.isArray(call.follow_ups)) {
      // Handle array of strings or objects
      return call.follow_ups.map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (typeof item === 'object' && item !== null) {
          // Convert object to readable string
          const parts: string[] = [];
          const followUpObj = item as { doctor?: string; department?: string; follow_up_time?: string };
          if (followUpObj.doctor) parts.push(`Doctor: ${followUpObj.doctor}`);
          if (followUpObj.department) parts.push(`Department: ${followUpObj.department}`);
          if (followUpObj.follow_up_time) parts.push(`Time: ${followUpObj.follow_up_time}`);
          return parts.length > 0 ? parts.join(', ') : JSON.stringify(item);
        }
        return String(item);
      });
    }
    
    if (typeof call.follow_ups === 'string') {
      try {
        const parsed = JSON.parse(call.follow_ups);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              const parts: string[] = [];
              const followUpObj = item as { doctor?: string; department?: string; follow_up_time?: string };
              if (followUpObj.doctor) parts.push(`Doctor: ${followUpObj.doctor}`);
              if (followUpObj.department) parts.push(`Department: ${followUpObj.department}`);
              if (followUpObj.follow_up_time) parts.push(`Time: ${followUpObj.follow_up_time}`);
              return parts.length > 0 ? parts.join(', ') : JSON.stringify(item);
            }
            return String(item);
          });
        }
        return [call.follow_ups];
      } catch {
        return [call.follow_ups];
      }
    }
    
    return [];
  };

  const getRecordTypeClass = (recordType?: string): string => {
    if (!recordType) return 'unknown';
    const upper = recordType.toUpperCase();
    if (upper === 'TICKET' || upper === 'TICKET_CONFUSION' || upper === 'CONFUSION') {
      return 'ticket';
    }
    return recordType.toLowerCase();
  };

  const getDisplayRecordType = (recordType?: string): string => {
    if (!recordType) return 'UNKNOWN';
    const upper = recordType.toUpperCase();
    if (upper === 'TICKET_CONFUSION' || upper === 'CONFUSION') {
      return 'TICKET';
    }
    return recordType;
  };

  return (
    <div className="call-detail-overlay" onClick={onClose}>
      <div className="call-detail-content" onClick={(e) => e.stopPropagation()}>
        <div className="call-detail-header">
          <h2>Call Report</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="call-detail-body">
          {/* Action Required Banner */}
          {actionRequired && (
            <div className="action-required-banner">
              <strong>ACTION REQUIRED</strong>
            </div>
          )}

          {/* File Info */}
          <section className="detail-section">
            <h3>File Information</h3>
            <div className="detail-grid">
              <div className="detail-item full-width">
                <span className="detail-label">File Name:</span>
                <span className="detail-value filename-value">{call.filename || 'Not specified'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Timestamp:</span>
                <span className="detail-value">{formatTimestamp(call.timestamp)}</span>
              </div>
            </div>
          </section>

          {/* Record Type & Classification */}
          <section className="detail-section">
            <h3>Call Classification</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Record Type:</span>
                <span className={`record-type-badge ${getRecordTypeClass(call.recordType)}`}>
                  {getDisplayRecordType(call.recordType)}
                </span>
              </div>
              {call.call_classification && (
                <div className="detail-item">
                  <span className="detail-label">Classification:</span>
                  <span className="detail-value">{call.call_classification}</span>
                </div>
              )}
            </div>
          </section>

          {/* Call Summary */}
          {(call.notes || call.LeadNotes) && (
            <section className="detail-section">
              <h3>Call Summary</h3>
              <div className="detail-text-content">{String(call.notes || call.LeadNotes || '')}</div>
            </section>
          )}

          {/* Transcript */}
          {call.transcript && (
            <section className="detail-section">
              <h3>Transcript</h3>
              <div className="detail-text-content">{call.transcript}</div>
            </section>
          )}

          {/* Ticket Solution */}
          {call.ticket_solution && (
            <section className="detail-section">
              <h3>What Happened in the Call</h3>
              <div className="detail-text-content">{String(call.ticket_solution)}</div>
            </section>
          )}

          {/* Sentiment Analysis */}
          {(call.customer_sentiment_label || call.customer_sentiment_summary || 
            call.agent_sentiment_label || call.agent_sentiment_summary ||
            call.sentiment_label || call.sentiment_summary) && (
            <section className="detail-section">
              <h3>Sentiment Analysis</h3>
              <div className="detail-grid">
                {/* Customer Sentiment */}
                {(call.customer_sentiment_label || call.customer_sentiment_summary || 
                  call.sentiment_label || call.sentiment_summary) && (
                  <div className="detail-item full-width">
                    <span className="detail-label">Customer Sentiment:</span>
                    <div style={{ marginTop: '4px' }}>
                      {(call.customer_sentiment_label || call.sentiment_label) && (
                        <span className="detail-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="sentiment-dot"
                            style={{ backgroundColor: getSentimentColor(call.customer_sentiment_label || call.sentiment_label) }}
                          />
                          {call.customer_sentiment_label || call.sentiment_label}
                        </span>
                      )}
                      {(call.customer_sentiment_summary || call.sentiment_summary) && (
                        <div style={{ marginTop: '4px', fontSize: '0.9em', color: '#64748b' }}>
                          {call.customer_sentiment_summary || call.sentiment_summary}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {/* Agent Sentiment */}
                {(call.agent_sentiment_label || call.agent_sentiment_summary) && (
                  <div className="detail-item full-width">
                    <span className="detail-label">Agent Sentiment/Tone:</span>
                    <div style={{ marginTop: '4px' }}>
                      {call.agent_sentiment_label && (
                        <span className="detail-value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="sentiment-dot"
                            style={{ backgroundColor: getSentimentColor(call.agent_sentiment_label) }}
                          />
                          {call.agent_sentiment_label}
                        </span>
                      )}
                      {call.agent_sentiment_summary && (
                        <div style={{ marginTop: '4px', fontSize: '0.9em', color: '#64748b' }}>
                          {call.agent_sentiment_summary}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Action Status */}
          <section className="detail-section">
            <h3>Action Status</h3>
            <div className="detail-grid detail-grid-action">
              <div className="detail-item">
                <span className="detail-label">Action Required:</span>
                <span className={`detail-value ${actionRequired ? 'action-yes' : 'action-no'}`}>
                  {actionRequired ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          </section>

          {/* Ticket / Follow-up section - show when ticket or raw action/follow-up so we can display "No action" */}
          {(call.recordType?.toUpperCase() === 'TICKET' || actionRequiredRaw || actionRequired || call.follow_up_required) && (
            <section className="detail-section">
              <h3>Ticket / Follow-up</h3>
              <div className="detail-grid">
                {(() => {
                  const relatedTo = getRelatedTo(call);
                  return (
                    <div className="detail-item">
                      <span className="detail-label">Related to:</span>
                      <span className="detail-value detail-value-muted">{relatedTo.value}</span>
                    </div>
                  );
                })()}
                {(() => {
                  const noAction = isNoActionNeeded(call);
                  const nextStep = noAction ? null : getNextStep(call);
                  const displayStep = noAction ? 'No action' : nextStep;
                  return displayStep ? (
                    <div className="detail-item">
                      <span className="detail-label">Next step:</span>
                      <span className={`detail-value ${noAction ? 'detail-value-muted' : 'detail-value-prominent'}`}>{displayStep}</span>
                    </div>
                  ) : null;
                })()}
              </div>
            </section>
          )}

          {/* Follow-ups */}
          {getFollowUps().length > 0 && (
            <section className="detail-section">
              <h3>Follow-up Actions</h3>
              <ul className="follow-up-list">
                {getFollowUps().map((followUp, index) => (
                  <li key={index}>{followUp}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Contact Information */}
          {(call.customer_name || call.doctor_name || call.hospital_name || call.department || call.services) && (
            <section className="detail-section">
              <h3>Contact Information</h3>
              <div className="detail-grid">
                {call.customer_name && (
                  <div className="detail-item">
                    <span className="detail-label">Customer:</span>
                    <span className="detail-value">{call.customer_name}</span>
                  </div>
                )}
                {call.doctor_name && (
                  <div className="detail-item">
                    <span className="detail-label">Doctor:</span>
                    <span className="detail-value">{call.doctor_name}</span>
                  </div>
                )}
                {call.hospital_name && (
                  <div className="detail-item">
                    <span className="detail-label">Hospital:</span>
                    <span className="detail-value">{call.hospital_name}</span>
                  </div>
                )}
                {call.department && (
                  <div className="detail-item">
                    <span className="detail-label">Department:</span>
                    <span className="detail-value">{String(call.department)}</span>
                  </div>
                )}
                {call.services && (
                  <div className="detail-item full-width">
                    <span className="detail-label">Services:</span>
                    <span className="detail-value">{String(call.services)}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
