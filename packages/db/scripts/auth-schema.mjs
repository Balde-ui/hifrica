// Génère le schéma Drizzle des tables Better Auth de façon reproductible, ou vérifie qu'il n'a pas dérivé.
//   node scripts/auth-schema.mjs generate   → écrit src/schema/auth.ts
//   node scripts/auth-schema.mjs check      → échoue si une nouvelle génération diffère du fichier versionné
// Les options de schéma viennent de src/auth/options.ts (compilé dans dist/) via auth.cli.mjs.
// Le fichier généré n'est JAMAIS modifié à la main : toute adaptation passe par les options ou par une migration --custom.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUTH_CLI_VERSION = "1.7.22"; // identique à la dépendance better-auth
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(packageDir, "src", "schema", "auth.ts");

const HEADER = `// FICHIER GÉNÉRÉ par \`pnpm --filter @hifrica/db db:auth:generate\` (CLI auth@${AUTH_CLI_VERSION}).
// NE PAS MODIFIER À LA MAIN : changer src/auth/options.ts puis régénérer.
// Contrôle de dérive : \`pnpm --filter @hifrica/db db:auth:drift\`.
`;

function generate() {
  const dir = mkdtempSync(join(tmpdir(), "hifrica-auth-schema-"));
  try {
    const out = join(dir, "auth.ts");
    execFileSync(
      "pnpm",
      ["dlx", `auth@${AUTH_CLI_VERSION}`, "generate", "--config", "auth.cli.mjs", "--output", out, "-y"],
      { cwd: packageDir, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, BETTER_AUTH_TELEMETRY: "false" } },
    );
    return HEADER + readFileSync(out, "utf8").trimEnd() + "\n";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const mode = process.argv[2];
if (mode === "generate") {
  writeFileSync(target, generate());
  console.log(`Schéma Better Auth écrit dans ${target}`);
} else if (mode === "check") {
  const expected = generate();
  const current = readFileSync(target, "utf8");
  if (current !== expected) {
    console.error("DÉRIVE : src/schema/auth.ts ne correspond plus à la génération Better Auth.");
    console.error("Lancer `pnpm --filter @hifrica/db db:auth:generate`, puis générer une migration.");
    process.exit(1);
  }
  console.log("ok  schéma Better Auth identique à la génération");
} else {
  console.error("Usage : node scripts/auth-schema.mjs <generate|check>");
  process.exit(2);
}
