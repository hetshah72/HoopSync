import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The real `server-only` package throws unless resolved under
      // Next.js's "react-server" export condition, which plain Vitest
      // doesn't set. See tests/stubs/server-only.ts for why this is safe.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
