"use client";
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body style={{ background: "#0a1120", color: "#e8edf6", fontFamily: "system-ui", padding: "3rem", margin: 0 }}>
    <main style={{ maxWidth: "32rem", margin: "auto" }}><p>POS INVENTORY</p><h1>We couldn’t load the app</h1>
      <p>Please try again. Check transaction history before repeating a sale or payment.</p>
      {error.digest && <p>Support reference: {error.digest.replace(/[^a-zA-Z0-9_-]/g, "").slice(0,64)}</p>}
      <button onClick={retry} style={{ padding: "0.75rem 1.25rem" }}>Try again</button>
    </main>
  </body></html>;
}
