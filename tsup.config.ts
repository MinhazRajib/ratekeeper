import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    // tsup's dts bundler sets `baseUrl` internally, which TypeScript 6 reports
    // as deprecated. Silence that until tsup stops setting it.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node18",
});
