import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only throws outside a React Server environment; tests run server code directly.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    environment: "node",
    // Unit tests never call Supabase; a well-formed placeholder satisfies the URL check in src/lib/db.ts.
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://unittest.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "unit-test-anon-key" },
  },
});
