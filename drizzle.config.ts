import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
  dialect: "postgresql",
  // dbCredentials is only consumed by push / migrate / introspect.
  // drizzle-kit generate (the only command this PR runs locally) does
  // not touch the database — empty url is fine there.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
