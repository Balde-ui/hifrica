import { timestamp } from "drizzle-orm/pg-core";

/** Horodatage avec fuseau (timestamptz), utilisé par toutes les tables métier. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** created_at / updated_at standards des tables métier. */
export const timestamps = () => ({
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
