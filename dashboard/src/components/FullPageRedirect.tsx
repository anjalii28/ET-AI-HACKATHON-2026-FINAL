import { useEffect } from 'react';

/**
 * Performs a full-page navigation to the given URL (e.g. / for Chatwoot).
 * Used so the entire page becomes the proxied app — no iframe.
 */
export function FullPageRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.href = to;
  }, [to]);
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      Redirecting…
    </div>
  );
}
