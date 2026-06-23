import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@promptgate/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
});
