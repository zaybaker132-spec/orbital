/**
 * Create a one-time password reset link for an account, for servers without email set up.
 * Run on the server (it reads the database directly):  npm run reset-link -- person@example.com
 * Give the link to the person through a channel you trust. It works once and expires in an hour.
 */
import { config } from "../config.js";
import { getDb } from "./client.js";
import { migrate } from "./migrate.js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: npm run reset-link -- person@example.com");
  process.exit(2);
}
const database = await getDb();
await migrate(database, () => {});
const u = (await database.query<{ id: string }>("SELECT id FROM users WHERE email=$1", [email])).rows[0];
if (!u) {
  console.error(`No account uses ${email}.`);
  process.exit(1);
}
const { createResetLink } = await import("../routes/core.js");
const base = config.publicUrl || `http://localhost:${config.port}`;
console.log(await createResetLink(u.id, base));
if (!config.publicUrl) console.error("(ORBITAL_PUBLIC_URL isn't set, so the link uses localhost. Replace the start with your server's address.)");
await database.close();
