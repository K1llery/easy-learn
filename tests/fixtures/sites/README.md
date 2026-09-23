# Offline documentation regression fixtures

These small, hand-written DOM fixtures test structural patterns seen on public documentation and course pages. Tests never load these sites or send content to a real model service; Playwright routes annotation requests to its local mock API.

- `fastapi-python-types.html` — [FastAPI Python Types Intro](https://fastapi.tiangolo.com/python-types/); repeated “type hints”.
- `missing-semester-course-shell.html` — [MIT Missing Semester shell course](https://missing.csail.mit.edu/2026/course-shell/); `missing:~$`, a WSL-style `user@host` prompt, `sed -i`, and terminal output.
- `python-cli.html` — [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/); several shell prompts in one code block.
- `http-methods.html` — [MDN HTTP request methods](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/); prose and a curl terminal snippet.
