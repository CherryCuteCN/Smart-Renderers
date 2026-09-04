import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export type EslintConfigOptions = {
  tsconfigRootDir: string;
};

export function createEslintConfig(options: EslintConfigOptions) {
  return tseslint.config(
    {
      ignores: [
        "**/dist/**",
        "**/node_modules/**",
        "**/coverage/**",
        "**/.pnpm-store/**",
      ],
    },
    eslint.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: {
          projectService: {
            allowDefaultProject: [
              "*.config.ts",
              "*.config.js",
              "*.config.mjs",
              "eslint.config.ts",
            ],
          },
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
    },
  );
}
