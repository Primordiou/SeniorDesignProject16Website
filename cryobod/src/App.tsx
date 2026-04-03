export default function App() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.title}>Cryobod</h1>
        <p style={styles.subtitle}>
          Cold therapy. Reimagined.
        </p>

        <button style={styles.button}>
          Get Started
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(to bottom, #020617, #0F172A)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "sans-serif",
  },
  container: {
    textAlign: "center" as const,
  },
  title: {
    fontSize: "64px",
    fontWeight: 700,
    color: "#E0F2FE",
    marginBottom: "10px",
  },
  subtitle: {
    fontSize: "18px",
    color: "#94A3B8",
    marginBottom: "30px",
  },
  button: {
    background: "#2563EB",
    color: "white",
    border: "none",
    padding: "12px 24px",
    fontSize: "16px",
    borderRadius: "12px",
    cursor: "pointer",
    boxShadow: "0 0 20px rgba(37, 99, 235, 0.5)",
  },
};