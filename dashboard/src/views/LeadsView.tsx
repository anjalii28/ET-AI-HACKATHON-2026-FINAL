import { EmbeddedFrame } from '../components/layout/EmbeddedFrame';
import { EXTERNAL_APP_URLS } from '../config';

/**
 * Leads view: Twenty UI embedded via iframe at http://localhost:3002 (direct iframe - Twenty allows iframe embedding).
 * URL configurable via VITE_TWENTY_URL.
 */
export function LeadsView() {
  return (
    <EmbeddedFrame
      src={EXTERNAL_APP_URLS.TWENTY}
      title="Leads - Twenty"
      appLabel="Twenty CRM"
      showOpenInNewTabBar={false}
      coverTwentyWorkspace
    />
  );
}
