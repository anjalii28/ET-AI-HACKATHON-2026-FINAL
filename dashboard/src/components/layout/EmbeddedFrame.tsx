import './EmbeddedFrame.css';

/** Leads iframe URL: Twenty CRM (direct iframe from port 3002 - Twenty allows iframe embedding). */
const LEADS_IFRAME_SRC = 'http://localhost:3002';

interface EmbeddedFrameProps {
  /** URL to load in the iframe (optional; defaults to LEADS_IFRAME_SRC for Leads view) */
  src?: string;
  /** URL for “Open in new tab” / Cloud fallback (defaults to src) */
  openUrl?: string;
  /** Optional second inbox URL (e.g. another Chatwoot inbox in the same account) */
  openUrl2?: string;
  /** Label for the second link (default: “Inbox 2”) */
  openUrl2Label?: string;
  /** Label for the primary open link when openUrl2 is set (default: “Inbox 1”) */
  openUrlLabel?: string;
  /** Optional title for accessibility */
  title?: string;
  /** Shown when embed is blocked; also used for “open in new tab” */
  appLabel?: string;
  /** Cover Chatwoot top-left workspace name (parent-page overlay; iframe must be cross-origin). */
  coverChatwootBranding?: boolean;
  /** Show the blue “Open … in new tab” bar above the iframe (Leads/Twenty: set false). */
  showOpenInNewTabBar?: boolean;
  /** Cover Twenty workspace name in the embedded sidebar (Leads only; same idea as Chatwoot overlays). */
  coverTwentyWorkspace?: boolean;
  /** When false, hide the Inbox 1 / Inbox 2 tab row (Tickets with two open URLs). */
  showInboxTabLinks?: boolean;
}

/** Chatwoot Cloud and similar send X-Frame-Options / CSP so the app never renders inside our iframe. */
function cannotEmbedInIframe(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    return host === 'app.chatwoot.com' || host === 'www.chatwoot.com';
  } catch {
    return false;
  }
}

function isRecursiveDashboardIframe(src: string, origin: string): boolean {
  if (!origin) return false;

  if (
    src === origin + '/app' ||
    src === origin + '/app/' ||
    src.startsWith(origin + '/app/tickets') ||
    src.startsWith(origin + '/app/leads') ||
    src.startsWith(origin + '/app/feedback') ||
    src.startsWith(origin + '/app/calls') ||
    (src.startsWith('/app') && !src.includes('..'))
  ) {
    return true;
  }

  // Vite dev (5173/5174): same-origin / or /app/* loads this SPA → nested sidebars if embedded
  try {
    const u = new URL(src, origin);
    const o = new URL(origin);
    if (u.origin !== o.origin) return false;
    const port = o.port || (o.protocol === 'https:' ? '443' : '80');
    const isViteDev = port === '5173' || port === '5174';
    if (!isViteDev) return false;
    const path = (u.pathname || '/').replace(/\/$/, '') || '/';
    if (path === '/' || path === '/app' || path.startsWith('/app/')) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Full-height, borderless iframe for embedding external apps (Chatwoot/Tickets, Twenty/Leads).
 * Blocks recursive loads (dashboard loading itself) but allows same-origin apps at different paths.
 */
function OpenTabLinks({
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel: string;
}) {
  return (
    <div className="embedded-frame-open-tabs">
      <a className="embedded-frame-external-link embedded-frame-external-link-bar" href={primaryHref} target="_blank" rel="noopener noreferrer">
        {primaryLabel}
      </a>
      {secondaryHref ? (
        <a className="embedded-frame-external-link embedded-frame-external-link-bar" href={secondaryHref} target="_blank" rel="noopener noreferrer">
          {secondaryLabel}
        </a>
      ) : null}
    </div>
  );
}

export function EmbeddedFrame({
  src = LEADS_IFRAME_SRC,
  openUrl,
  openUrl2,
  openUrl2Label = 'Inbox 1',
  openUrlLabel = 'Inbox 2',
  title = 'Embedded content',
  appLabel = 'this app',
  coverChatwootBranding = false,
  showOpenInNewTabBar = true,
  coverTwentyWorkspace = false,
  showInboxTabLinks = true,
}: EmbeddedFrameProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const linkHref = openUrl ?? src;
  const hasTwoInboxes = Boolean(openUrl2?.trim());

  const isRecursive = typeof window !== 'undefined' && isRecursiveDashboardIframe(src, origin);
  const isCloudNoEmbed = typeof window !== 'undefined' && cannotEmbedInIframe(src);

  if (typeof window !== 'undefined' && isRecursive) {
    console.error('[EmbeddedFrame] Iframe would load this dashboard inside itself — blocked. Fix VITE_* URL for', appLabel);
  }

  if (typeof window !== 'undefined' && isCloudNoEmbed) {
    console.warn(
      '[EmbeddedFrame]',
      appLabel,
      'URL is Chatwoot Cloud — embedding is blocked by Chatwoot. Opening in a new tab is required.',
    );
  }

  const safeSrc = isRecursive ? 'about:blank' : src;

  return (
    <div className="embedded-frame-container">
      {isRecursive ? (
        <div className="embedded-frame-fallback" role="status">
          <p className="embedded-frame-fallback-title">Cannot embed {appLabel} here</p>
          <p className="embedded-frame-fallback-text">
            The URL would load this dashboard inside the frame (nested layout). Set{' '}
            <code className="embedded-frame-code">VITE_CHATWOOT_URL</code> (Tickets) or{' '}
            <code className="embedded-frame-code">VITE_TWENTY_URL</code> (Leads) to the real app — e.g. local
            Chatwoot on <code className="embedded-frame-code">http://localhost:3001</code>, or with nginx use{' '}
            <code className="embedded-frame-code">http://localhost</code> for Chatwoot at site root.
          </p>
          <p className="embedded-frame-fallback-text">
            After logging out of Chatwoot, open it in a new tab to sign in again (some browsers restrict cookies
            inside iframes).
          </p>
        </div>
      ) : isCloudNoEmbed ? (
        <div className="embedded-frame-fallback embedded-frame-fallback-cloud" role="status">
          <p className="embedded-frame-fallback-title">Chatwoot Cloud cannot load inside Call Intelligence</p>
          <p className="embedded-frame-fallback-text">
            <strong>app.chatwoot.com</strong> blocks embedding in other sites (browser security). Logging in elsewhere
            does not change that — the iframe here will always stay empty.
          </p>
          <p className="embedded-frame-fallback-text">
            Use the button below to open your inbox in a full tab. Optional: set{' '}
            <code className="embedded-frame-code">VITE_CHATWOOT_OPEN_URL</code> in <code className="embedded-frame-code">dashboard/.env.local</code> to
            your exact inbox URL (e.g. <code className="embedded-frame-code">…/inbox/95015</code>).
          </p>
          {hasTwoInboxes ? (
            <div className="embedded-frame-cta-row">
              <a className="embedded-frame-cta" href={linkHref} target="_blank" rel="noopener noreferrer">
                {openUrlLabel}
              </a>
              <a className="embedded-frame-cta" href={openUrl2!.trim()} target="_blank" rel="noopener noreferrer">
                {openUrl2Label}
              </a>
            </div>
          ) : (
            <a className="embedded-frame-cta" href={linkHref} target="_blank" rel="noopener noreferrer">
              Open {appLabel} in new tab
            </a>
          )}
          <p className="embedded-frame-fallback-hint">
            If the app tab shows a black main area only, try a hard refresh (Cmd+Shift+R), another browser, or disable
            ad blockers — that is separate from this dashboard.
          </p>
        </div>
      ) : (
        <>
          {showOpenInNewTabBar ? (
            hasTwoInboxes && showInboxTabLinks ? (
              <OpenTabLinks
                primaryHref={linkHref}
                primaryLabel={openUrlLabel}
                secondaryHref={openUrl2!.trim()}
                secondaryLabel={openUrl2Label}
              />
            ) : hasTwoInboxes && !showInboxTabLinks ? null : (
              <a className="embedded-frame-external-link embedded-frame-external-link-bar" href={linkHref} target="_blank" rel="noopener noreferrer">
                Open {appLabel} in new tab (login or if embed is empty)
              </a>
            )
          ) : null}
          <div className="embedded-frame-iframe-wrap">
            {coverChatwootBranding ? (
              <>
                <div className="chatwoot-overlay chatwoot-overlay--top" aria-hidden />
                <div className="chatwoot-overlay chatwoot-overlay--bottom" aria-hidden />
              </>
            ) : coverTwentyWorkspace ? (
              <div className="twenty-workspace-overlay" aria-hidden />
            ) : null}
            <iframe
              src={safeSrc}
              title={title}
              className="embedded-frame"
              frameBorder={0}
              allowFullScreen
            />
          </div>
        </>
      )}
    </div>
  );
}
