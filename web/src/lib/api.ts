import type { CreateClientConfig } from "@/client/client.gen";

/** Where the Dograh API lives, as seen from the Next.js server. */
export function backendUrl() {
  return (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

// In the browser the client calls same-origin /api/v1/*; middleware forwards
// those to the backend and attaches the session token from the httpOnly
// cookie. On the server it talks to the backend directly.
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: typeof window === "undefined" ? backendUrl() : "",
});
