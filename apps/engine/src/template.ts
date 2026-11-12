import { randomUUID } from "node:crypto";

export interface TemplateContext {
  body: Record<string, unknown>;
  query: Record<string, unknown>;
  params: Record<string, string>;
}

function lookup(ctx: TemplateContext, expr: string): unknown {
  if (expr === "uuid") return randomUUID();
  if (expr === "now") return new Date().toISOString();
  const [root, ...rest] = expr.split(".");
  // Seules les racines autorisées par le cahier des charges sont lues : pas d'expressions arbitraires.
  if (root !== "body" && root !== "query" && root !== "params") return "";
  let cur: unknown = ctx[root];
  for (const key of rest) {
    if (cur && typeof cur === "object" && key in (cur as object)) cur = (cur as Record<string, unknown>)[key];
    else return "";
  }
  return cur ?? "";
}

/** Remplace récursivement les gabarits {{...}} dans une valeur de réponse. */
export function render(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
    if (whole) return lookup(ctx, whole[1]);
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, expr: string) => String(lookup(ctx, expr)));
  }
  if (Array.isArray(value)) return value.map((v) => render(v, ctx));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v, ctx)]));
  }
  return value;
}

export function parseDelay(delay?: string): number {
  if (!delay) return 0;
  const m = delay.match(/^([0-9]+)(ms|s)$/);
  if (!m) return 0;
  const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
  return Math.min(ms, 30_000);
}
