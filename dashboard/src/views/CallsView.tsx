import { useState, useEffect } from 'react';
import { CallData } from '../types';
import { loadCallData, calculateStats } from '../utils/dataLoader';
import { ProcessingOverview } from '../components/ProcessingOverview';
import { CallList } from '../components/CallList';
import { CallDetail } from '../components/CallDetail';

/**
 * Calls view: existing Call Intelligence dashboard.
 * Preserves all existing behavior and routes.
 */
export function CallsView() {
  const [calls, setCalls] = useState<CallData[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await loadCallData();
        const dataWithFilenames = data.map((call, index) => ({
          ...call,
          filename: call.filename || `call_${index + 1}.json`,
        }));
        setCalls(dataWithFilenames);
      } catch (error) {
        console.error('Error loading call data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const stats = calculateStats(calls);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner">Loading call data...</div>
      </div>
    );
  }

  return (
    <div className="app calls-view-wrapper">
      <header className="app-header">
        <div className="header-content">
          <div className="header-title">
            <p className="subtitle">Processed call reports for QA and operations</p>
          </div>
          <div className="header-search">
            <input
              type="text"
              className="global-search-input"
              placeholder="Search notes, resolution, doctor, hospital"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      <main className="app-main">
        <ProcessingOverview stats={stats} calls={calls} />
        <CallList
          calls={calls}
          onCallSelect={setSelectedCall}
          searchQuery={searchQuery}
          focusMode={focusMode}
          onFocusModeChange={setFocusMode}
        />
      </main>

      {selectedCall && (
        <CallDetail call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  );
}
