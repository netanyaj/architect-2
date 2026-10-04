import { defineConfig, devices } from "@playwright/test";

// Tests talk to the real Supabase project; load local settings when present (CI sets them as env vars).
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  // The dev server compiles pages on first visit and the tests share one Supabase project and a free-tier
  // model, so allow slower answers and fewer browsers at once than the defaults.
  expect: { timeout: 15_000 },
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `pnpm dev --port ${PORT}`, url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
