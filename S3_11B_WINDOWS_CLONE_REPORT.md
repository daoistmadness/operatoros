# S3.11B Windows Clone Report

- Windows-native NTFS clone: `C:\OperatorOS\school-attendance-analytics`
- Clean WSL coordination clone: `/tmp/operatoros-s311-wsl-clean`
- Clone method: Git clone from the approved local Git object source; no dirty-worktree copy and no Windows UNC execution.
- Acceptance source commit: `dd0ec7b73b38e9c92e2212efb474608722c115e3`
- WSL and Windows commits: identical during both native acceptance runs.
- Windows worktree: clean before and after acceptance.
- WSL coordination worktree: clean before and after acceptance.
- Windows Bun: 1.3.14.
- Windows Node: genuine v22.23.1 at `C:\nvm4w\nodejs\node.exe`; npm 10.9.8.
- Windows dependency installations: `bun install --frozen-lockfile` and `npm ci`; WSL `node_modules` was not reused on NTFS.
- `npm ci` reported four dependency audit findings (one low, one moderate, two high); no dependency upgrade or audit-fix was authorized or performed.

After the final documentation-only commit, both clones are advanced to the same final HEAD and rechecked clean.
