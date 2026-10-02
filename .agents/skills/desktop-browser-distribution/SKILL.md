---
name: desktop-browser-distribution
description: Package and verify browser-based desktop applications and extensions, including bundled runtimes, Windows/macOS launchers, local backend lifecycle, and GitHub Actions artifacts. Use for distribution changes, not ordinary reading UI edits.
---

# Desktop and browser distribution

Use the existing launch and packaging entry points rather than introduce another desktop framework. For current architecture, licenses, platform limits and investigation evidence, read `docs/desktop-distribution-0.15.md` from the project root; check actual scripts before relying on dated evidence.

## Bundle and launch

- Keep developer tooling out of end-user startup. Pin official runtime versions and SHA-256 in `scripts/desktop-runtimes.json`; verify cached and newly downloaded archives. Reuse existing proxy variables without printing them. Do not diagnose unreachable downloads as application defects.
- `pnpm package:desktop windows-x64|macos-arm64|macos-x64` builds the reader and self-contained SSR backend. Preserve `ssr.noExternal` bundling; a bundle that still imports absent node_modules will fail on clean machines. `pnpm package:extension` builds a separate extension ZIP with manifest at its root.
- Keep immutable resources beside the launcher or inside app Contents/Resources. Settings and logs belong in per-user directories, not an application install directory. Do not include keys, test data, caches or build dependencies in archives. Include exact dependency and runtime licenses and dataset attribution.
- Preserve authenticated loopback instance reuse and stable port selection. Separate PID metadata from authentication; a port responding HTTP is not proof it belongs to the app. A Finder launcher that stays alive needs reopen event handling; the current launcher instead releases the independent backend after readiness and exits.
- Backend quit must cancel provider requests, including connection tests, and terminate the actual backend process. Closing the launcher or HTTP listener alone does not prove shutdown. Guard unexported PDF edits and release the reader's mounted resources.

## Verify the artifact

Run repository unit checks and both UI builds for application changes. Use existing public fixtures and mock providers for browser tests. Run `pnpm test:desktop <target>` on the matching native OS/architecture; it uses an isolated data directory, empty child PATH and no automatic browser opening. Verify readiness, bundled assets, repeated launch and backend PID exit. Do not replace native execution with successful cross-compilation.

From WSL, copy the complete Windows folder plus smoke script and package.json into an isolated Windows temporary directory and run the bundled Windows Node there. Use PowerShell `Start-Process -Wait -PassThru`, redirected output and a success marker; WSL dispatch returning zero alone is insufficient evidence that a Windows GUI child completed. Wait for backend exit before removing temporary files; inspect only test-owned paths and processes.

For native dependency/test runs, if an installed `.cmd` is reported as unknown, inspect the child process's PATH and PATHEXT before changing package scripts. A missing `.CMD` entry can cause this despite successful installation. Restore expected executable extensions only within the isolated verification process when that diagnosis is confirmed; do not change the user's global environment or add a workaround to normal hosted CI.

Check ZIP root layout, SHA-256 sidecars and executable permission bits for Mac binaries. On native Mac, perform all app resource writes before signing Node and the containing app, then `codesign --verify --deep --strict`. Later writes invalidate the resource seal. Temporary signing is not Developer ID signing or notarization; verify Finder reopen on a real Mac before claiming it works there.

## Automate and report

Use `.github/workflows/package.yml` and matching native runners. Keep lockfile installs, pinned tool/action versions, checks and uploaded artifacts. Do not imply a local workflow edit has run on GitHub. Keep artifact generation separate from Release publication, stores and signing credentials; follow the user's authorization for external writes.

Distinguish the Node installed for project commands from each Action's own runtime. Changing `setup-node`'s `node-version` does not repair a dependency Action declaring `runs.using: node20`. Before updating pinned SHAs, inspect their official action manifests and supported runner versions, including pnpm setup and artifact upload; preserve package-manager versions and cache behavior. Windows checkout can convert text fixtures to CRLF: parse word lists by whitespace and keep generated vocabulary LF through scoped `.gitattributes`, without imposing newline rules on unrelated user files.

Report tests actually run, original failures and fixes, native versus cross-built evidence, review outcome and remaining signing/store requirements. Put dated results in docs and durable entry points in AGENTS.md. Synchronize this canonical repository skill with its installed counterpart after updating it.
