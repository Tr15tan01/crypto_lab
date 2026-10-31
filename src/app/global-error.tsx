"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0a0b0d", color: "#e7e9ec", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 420, margin: "20vh auto", textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>Crypto Lab hit an unexpected error</h1>
          <p style={{ color: "#8b929c", fontSize: 14 }}>No data was changed. Try again, or reload the page.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 14px", borderRadius: 5, background: "#e0b354", color: "#17130a", border: 0 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
