import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Live checks that call real models through the gateway (pnpm eval:blueprint). Not part of `pnpm test`.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the env.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["test/live/**/*.test.ts"], environment: "node", testTimeout: 180_000, fileParallelism: false },
});
