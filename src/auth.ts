import type { IncomingMessage } from "node:http";
import { config } from "./config.js";
import type { PugotiProfile } from "./types.js";

type ProfileResponse = {
  authenticated?: boolean;
  profile?: Partial<PugotiProfile> & { username?: string };
};

export function getCookie(req: IncomingMessage, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const pair of raw.split(";")) {
    const [key, ...parts] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export async function getProfile(req: IncomingMessage): Promise<PugotiProfile | null> {
  const token = getCookie(req, "pugotilab_session");
  if (!token) return null;

  try {
    const response = await fetch(config.pugotilabProfileUrl, {
      headers: { Cookie: `pugotilab_session=${encodeURIComponent(token)}` }
    });
    if (!response.ok) return null;

    const payload = await response.json() as ProfileResponse;
    const profile = payload.profile;
    if (!profile?.username) return null;

    return {
      username: profile.username.trim().toLowerCase(),
      displayName: profile.displayName?.trim() || profile.username,
      nickname: profile.nickname?.trim() || "",
      avatarUrl: profile.avatarUrl || "",
      biography: profile.biography || "",
      location: profile.location || "",
      role: profile.role === "admin" ? "admin" : "user"
    };
  } catch {
    return null;
  }
}
