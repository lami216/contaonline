export default [{
  files: ['scripts/*.mjs', 'tests/*.mjs'],
  ignores: ['scripts/verify-feature-domains.mjs', 'scripts/verify-party-summaries.mjs', 'scripts/verify-report-sources.mjs', 'scripts/verify-french-locale.mjs', 'scripts/verify-approved-source-navigation.mjs', 'scripts/verify-import-features.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
    'no-unreachable': 'error', 'valid-typeof': 'error', 'eqeqeq': 'error',
    'no-constant-condition': ['error', { checkLoops: false }]
  }
}];
