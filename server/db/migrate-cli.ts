import { getDb } from "./client.js";
import { migrate } from "./migrate.js";

const database = await getDb();
await migrate(database);
await database.close();
console.log("[db] migrations complete");
