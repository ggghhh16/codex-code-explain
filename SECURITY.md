# Security and data handling

This is an independently developed, third-party VS Code extension, not an official OpenAI or Microsoft product.

## Data sent to Codex

When you request an explanation or follow-up, the selection, limited nearby code, language-service definitions and types, and current conversation are processed through your local Codex account and service provider. Ordinary hovering only displays cached results. The extension neither stores nor displays sign-in credentials and has no separate telemetry service.

Common credential files are excluded. Common keys, Bearer tokens, JWTs, connection-string passwords, and sensitive field literals are redacted. Labels for files outside the workspace omit full local paths. Pattern matching cannot detect every secret; do not keep production credentials in source code. Installed language services are user-controlled extensions, not a security boundary.

## Execution and file operations

- Codex is launched with direct process arguments and `shell: false`. Automatic lookup ignores empty or relative PATH entries; a configured executable path must be absolute.
- The extension uses a restricted named permission profile and disables inherited shell, MCP, app, and other integrations. Model instructions limit it to explaining supplied material. Codex versions or administrator configuration can affect capabilities; connection errors do not trigger a fallback to broader permissions. The extension is not an operating-system sandbox independent of Codex.
- Model text is not trusted to create executable command links. Hover actions use a separate command allowlist. The Webview uses a content security policy and escaped rendering, without remote scripts.
- Notes are written only after you click Save. They are appended only to ordinary `.md` files. Direct symlinks, hard links, directories, and files with unsaved edits are rejected. Directory permissions, concurrent processes, and file-replacement races on Windows remain subject to the host filesystem.
- The workspace must be trusted. Do not trust unknown projects or run arbitrarily configured executables.

## Repository and package

Local test configuration, logs, sign-in files, screenshots containing local paths, generated protocols, and old VSIX files are not committed. An explicit file list controls the package contents and excludes tests, caches, and user settings.

## Reporting issues

Do not upload tokens, private keys, sensitive source code, or credential-bearing logs to public issues. For security issues, prefer the repository's private vulnerability-reporting feature if enabled; otherwise open a contact request without exploit details or sensitive content.

Only local Windows VS Code and the documented Codex version have been verified. This is not a third-party penetration test or formal security proof.
