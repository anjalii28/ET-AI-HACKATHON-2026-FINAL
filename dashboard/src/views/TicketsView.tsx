import { EmbeddedFrame } from '../components/layout/EmbeddedFrame';
import { EXTERNAL_APP_URLS } from '../config';

/**
 * Tickets view: Chatwoot — iframe only when the host allows embedding (self-hosted).
 * Chatwoot Cloud is link-only (see EmbeddedFrame).
 */
export function TicketsView() {
  const open2 = EXTERNAL_APP_URLS.CHATWOOT_OPEN_2?.trim();
  return (
    <EmbeddedFrame
      src={EXTERNAL_APP_URLS.CHATWOOT}
      openUrl={EXTERNAL_APP_URLS.CHATWOOT_OPEN}
      openUrl2={open2 || undefined}
      title="Tickets - Chatwoot"
      appLabel="Chatwoot"
      coverChatwootBranding
      showInboxTabLinks={false}
    />
  );
}
