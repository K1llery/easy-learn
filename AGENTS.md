# Easy Learn workspace

- Use Git for version control, as requested by the user. Record completed, verified changes in local commits. Do not publish or push without a request.
- Keep API keys, `.env*`, caches, dependencies, build output, test output and zip artifacts out of Git; see `.gitignore`.
- Validate relevant changes with `pnpm test` and `pnpm build`. Browser regression uses public fixtures and a local mock API, never personal credentials.
- Browser command: `EASY_LEARN_CHROMIUM="$PWD/.cache/chromium-manual/chrome-mac/Chromium.app/Contents/MacOS/Chromium" pnpm test:e2e`.
- Keep command explanations independent from the default-off code annotation switch. Tooltip content must be preloaded; do not start model requests on hover.
