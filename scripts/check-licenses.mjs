// Bloque la CI si une dépendance (directe ou indirecte) est sous licence à réciprocité (article 6 CADEV).
import { execSync } from "node:child_process";

const raw = execSync("pnpm licenses list --json --prod", { encoding: "utf8" });
const byLicense = JSON.parse(raw);

const forbidden = /(^|[^A-Z])(A|L)?GPL/i;
let failed = false;

for (const [license, pkgs] of Object.entries(byLicense)) {
  const names = pkgs.map((p) => `${p.name}@${(p.versions ?? []).join(",")}`).join(", ");
  if (forbidden.test(license)) {
    console.error(`INTERDIT (${license}) : ${names}`);
    failed = true;
  } else if (/unknown/i.test(license)) {
    console.warn(`À VÉRIFIER (${license}) : ${names}`);
  } else {
    console.log(`ok  ${license} (${pkgs.length})`);
  }
}

if (failed) {
  console.error("\nLicence à réciprocité détectée : le projet serait irrecevable (article 6).");
  process.exit(1);
}
