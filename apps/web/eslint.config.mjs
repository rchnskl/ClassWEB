import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next 16 removed `next lint`; eslint-config-next now ships native flat configs,
// so this no longer goes through the FlatCompat shim.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', '.open-next/**', 'node_modules/**', 'next-env.d.ts']),
]);
