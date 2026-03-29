import { ProcessingStats } from '../types';
import { calculateInsights } from '../utils/dataLoader';
import { CallData } from '../types';
import {
  getTimePressureMetrics,
  getTrendData,
  getAIInsight,
  isActionRequired,
  getFollowUpReason,
  FOLLOW_UP_REASONS,
  getRelatedTo,
  getSLARemaining,
} from '../utils/callIntelligence';

interface ProcessingOverviewProps {
  stats: ProcessingStats;
  calls: CallData[];
}

export function ProcessingOverview({ stats, calls }: ProcessingOverviewProps) {
  const insights = calculateInsights(calls);
  const timePressure = getTimePressureMetrics(calls);
  const trend = getTrendData(calls);
  const aiInsight = getAIInsight(calls);

  const pendingCount = calls.filter(isActionRequired).length;
  const oldestPending = timePressure.oldestPendingHours;
  const oldestText =
    oldestPending >= 1
      ? `${Math.floor(oldestPending)}h ${Math.round((oldestPending % 1) * 60)}m`
      : 'None';

  const hasAlerts = timePressure.breachIn1h > 0 || timePressure.overdue > 0;

  const reasonCounts = FOLLOW_UP_REASONS.map((reason) => ({
    reason,
    count: calls.filter((c) => getFollowUpReason(c).reason === reason).length,
  })).filter((r) => r.count > 0);

  // Pending Billing callbacks: action-required calls with Related To = Billing
  const pendingBillingCallbacks = calls.filter((c) => {
    if (!isActionRequired(c)) return false;
    const relatedTo = getRelatedTo(c);
    return relatedTo.value === 'Billing';
  }).length;

  // Appointment follow-ups overdue: overdue appointment-related follow-ups
  const now = Date.now();
  const appointmentFollowUpsOverdue = calls.filter((c) => {
    if (!isActionRequired(c)) return false;
    const followUpReason = getFollowUpReason(c).reason;
    if (followUpReason !== 'Appointment') return false;
    const sla = getSLARemaining(c.timestamp, c.filename, now);
    return sla.isOverdue;
  }).length;

  return (
    <div className="overview-container">
      {/* Alerts section - compact, only when relevant */}
      <section className="dashboard-section alerts-section">
        <h2 className="section-heading">Alerts</h2>
        <div className="alerts-bar">
          {hasAlerts ? (
            <>
              {timePressure.breachIn1h > 0 && (
                <span className="alert-item alert-urgent">
                  {timePressure.breachIn1h} call{timePressure.breachIn1h !== 1 ? 's' : ''} will breach SLA in 1h
                </span>
              )}
              {timePressure.overdue > 0 && (
                <span className="alert-item alert-overdue">
                  {timePressure.overdue} overdue follow-up{timePressure.overdue !== 1 ? 's' : ''}
                </span>
              )}
            </>
          ) : (
            <span className="alert-item alert-success">All callbacks on track</span>
          )}
        </div>
      </section>

      {/* AI Insight - compact strip */}
      <section className="dashboard-section ai-section">
        <h2 className="section-heading">AI Insight</h2>
        <p className="ai-text">{aiInsight}</p>
      </section>

      {/* Analytics - main metrics in clean grid */}
      <section className="dashboard-section analytics-section">
        <h2 className="section-heading">Analytics</h2>
        <div className="analytics-grid">
          <div className="analytics-col metrics-col">
            <h3 className="subsection-heading">Key metrics</h3>
            <div className="metrics-grid">
              <div className={`metric-card ${insights.needsAction > 0 ? 'highlight' : ''}`} data-type="action">
                <span className="metric-value">{insights.needsAction}</span>
                <span className="metric-label">Needs action</span>
              </div>
              <div className={`metric-card ${insights.highAnxiety > 0 ? 'highlight' : ''}`} data-type="anxiety">
                <span className="metric-value">{insights.highAnxiety}</span>
                <span className="metric-label">High anxiety</span>
              </div>
              <div className={`metric-card ${insights.repeatCallers > 0 ? 'highlight' : ''}`} data-type="repeat">
                <span className="metric-value">{insights.repeatCallers}</span>
                <span className="metric-label">Repeat callers</span>
              </div>
              <div className="metric-card" data-type="total">
                <span className="metric-value">{stats.total}</span>
                <span className="metric-label">Total calls</span>
              </div>
              <div className="metric-card" data-type="lead">
                <span className="metric-value">{stats.lead}</span>
                <span className="metric-label">Leads</span>
              </div>
              <div className="metric-card" data-type="ticket">
                <span className="metric-value">{stats.ticket}</span>
                <span className="metric-label">Tickets</span>
              </div>
            </div>
          </div>
          <div className="analytics-col trends-col">
            <h3 className="subsection-heading">Today</h3>
            <div className="trends-list">
              <div className="trend-row">
                <span className="trend-label">Anxiety calls</span>
                <span className="trend-value">{trend.anxietyPct}%</span>
              </div>
              <div className="trend-row">
                <span className="trend-label">Emergency calls</span>
                <span className="trend-value">{trend.emergencyCount}</span>
              </div>
              <div className="trend-row">
                <span className="trend-label">Action required</span>
                <span className="trend-value">{trend.actionPct}%</span>
              </div>
            </div>
          </div>
          <div className="analytics-col workload-col">
            <h3 className="subsection-heading">Workload</h3>
            <div className="workload-list">
              <div className="workload-row">
                <span className="workload-label">Pending actions</span>
                <span className="workload-value">{pendingCount}</span>
              </div>
              <div className="workload-row">
                <span className="workload-label">Oldest pending</span>
                <span className="workload-value">{oldestText}</span>
              </div>
              {pendingBillingCallbacks > 0 && (
                <div className="workload-row">
                  <span className="workload-label">Pending Billing callbacks</span>
                  <span className="workload-value">{pendingBillingCallbacks}</span>
                </div>
              )}
              {appointmentFollowUpsOverdue > 0 && (
                <div className="workload-row">
                  <span className="workload-label">Appointment follow-ups overdue</span>
                  <span className="workload-value">{appointmentFollowUpsOverdue}</span>
                </div>
              )}
            </div>
            {reasonCounts.length > 0 && (
              <>
                <h3 className="subsection-heading" style={{ marginTop: '1rem' }}>By reason</h3>
                <div className="reason-counts">
                  {reasonCounts.slice(0, 5).map(({ reason, count }) => (
                    <span key={reason} className="reason-count-chip">
                      {reason} {count}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
