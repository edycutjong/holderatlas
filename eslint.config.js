// Flat config: TypeScript everywhere, React hooks + Next rules for apps/web. `npm run lint` from the root.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "**/node_modules/",
      "**/.next/",
      "coverage/",
      "fixtures/",
      "playwright-report/",
      "test-results/",
      ".lighthouseci/",
      ".vercel/",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // `_x` is the conventional "deliberately unused" marker
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // the code base uses `as` narrowing on zod-parsed data deliberately; `any` stays banned
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": next },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
);
