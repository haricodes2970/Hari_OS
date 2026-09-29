import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const infrastructure = [
  "@/lib/db",
  "@/lib/db/*",
  "@/lib/storage",
  "@/lib/storage/*",
  "@/commands",
  "@/commands/*",
];

const boundaries = {
  name: "hari-os/boundaries",
  files: ["src/domain/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: infrastructure,
            message:
              "Domain and components must stay free of infrastructure. Move the rule to src/domain, or call it through a feature.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  boundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
