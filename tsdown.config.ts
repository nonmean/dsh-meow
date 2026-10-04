/**
 * Build config for dsh-meow.
 *
 * Two artifacts:
 * - lib/index.js   - the Host half (ESM, node): event observation, the
 *                    plugin-owned state file, and the /meow JSON routes.
 * - lib/client.js  - the browser half (CJS closure-factory bundle): loaded as
 *                    a classic script, it registers itself via
 *                    window.__ModuleLoader__.load({ id, factory }), the same
 *                    format as the DSH monorepo's client bundle preset. Only
 *                    the frozen platform-module table words stay external;
 *                    every other import is inlined.
 */
import { defineConfig } from 'tsdown'

/** The shell's frozen platform-module table (single source in the monorepo:
 *  packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** The client bundle's id (the graph row id == package name). */
const CLIENT_ID = 'dsh-meow'

export default defineConfig([
  {
    name: CLIENT_ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: true,
    fixedExtension: false,
    // Host-half runtime imports resolve from the profile's node_modules
    // (the DSH packages are peer deps); node: builtins stay automatic.
    deps: {
      neverBundle: (id: string) => id.startsWith('@deepseek-ai/'),
    },
  },
  {
    name: CLIENT_ID + '/client',
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    // Platform-table words stay external; everything else inlines.
    deps: {
      neverBundle: (id: string) => PLATFORM_MODULES.includes(id),
      alwaysBundle: (id: string) => !PLATFORM_MODULES.includes(id),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(CLIENT_ID) + ', factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
