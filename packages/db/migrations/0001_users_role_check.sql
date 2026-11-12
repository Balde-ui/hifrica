-- Custom SQL migration file, put your code below! --
-- Migration manuelle (drizzle-kit generate --custom) : contrainte que le générateur Better Auth ne produit pas.
-- users.role est généré comme text(enum) : contrôle TypeScript seulement. Défense en profondeur côté base.
ALTER TABLE "users" ADD CONSTRAINT "users_role_chk" CHECK ("role" IN ('user', 'admin'));
