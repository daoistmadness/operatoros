# Shared ESLint boundary configuration

`index.mjs` owns the reusable workspace import restrictions.

The root ESLint config applies these rules to active workspace source and test
files. The semantic architecture checker also validates manifests and paths.
