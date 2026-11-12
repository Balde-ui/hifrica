// Propriétaire : Dev A
// Limite d'usage de l'assistant IA, en mémoire (fenêtre glissante).
// TODO(C2) : quota par compte en base quand l'auth existe (la mémoire est perdue au redémarrage
// et n'est pas partagée entre plusieurs instances).

export type QuotaResult = { ok: true; remaining: number } | { ok: false; retryAfter: number };

export class Quota {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit = 10,
    readonly windowMs = 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consomme une génération pour `key` (l'IP du client) ; retryAfter est en secondes. */
  consume(key: string): QuotaResult {
    const now = this.now();
    if (this.hits.size > 10_000) this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true, remaining: this.limit - recent.length };
  }

  /** Supprime les IP sans génération récente (évite que la Map grossisse indéfiniment). */
  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}
