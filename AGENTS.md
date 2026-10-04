# Repository Guidelines

## 版本管理（每次任务必须执行）

- 开始工作前阅读 `docs/versioning.md`，运行 `pnpm version:check`，以 `package.json` 的三段功能版本为准。
- 大量功能发生重大改变或升级：主版本号加一；新增功能或改进现有功能：次版本号加一；修复错误或问题：修订号加一。混合任务采用最高级别，同一任务只递增一次；高位递增时，较低的功能版本位清零。
- 有功能变化的任务必须使用 `pnpm version:bump major|minor|patch` 同步更新版本，并在 `CHANGELOG.md` 记录原因及验证。纯文档、测试或不影响软件行为的维护不递增功能版本。用户明确指定目标版本时优先遵照，不额外递增。
- 构建号由构建脚本自动生成，不手填，不把四段版本写入 `package.json`。同一次打包中的编译、组装及各平台共享构建号；新本地构建或 CI 全部 job 重跑生成新号；只重跑失败的子 job 时复用已成功上游分配的本次编号。
- 使用 `pnpm build`、`pnpm build:workbench`、`pnpm package:extension`、`pnpm package:desktop <target>`。提交前再次运行 `pnpm version:check`，报告功能版本、构建版本和验证结果；不要提交 `.cache/` 中的计数器及构建产物。
- 历史验收记录、历史版本文档、第三方依赖及 Node.js 等工具链版本不随软件版本批量替换。详细顺序、平台字段和命令见 `docs/versioning.md`。

## Project Structure & Module Organization

- `src/core/`: shared types, model adapters, settings, caches, and learning.
- `src/content/`: webpage extraction, annotations, and bilingual translation.
- `src/ui/`: React screens and styles; `src/reader/`: document parsing and vocabulary selection.
- `src/background.ts`: extension orchestration; `src/workbench/`: local backend.
- `public/`: manifest, vocabulary, and licenses; `scripts/`: builds and packaging; `desktop/launcher/`: Go launchers.
- `tests/`: unit tests, `tests/e2e/`: browser flows, `tests/fixtures/`: public fixtures; `docs/`: architecture and validation.

## Build, Test, and Development Commands

Use Node.js 22.13+ (or Node.js 24 LTS) and pnpm pinned in `package.json`.

- `pnpm install --frozen-lockfile`: install locked dependencies.
- `pnpm check`: check strict TypeScript.
- `pnpm lint` / `pnpm lint:fix`: check JS/TS and React Hooks / apply safe lint fixes.
- `pnpm format` / `pnpm format:check`: write / check Prettier formatting.
- `pnpm verify`: lint, formatting checks, unit tests, extension build, and workbench build.
- `pnpm lint:go` / `pnpm format:go:check`: cross-target Go vet / gofmt checks.
- `pnpm lint:python` / `pnpm format:python:check`: Ruff checks after installing `requirements-dev.txt`.
- `pnpm build`: type-check and generate the extension in `dist/`.
- `pnpm build:workbench && pnpm workbench`: build and serve the reader at `http://127.0.0.1:4178`.
- `pnpm test` / `pnpm test:e2e`: run unit / browser tests.
- `pnpm package:extension`: create an extension archive.
- `pnpm package:desktop windows-x64`: bundle desktop; also supports `macos-x64` and `macos-arm64`. Run `pnpm test:desktop <target>` on the matching native host.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, and React function components. Prettier enforces two-space indentation, single quotes, semicolons, trailing commas, LF line endings, and a 100-column target. Use kebab-case filenames, PascalCase components/types, and camelCase functions/variables. Format Go with `gofmt` and Python with Ruff. Keep downloaded examples, vocabulary data, licenses, fixtures, and build outputs out of lint/format scope; see `docs/code-quality.md`.

## Testing Guidelines

Vitest uses jsdom; Playwright uses Chromium. Use `*.test.ts` for unit tests and `*.spec.ts` for browser tests; describe behavior. No numeric coverage threshold is configured. Test changed behavior with public/synthetic fixtures and local model mocks, never personal credentials.

Application changes require `pnpm test` and `pnpm build`; reader changes also require `pnpm build:workbench`. Run affected browser flows. On WSL, verify the Linux Chromium cache, then run `PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" pnpm test:e2e`. Documentation-only changes require direct inspection.

## Commit & Pull Request Guidelines

Use imperative summaries; history also uses `feat:` and `fix:`. Prefer Simplified Chinese unless matching surrounding English conventions. Use `codex/<topic>` branches for fixes/features. Review staged changes before committing; significant architecture, persistence, lifecycle, or concurrency changes require independent read-only review. PRs explain behavior, link related issues, report validation/limitations, and include screenshots for UI changes. Preserve unrelated work; push only when authorized.

## Security & Architecture Constraints

Never commit credentials, `.env*`, caches, dependencies, builds, or archives. Preserve original document DOM, PDF viewer state, and unsaved-annotation guards. Reuse existing parsers, request adapters, and scheduling; tooltips must reveal preloaded explanations without model calls. Keep command explanations independent of default-off code annotations.
