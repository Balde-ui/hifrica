// Vérifie la cohérence du journal des migrations Drizzle.
// Drizzle n'applique une migration que si son `when` est STRICTEMENT plus récent que la dernière appliquée :
// une migration plus ancienne fusionnée après coup serait ignorée sans erreur. Ce script le détecte.
//   node scripts/check-migration-journal.mjs [ref-git-de-base]   (ex. origin/main)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageDir, "migrations");
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
const errors = [];

journal.entries.forEach((entry, i) => {
  if (entry.idx !== i) errors.push(`Entrée ${entry.tag} : idx ${entry.idx} au lieu de ${i}.`);
  if (i > 0 && entry.when <= journal.entries[i - 1].when) {
    errors.push(`Entrée ${entry.tag} : "when" non strictement croissant (elle serait ignorée par migrate()).`);
  }
  if (!existsSync(join(migrationsDir, `${entry.tag}.sql`))) errors.push(`Fichier ${entry.tag}.sql manquant.`);
});

const tags = new Set(journal.entries.map((e) => `${e.tag}.sql`));
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
  if (!tags.has(file)) errors.push(`Fichier ${file} absent du journal.`);
}

// Comparaison avec la branche de base : les migrations déjà présentes doivent être inchangées et en tête.
const baseRef = process.argv[2];
if (baseRef) {
  const rel = "packages/db/migrations";
  let baseJournal = null;
  try {
    baseJournal = JSON.parse(
      execFileSync("git", ["show", `${baseRef}:${rel}/meta/_journal.json`], { cwd: packageDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
    );
  } catch {
    console.log(`(aucun journal de migrations sur ${baseRef} : comparaison ignorée)`);
  }
  if (baseJournal) {
    baseJournal.entries.forEach((baseEntry, i) => {
      const entry = journal.entries[i];
      if (!entry || entry.tag !== baseEntry.tag || entry.when !== baseEntry.when) {
        errors.push(`Migration fusionnée ${baseEntry.tag} absente, déplacée ou modifiée dans le journal.`);
        return;
      }
      const baseSql = execFileSync("git", ["show", `${baseRef}:${rel}/${baseEntry.tag}.sql`], { cwd: packageDir, encoding: "utf8" });
      if (baseSql !== readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8")) {
        errors.push(`Migration fusionnée ${baseEntry.tag} modifiée : interdit, créer une nouvelle migration.`);
      }
    });
  }
}

if (errors.length) {
  console.error(errors.map((e) => `ERREUR ${e}`).join("\n"));
  process.exit(1);
}
console.log(`ok  ${journal.entries.length} migration(s), journal cohérent`);
