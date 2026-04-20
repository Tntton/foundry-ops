'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif',
          margin: 0,
          padding: 48,
          color: '#1a1a17',
          backgroundColor: '#fafaf8',
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Application error</h1>
        <p style={{ color: '#4a4945', marginTop: 12 }}>
          Foundry Ops failed to render. Please refresh; if it keeps happening, capture the
          digest below and send to the admin.
        </p>
        {error.digest && (
          <p style={{ fontFamily: 'ui-monospace, monospace', color: '#8b8984', fontSize: 12 }}>
            digest: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          style={{
            marginTop: 16,
            padding: '8px 16px',
            background: '#688b71',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
