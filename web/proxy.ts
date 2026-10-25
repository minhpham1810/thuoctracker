import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

// Only the SDK's routes (/auth/login, /auth/callback, /auth/logout, /auth/access-token, ...):
// the Pi kiosk (/cabinet) and the backend proxy (/api/*) never go through Auth0.
export const config = { matcher: ["/auth/:path*"] };
