import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// Next 16 removed `next lint`; eslint-config-next now ships native flat configs,
// so this no longer goes through the FlatCompat shim.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // New in eslint-plugin-react-hooks 7 (shipped with Next 16). It flags the
      // "set loading, then fetch" effect every data page here uses — 36 sites that
      // behave correctly. Rewriting them is its own change, not part of the
      // framework upgrade, so the rule stays off until that's done deliberately.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['.next/**', '.open-next/**', 'node_modules/**', 'next-env.d.ts']),
]);
