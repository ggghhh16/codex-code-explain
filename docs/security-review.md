# 0.2.1 pre-release review

Scope: source, documentation, tests, debug configuration, and a freshly built VSIX prepared for release. This is not a complete security certification for all Codex versions.

## Fixes

1. Redaction now covers quoted JSON fields, unquoted environment variables, Bearer tokens, JWTs, connection-string passwords, private-key blocks, and common credential files. Pattern matching still cannot catch every secret.
2. Files outside the workspace use short `external/filename` labels instead of full home-directory paths.
3. Codex lookup ignores empty and relative PATH entries, and custom paths must be absolute. Processes are still launched directly without shell interpolation.
4. Note appending rejects directories, direct symlinks, and hard links; it uses `O_NOFOLLOW` where available and checks the opened file type.
5. Git exclusions and the package file list were tightened. Package links are rejected and the client version comes from the manifest.

## Published content

Only source, tests, scripts, documentation, and necessary debug configuration are committed. Test-host configuration, logs, screenshots, temporary notes, generated protocols, old packages, and release-preparation directories stay out of Git. New VSIX files are attached to Releases separately.

The reviewed public source contained no real access tokens, private keys, sign-in cookies, or personal email addresses. Test credentials were explicitly fixed fake data. The Git author used a GitHub noreply address.

## Verification

Fourteen Node tests passed, covering sensitive-file detection, common-key redaction, external-file labels, rejection of relative executables and hard-link writes, RPC behavior, note deduplication, and hover command isolation. The VSIX manifest and public files were also scanned before release.

## Remaining limits

Model explanations can be wrong; pattern matching does not replace human review of sensitive source. Permission enforcement depends on local Codex and the operating system. Trusted third-party language services, the Codex executable, and other processes modifying files are outside the extension's isolation. Simultaneous saves across VS Code processes cannot guarantee strict deduplication.
