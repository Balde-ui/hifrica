// Better Auth 1.7.22 branché sur le schéma généré, contre une vraie base PostgreSQL migrée.
// La vérification de schéma de Better Auth est ACTIVE (comportement par défaut) : un écart ferait échouer ces appels.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as dbModule from "../../dist/index.js";
import { SKIP_REASON, createFreshDatabase, withClient } from "./helpers.mjs";

const { AUTH_USE_PLURAL, authSchemaOptions, createDb, createPool, runMigrations } = dbModule;

describe("Better Auth sur le schéma généré", { skip: SKIP_REASON }, () => {
  let fresh;
  let pool;
  let auth;
  const password = `Mdp-${randomBytes(9).toString("base64url")}`;
  const email = `c1-auth-${randomUUID()}@example.test`;

  before(async () => {
    fresh = await createFreshDatabase();
    await runMigrations({ databaseUrl: fresh.url });
    pool = createPool(fresh.url, { max: 4 });
    const db = createDb(pool);
    auth = betterAuth({
      ...authSchemaOptions,
      // Le schéma complet est passé tel quel : la vérification lit les tables users/sessions/accounts/verifications.
      database: drizzleAdapter(db, { provider: "pg", usePlural: AUTH_USE_PLURAL, schema: dbModule }),
      emailAndPassword: { enabled: true },
      secret: randomBytes(32).toString("base64"),
      baseURL: "http://localhost:3000",
      telemetry: { enabled: false },
      logger: { disabled: true },
    });
  });
  after(async () => {
    await pool?.end();
    await fresh?.drop();
  });

  test("inscription email : utilisateur créé avec role 'user', mot de passe jamais stocké en clair", async () => {
    const result = await auth.api.signUpEmail({ body: { email, password, name: "Testeur C1" } });
    assert.equal(result.user.email, email);
    await withClient(fresh.url, async (c) => {
      const { rows: users } = await c.query("SELECT id, role, email_verified, country FROM users WHERE email = $1", [email]);
      assert.equal(users.length, 1);
      assert.equal(users[0].role, "user");
      assert.equal(users[0].email_verified, false);
      assert.match(users[0].id, /^[0-9a-f-]{36}$/);
      const { rows: accounts } = await c.query("SELECT provider_id, account_id, password FROM accounts WHERE user_id = $1", [users[0].id]);
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].provider_id, "credential");
      assert.ok(accounts[0].password && accounts[0].password !== password && !accounts[0].password.includes(password));
      const { rows: sessions } = await c.query("SELECT count(*)::int AS n FROM sessions WHERE user_id = $1", [users[0].id]);
      assert.equal(sessions[0].n, 1);
    });
  });

  test("role n'est jamais accepté depuis la requête (input: false)", async () => {
    const other = `c1-auth-${randomUUID()}@example.test`;
    let accepted = true;
    try {
      await auth.api.signUpEmail({ body: { email: other, password, name: "Intrus", role: "admin" } });
    } catch {
      accepted = false; // rejet explicite : acceptable
    }
    await withClient(fresh.url, async (c) => {
      const { rows } = await c.query("SELECT role FROM users WHERE email = $1", [other]);
      if (accepted) assert.equal(rows[0].role, "user");
      else assert.equal(rows.length, 0);
      const { rows: admins } = await c.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
      assert.equal(admins[0].n, 0);
    });
  });

  test("connexion : bon mot de passe accepté, mauvais refusé", async () => {
    const ok = await auth.api.signInEmail({ body: { email, password } });
    assert.ok(ok.token);
    await assert.rejects(auth.api.signInEmail({ body: { email, password: `${password}x` } }));
  });

  test("une adresse email ne peut créer qu'un compte", async () => {
    await assert.rejects(auth.api.signUpEmail({ body: { email, password, name: "Doublon" } }));
  });
});
