import { createEslintConfig } from "@smart-renderers/eslint-config";

export default createEslintConfig({
  tsconfigRootDir: import.meta.dirname,
});
