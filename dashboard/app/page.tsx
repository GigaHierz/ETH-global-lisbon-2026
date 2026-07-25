// Home page — placeholder until the real design is uploaded.
// The agent demo lives at /agent-demo; the marketplace at /exchange.

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 600, color: "var(--ink)" }}>
        Home page placeholder
      </h1>
      <p style={{ color: "var(--ink-muted)" }}>Design coming soon.</p>
      <nav style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
        <a
          href="/agent-demo"
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.5rem 1rem",
          }}
        >
          Agent demo →
        </a>
        <a
          href="/exchange"
          style={{
            color: "var(--accent)",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.5rem 1rem",
          }}
        >
          Exchange →
        </a>
      </nav>
    </main>
  );
}
