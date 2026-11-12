import { defineConfig } from "drizzle-kit";

// Le schéma est lu depuis la sortie compilée (dist/) : les scripts db:* lancent tsc avant drizzle-kit.
// Cela évite tout écart de résolution entre les imports NodeNext (".js") et le chargeur de drizzle-kit.
export default defineConfig({
  dialect: "postgresql",
  schema: "./dist/schema/index.js",
  out: "./migrations",
  strict: true,
  verbose: true,
});
