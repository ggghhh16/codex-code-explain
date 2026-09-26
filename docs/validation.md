# Validation record

## 0.2.0 native hover

- Nine Node tests passed, including command-link isolation, preservation of source characters, and exclusion of incomplete answers from quotes and notes.
- Real VS Code with real Codex showed an answer in native hover alongside another language-service provider. The tab count stayed the same and no Webview opened. Context contained one real definition and one type hint without treating this extension's own explanation as type evidence.
- A real VS Code UI test with a fixed sample answer clicked Follow up, selected a quoted passage, changed reasoning effort, and saved a short note. Screenshots: `artifacts/native-hover.png`; results: `artifacts/native-ui/result.json`.
- The backend receives streaming output, but native hover refreshes on completion. It does not have an embedded input or custom slider.

The following records cover 0.1.0 and the reused backend.

Date: 2026-09-23. Target: local Windows VS Code desktop. Environment: VS Code `1.138.0`, Codex `0.155.0-alpha.16`. Live generation used the account's default `gpt-6-astra` model at `medium` reasoning effort.

## Verified

- Node tests covered out-of-order JSON-RPC responses, refusal of execution approval, process-exit cleanup, invalid model/effort/fast settings, early completion notifications, concurrent note appends and deduplication, and basic credential filtering.
- Real Codex covered initialization and model catalog, streaming explanation, follow-up in the same conversation, short-note generation in a separate conversation, local append, and cancellation.
- A real headless Edge session covered quoting an answer and asking a follow-up, fast-mode settings messages, Save messages, resizing from all four corners, settings visibility in a narrow panel, and non-execution of HTML and command links. No page-script errors were observed.
- A real VS Code Extension Development Host covered activation, the selection command, Webview readiness, code-context collection, and a streamed response from real Codex. It used isolated configuration and exited afterward.
- VS Code CLI successfully installed a VSIX into an isolated extension directory inside the project.

Reproduction scripts: `test/core.test.js`, `scripts/smoke.js`, `scripts/ui-test.js`, and `test/host.js`. Raw results are under `artifacts/`. UI screenshots use sample data; real model output is separately under `artifacts/smoke-session/`.

## Not covered

- Actual billing and performance for every account, model, and fast tier. Available UI options come from the model catalog and settings are sent through the real protocol.
- Remote SSH, WSL, Dev Containers, web VS Code, and older Codex versions.
- Simultaneous writes to one notes file from separate VS Code windows.
- Long-running use, very large conversations, every language, and every language service.

Testing exposed an incompatibility between the current named Codex permission profile and the old `readOnly.access` API. The current implementation does not broaden permissions after an error.
