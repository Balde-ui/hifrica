// Propriétaire : Dev A (A5) — section « Historique des webhooks » de la page Paramètres.
// Lit GET /api/projects/:id/webhook-deliveries (50 dernières tentatives, une ligne par tentative).
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api.js";
import { Empty, Icon, SkeletonRows, StatusCode, formatDate } from "../ui.js";

interface WebhookDelivery {
  id: string;
  deliveryId: string;
  requestId: string | null;
  event: string;
  attempt: number;
  outcome: "success" | "http_error" | "network_error" | "timeout" | "blocked" | "no_url" | "no_secret";
  statusCode: number | null;
  durationMs: number;
  destinationHost: string | null;
  createdAt: string;
}

const OUTCOMES: Record<WebhookDelivery["outcome"], { label: string; kind: "ok" | "warn" | "err" | "info"; hint: string }> = {
  success: { label: "Livré", kind: "ok", hint: "Votre serveur a répondu 2xx." },
  http_error: { label: "Erreur HTTP", kind: "err", hint: "Code 3xx, 4xx ou 5xx (relance sur 5xx, 408 et 429)." },
  network_error: { label: "Erreur réseau", kind: "err", hint: "Connexion impossible : relance automatique." },
  timeout: { label: "Délai dépassé", kind: "warn", hint: "Pas de réponse en 5 s : relance automatique." },
  blocked: { label: "Bloqué", kind: "err", hint: "Adresse privée ou schéma interdit (protection SSRF)." },
  no_url: { label: "Pas d'URL", kind: "info", hint: "Le projet n'a pas d'URL de webhook : rien n'est envoyé." },
  no_secret: { label: "Secret indisponible", kind: "err", hint: "Secret du projet indéchiffrable côté serveur : rien n'est envoyé." },
};

export function WebhookHistory({ projectId }: { projectId: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ deliveries: WebhookDelivery[] }>(`/api/projects/${projectId}/webhook-deliveries`);
      setDeliveries(r.deliveries);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId]);

  useEffect(() => {
    setDeliveries(null);
    void refresh();
  }, [refresh]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Historique des webhooks</h2>
          <p className="small muted" style={{ marginTop: "0.2rem" }}>Les 50 dernières tentatives : une ligne par tentative (4 au plus par envoi).</p>
        </div>
        <button className="btn btn-sm btn-icon" onClick={() => void refresh()} aria-label="Actualiser" title="Actualiser">
          <Icon name="refresh" />
        </button>
      </div>
      {!deliveries && error ? (
        <Empty icon="alert" title="Historique indisponible">{error}</Empty>
      ) : !deliveries ? (
        <SkeletonRows rows={3} cols={5} />
      ) : deliveries.length === 0 ? (
        <Empty icon="send" title="Aucun webhook envoyé pour l'instant" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Événement</th>
                <th className="num">Tentative</th>
                <th>Résultat</th>
                <th>Code HTTP</th>
                <th className="num hide-sm">Durée</th>
                <th className="hide-sm">Hôte</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const o = OUTCOMES[d.outcome] ?? { label: d.outcome, kind: "info" as const, hint: "" };
                return (
                  <tr key={d.id}>
                    <td className="xs">{formatDate(d.createdAt)}</td>
                    <td className="mono xs">{d.event}</td>
                    <td className="num">{d.attempt}</td>
                    <td>
                      <span className={`badge badge-${o.kind}`} title={o.hint}>
                        {o.label}
                      </span>
                    </td>
                    <td>
                      <StatusCode status={d.statusCode} />
                    </td>
                    <td className="num hide-sm">{d.durationMs} ms</td>
                    <td className="mono xs hide-sm">{d.destinationHost ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
