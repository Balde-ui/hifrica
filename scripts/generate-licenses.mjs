// Génère LICENSES.md (article 6 CADEV : composants tiers et licences) à partir de
// `pnpm licenses list --json --prod`, plus les sections hors npm de scripts/licenses-non-npm.md.
//   node scripts/generate-licenses.mjs           réécrit LICENSES.md
//   node scripts/generate-licenses.mjs --check   échoue si LICENSES.md n'est pas à jour
//
// Sortie déterministe et identique sous Linux, macOS et Windows :
// - aucune date, tri par code de caractère (indépendant de la locale), fins de ligne normalisées ;
// - les binaires propres à une plateforme (champ "os", "cpu" ou "libc", ex. @esbuild/linux-x64) ne sont
//   pas listés un par un : seule une variante est installée, et elle change avec la machine. Ils sont
//   regroupés en une ligne par paquet parent (celui qui les déclare en optionalDependencies), sans
//   suffixe de plateforme ni version. Les variantes connues viennent du lockfile, y compris celles qui
//   ne sont pas installées ici (ex. fsevents, macOS uniquement).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "LICENSES.md");
const NON_NPM = join(ROOT, "scripts", "licenses-non-npm.md");
const LOCKFILE = join(ROOT, "pnpm-lock.yaml");
const HEADER = "Généré par pnpm licenses:md, ne pas modifier à la main";
const FORBIDDEN = /(^|[^A-Z])(A|L)?GPL/i;

/**
 * Familles de binaires de plateforme, par paquet parent. Licence et dépôt sont déclarés ici parce qu'une
 * famille peut n'avoir aucune variante installée sur la machine qui génère (fsevents hors macOS).
 * La licence déclarée est comparée à celle de chaque variante installée : un écart fait échouer le script.
 */
const PLATFORM_FAMILIES = {
  esbuild: { license: "MIT", repo: "https://github.com/evanw/esbuild" },
  "msgpackr-extract": { license: "MIT", repo: "https://github.com/kriszyp/msgpackr-extract" },
  tsx: { license: "MIT", repo: "https://github.com/fsevents/fsevents" },
};

const OS_NAMES = { darwin: "macOS", linux: "Linux", win32: "Windows" };

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

function readManifest(paths) {
  for (const p of paths ?? []) {
    try {
      return JSON.parse(readFileSync(join(p, "package.json"), "utf8"));
    } catch {
      /* package.json illisible : on essaie le chemin suivant */
    }
  }
  return {};
}

const isPlatformManifest = (m) => ["os", "cpu", "libc"].some((k) => Array.isArray(m[k]) && m[k].length > 0);

/**
 * Paquets du lockfile restreints à une plateforme (os, cpu ou libc), toutes plateformes confondues :
 * nom → systèmes déclarés (ex. fsevents → ["darwin"]). Lecture ligne à ligne de la section "packages:".
 */
export function lockfilePlatformPackages(lockText) {
  const result = new Map();
  let inPackages = false;
  let current = null;
  for (const line of lockText.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith("packages:");
      current = null;
      continue;
    }
    if (!inPackages) continue;
    const entry = line.match(/^  '?((?:@[^/'\s]+\/)?[^@'\s]+)@[^']*'?:\s*$/);
    if (entry) {
      current = entry[1];
      continue;
    }
    const field = current && line.match(/^    (os|cpu|libc):\s*\[(.*)\]/);
    if (field) {
      const known = result.get(current) ?? [];
      if (field[1] === "os") known.push(...field[2].split(",").map((s) => s.trim().replace(/^'|'$/g, "")));
      result.set(current, known);
    }
  }
  return result;
}

/** Nom générique d'une famille : préfixe commun jusqu'au dernier « / » ou « - », suivi de <plateforme>. */
function familyName(members) {
  if (members.length === 1) return members[0];
  let prefix = members[0];
  for (const m of members) while (!m.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("-"));
  return `${prefix.slice(0, cut + 1)}<plateforme>`;
}

export function render(byLicense, nonNpm, lockText) {
  const installed = [];
  for (const [license, pkgs] of Object.entries(byLicense)) {
    for (const p of pkgs) installed.push({ name: p.name, versions: p.versions ?? [], license, manifest: readManifest(p.paths) });
  }
  const lockPlatform = lockfilePlatformPackages(lockText);
  const isPlatform = (pkg) => lockPlatform.has(pkg.name) || isPlatformManifest(pkg.manifest);

  // Familles : parent → variantes de plateforme connues (installées ou non). Le parent est installé
  // partout et son package.json est identique d'une machine à l'autre : la liste ne dépend pas de l'OS.
  const families = new Map();
  for (const parent of installed) {
    if (isPlatform(parent)) continue;
    for (const dep of Object.keys(parent.manifest.optionalDependencies ?? {})) {
      if (!lockPlatform.has(dep)) continue;
      const fam = families.get(parent.name) ?? new Set();
      fam.add(dep);
      families.set(parent.name, fam);
    }
  }
  const familyOf = new Map();
  for (const [parent, members] of families) for (const m of members) familyOf.set(m, parent);

  const rows = [];
  for (const pkg of installed) {
    if (isPlatform(pkg)) {
      const parent = familyOf.get(pkg.name);
      if (!parent) throw new Error(`Binaire de plateforme sans paquet parent connu : ${pkg.name}. Complétez PLATFORM_FAMILIES.`);
      const declared = PLATFORM_FAMILIES[parent];
      if (declared && declared.license !== pkg.license) {
        throw new Error(`Licence de ${pkg.name} : ${pkg.license}, mais ${declared.license} déclarée pour la famille ${parent} dans PLATFORM_FAMILIES.`);
      }
      continue;
    }
    rows.push({
      name: pkg.name,
      versions: [...new Set(pkg.versions)].sort(byVersion),
      license: pkg.license,
      repo: repositoryUrl(pkg.manifest.repository),
    });
  }
  rows.sort((a, b) => byCodePoint(a.name, b.name) || byCodePoint(a.license, b.license));

  const platformRows = [...families].map(([parent, set]) => {
    const declared = PLATFORM_FAMILIES[parent];
    if (!declared) throw new Error(`Famille de binaires de plateforme non déclarée : ${parent} (${[...set].sort(byCodePoint).join(", ")}). Complétez PLATFORM_FAMILIES.`);
    const members = [...set].sort(byCodePoint);
    const systems = [...new Set(members.flatMap((m) => lockPlatform.get(m) ?? []))].sort(byCodePoint);
    const role =
      members.length > 1
        ? `binaire ${parent} de la plateforme`
        : `module natif de ${parent}, ${systems.map((s) => OS_NAMES[s] ?? s).join(", ") || "certaines plateformes"} uniquement`;
    return { name: familyName(members), role, license: declared.license, repo: declared.repo };
  });
  platformRows.sort((a, b) => byCodePoint(a.name, b.name));

  const counts = new Map();
  for (const r of [...rows, ...platformRows]) counts.set(r.license, (counts.get(r.license) ?? 0) + 1);
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
      "Les binaires propres à une plateforme sont regroupés par famille, pour que le fichier soit identique sous Linux, macOS et Windows. " +
      "Les sections hors npm se modifient dans `scripts/licenses-non-npm.md`.",
    "",
    nonNpm.replace(/\r\n/g, "\n").trim(),
    "",
    `## Dépendances npm de production (${rows.length} paquets et ${platformRows.length} familles de binaires de plateforme)`,
    "",
    "### Résumé par licence",
    "",
    "Une famille de binaires de plateforme compte pour une ligne.",
    "",
    "| Licence | Lignes |",
    "| --- | --- |",
    ...summary.map(([l, n]) => `| ${cell(l)} | ${n} |`),
    "",
    "### Détail",
    "",
    "| Paquet | Version | Licence | Dépôt |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${cell(r.name)} | ${cell(r.versions.join(", "))} | ${cell(r.license)} | ${r.repo ? `<${r.repo}>` : "—"} |`),
    "",
    "### Binaires propres à une plateforme",
    "",
    "Une seule variante est installée, selon le système et le processeur de la machine.",
    "",
    "| Paquet | Rôle | Licence | Dépôt |",
    "| --- | --- | --- | --- |",
    ...platformRows.map((r) => `| \`${r.name}\` | ${cell(r.role)} | ${cell(r.license)} | <${r.repo}> |`),
    "",
  ];
  return out.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const raw = execSync("pnpm licenses list --json --prod", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const content = render(JSON.parse(raw), readFileSync(NON_NPM, "utf8"), readFileSync(LOCKFILE, "utf8"));
  let current = null;
  try {
    current = readFileSync(TARGET, "utf8").replace(/\r\n/g, "\n"); // CRLF possible sous Windows (git autocrlf)
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
