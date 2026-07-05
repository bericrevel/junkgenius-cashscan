import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Last-resort error boundary. Without it, one unexpected render crash
 * unmounts React and leaves a silent white screen — the worst possible
 * failure for a non-technical user. This shows a plain-language message
 * and a restart button instead.
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            background: "#f2ede3",
            color: "#1a1a1a",
            fontFamily: "Inter, sans-serif",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 40 }}>😖</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Something broke.</div>
          <div style={{ fontSize: 14, color: "#4a4a4a", maxWidth: 280 }}>
            Not your fault. Your tracked sales are safe. Tap below to restart.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: "14px 28px",
              borderRadius: 12,
              border: "none",
              background: "#1a1a1a",
              color: "#f2ede3",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            RESTART
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
