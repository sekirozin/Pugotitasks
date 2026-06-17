import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  port: Number(process.env.PORT ?? 3010),
  dbFile: process.env.DB_FILE ?? path.join(root, "data", "pugotitasks.db"),
  publicDir: process.env.PUBLIC_DIR ?? path.join(root, "public"),
  pugotilabProfileUrl: process.env.PUGOTILAB_PROFILE_URL ?? "http://pugotilab-auth:8080/auth/api/profile",
  pugotilabLoginUrl: process.env.PUGOTILAB_LOGIN_URL ?? "https://pugotilab.com/auth"
};
