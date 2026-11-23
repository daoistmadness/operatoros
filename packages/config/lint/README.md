# Shared lint boundary configuration

`boundaries.mjs` owns the repository's workspace import restrictions. The root
Oxlint configuration applies the rules to the same source roots as the
repository lint command. The semantic architecture checker separately
validates workspace manifests, relative paths, dynamic imports, and package
exports.
