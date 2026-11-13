// Génère LICENSES.md (article 6 CADEV : composants tiers et licences) à partir de
// `pnpm licenses list --json --prod`, plus les sections hors npm de scripts/licenses-non-npm.md.
//   node scripts/generate-licenses.mjs           réécrit LICENSES.md
//   node scripts/generate-licenses.mjs --check   échoue si LICENSES.md n'est pas à jour
// Sortie déterministe : aucune date, tri par code de caractère (indépendant de la locale).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "LICENSES.md");
const NON_NPM = join(ROOT, "scripts", "licenses-non-npm.md");
const HEADER = "Généré par pnpm licenses:md, ne pas modifier à la main";
const FORBIDDEN = /(^|[^A-Z])(A|L)?GPL/i;

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byVersion = (a, b) => a.localeCompare(b, "en", { numeric: true }) || byCodePoint(a, b);
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Normalise le champ "repository" d'un package.json en URL https (ou null). */
export function repositoryUrl(repository) {
  let url = typeof repository === "string" ? repository : repository?.url;
  if (typeof url !== "string" || !url.trim()) return null;
  url = url.trim();
  const shorthand = url.match(/^(github|gitlab|bitbucket):(.+)$/);
  if (shorthand) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[shorthand[1]];
    url = `https://${host}/${shorthand[2]}`;
  } else if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    url = `https://github.com/${url}`; // forme courte npm « utilisateur/dépôt »
  }
  url = url
    .replace(/^git\+/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^(git|http):\/\//, "https://")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (typeof repository === "object" && typeof repository?.directory === "string" && repository.directory) {
    const dir = repository.directory.replace(/^\/+|\/+$/g, "");
    if (/^https:\/\/github\.com\//.test(url) && dir) url = `${url}/tree/HEAD/${dir}`;
  }
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

function readRepository(paths) {
  for (const p of paths ?? []) {
    try {
      const url = repositoryUrl(JSON.parse(readFileSync(join(p, "package.json"), "utf8")).repository);
      if (url) return url;
    } catch {
      /* package.json illisible : on essaie le chemin suivant */
    }
  }
  return null;
}

export function render(byLicense, nonNpm) {
  const rows = [];
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs) {
      rows.push({
        name: p.name,
        versions: [...new Set(p.versions ?? [])].sort(byVersion),
        license,
        repo: readRepository(p.paths),
      });
    }
  }
  rows.sort((a, b) => byCodePoint(a.name, b.name) || byCodePoint(a.license, b.license));

  const counts = new Map();
  for (const r of rows) counts.set(r.license, (counts.get(r.license) ?? 0) + 1);
  const summary = [...counts].sort((a, b) => b[1] - a[1] || byCodePoint(a[0], b[0]));
  const forbidden = summary.filter(([l]) => FORBIDDEN.test(l)).map(([l]) => l);

  const out = [
    HEADER,
    "",
    "# Composants tiers et licences",
    "",
    "Déclaration exigée par l'article 6 du règlement CADEV 2026.",
    forbidden.length
      ? `**Attention : licence à réciprocité détectée (${forbidden.join(", ")}).**`
      : "Toutes les licences des dépendances npm de production sont permissives ; aucune licence à réciprocité (GPL, AGPL, LGPL).",
    "",
    "La liste npm est produite par `pnpm licenses list --json --prod` (dépendances directes et indirectes de production de tout le monorepo) " +
      "via `pnpm licenses:md` ; la CI vérifie à chaque push qu'elle est à jour (`pnpm licenses:md:check`) et qu'aucune licence n'est interdite (`pnpm licenses:check`). " +
      "Les paquets natifs propres à une plateforme sont ceux de Linux x64, comme en CI. " +
      "Les sections hors npm se modifient dans `scripts/licenses-non-npm.md`.",
    "",
    nonNpm.trim(),
    "",
    `## Dépendances npm de production (${rows.length} paquets)`,
    "",
    "### Résumé par licence",
    "",
    "| Licence | Paquets |",
    "| --- | --- |",
    ...summary.map(([l, n]) => `| ${cell(l)} | ${n} |`),
    "",
    "### Détail",
    "",
    "| Paquet | Version | Licence | Dépôt |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${cell(r.name)} | ${cell(r.versions.join(", "))} | ${cell(r.license)} | ${r.repo ? `<${r.repo}>` : "—"} |`),
    "",
  ];
  return out.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const raw = execSync("pnpm licenses list --json --prod", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const content = render(JSON.parse(raw), readFileSync(NON_NPM, "utf8"));
  let current = null;
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* fichier absent */
  }
  if (check) {
    if (current !== content) {
      console.error("LICENSES.md n'est pas à jour : lancez `pnpm licenses:md` puis committez le fichier.");
      process.exit(1);
    }
    console.log("LICENSES.md à jour.");
    return;
  }
  if (current === content) {
    console.log("LICENSES.md déjà à jour.");
    return;
  }
  writeFileSync(TARGET, content);
  console.log("LICENSES.md réécrit.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
