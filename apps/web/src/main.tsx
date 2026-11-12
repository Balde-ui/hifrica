import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [api, setApi] = useState("vérification…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { status: string }) => setApi(d.status === "ok" ? "en ligne" : "erreur"))
      .catch(() => setApi("injoignable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "64px auto", padding: "0 16px" }}>
      <h1>Hifrica</h1>
      <p>Simulateurs communautaires de paiement mobile, d'USSD et de SMS pour tester les apps africaines.</p>
      <p>
        API : <strong>{api}</strong>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
