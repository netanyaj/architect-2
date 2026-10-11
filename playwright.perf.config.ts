import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/** `pnpm perf`: page load and click-to-paint on a deployed site (E2E_BASE_URL), one browser, no retries. */
export default defineConfig({ ...base, testDir: "test/perf", workers: 1, retries: 0, timeout: 300_000, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }] });
