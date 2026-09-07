// One job: make "Rendered more hooks than during the previous render" a build
// error instead of a store rejection.
//
// That crash shipped in 0.4.0 (55) because a useEffect was added below an
// `if (isLoading || !data) return <Skeleton/>` in ListingDetailScreen. The
// loading render ran N hooks, the loaded render ran N+1, and React aborted —
// on the most-visited screen in the app. Nothing statically checked it: this
// project had no eslint config, no eslint dependency and no lint script, so
// the first thing to notice was Google's pre-launch crawler.
//
// Deliberately NOT a style overhaul. A first run that prints five hundred
// formatting complaints gets switched off within a week, and then the one
// rule that actually prevents a crash goes with it. Two rules, both about
// correctness, and nothing else.

const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: ['node_modules/**', 'android/**', 'ios/**', 'dist/**', '.expo/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    // @typescript-eslint is registered but almost entirely unused: the app
    // already carries `eslint-disable-next-line @typescript-eslint/...`
    // comments, and ESLint errors on a disable comment naming a rule it
    // cannot resolve. Registering the plugin makes those comments valid.
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    rules: {
      // The rule this file exists for. Never downgrade to "warn": a warning
      // in a codebase with no CI is a comment.
      'react-hooks/rules-of-hooks': 'error',

      // Stale-closure bugs — the quieter sibling. Warn, not error: the
      // existing code has deliberate omissions (several are commented as
      // such), and failing the build on those would force the whole rule off.
      'react-hooks/exhaustive-deps': 'warn',

      // Never enabled on purpose — it arrives with the TS parser preset.
      // videoCompress.ts requires react-native-compressor inside a try/catch
      // precisely so a build without the native side degrades to "skip
      // compression" instead of failing at import. That guard is the design,
      // not an oversight, and this rule cannot express it.
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
];
