import { defineConfig } from "@hey-api/openapi-ts";

// Generates a typed client for the Dograh API into src/client. Point
// BACKEND_URL at the running API (IPv4: on Windows, `localhost` resolves to ::1,
// which WSL's port forwarding doesn't answer).
const backendUrl = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export default defineConfig({
  input: `${backendUrl}/api/v1/openapi.json`,
  output: "src/client",
  plugins: [
    {
      name: "@hey-api/client-fetch",
      runtimeConfigPath: "./src/lib/api",
    },
  ],
});
