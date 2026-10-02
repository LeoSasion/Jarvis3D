# Pi 1.0.0 runtime upgrade (2026-10-03)

JARVIS now pins the official [Pi v1.0.0 release](https://github.com/earendil-works/pi/releases/tag/v1.0.0) (published 2026-10-01) instead of v0.83.0. The GitHub release API and npm `latest` tag both identified v1.0.0. The tag resolves to `a13d35a742c6ef8462812a28fbe1d8c8b7431c32`.

The official `pi-windows-x64.zip` is 45,041,072 bytes with SHA-256 `f7dbd39814bf6763f01e7f688ad089615de1d0eb55fc8915a49acdc2088f4404`. Its hash matches both the release asset digest and the release's `SHA256SUMS`. The source archive and `SHA256SUMS` independently matched their release-asset digests. The runtime stager verified all 243 archive entries (214 files), the 21,360-byte sorted per-file receipt (`89e4a41dfc0aa46ea182e5aa543612275ff919337884bd23c583d15638452e51`), and the `pi.exe` SHA-256 `116c50f3fd36e0348f20d00f06d30eebdc4dd961bf8f89ad3b29f441cba2dfab`. The upstream executable remains unsigned. The upstream MIT license text has the same canonical hash as the previously pinned license.

Pi's [RPC reference](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/rpc.md) and [changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md) document two relevant changes since v0.83.0: `message_update` is delta-only, and a successful `prompt` may have disposition `started`, `queued`, or `handled`. JARVIS already consumes text deltas and treats `message_end` as authoritative. Its single-run chat adapter now accepts only `started`; a queued, handled, absent, or unknown disposition fails closed rather than leaving a visible run waiting forever. The production launch flags continue to disable all tools, extensions (including new built-ins), skills, project context, approvals, and Pi-managed sessions. The v1.0.0 TUI fullscreen default does not apply to JSONL RPC mode.

| Check | Result |
| --- | --- |
| Offline staging safety suite | 12 passed, including three checks using the official v1.0.0 archive. |
| Pi native executable | `pi.exe --version` returned `1.0.0`; isolated `get_state`, `get_messages`, and `new_session` RPC calls succeeded. |
| Host-to-Pi process path | A temporary Host XUnit probe constructed the production `PiRpcClient` with the complete trusted runtime tree and successfully sent the same three commands; the process remained connected. The probe source was removed after execution. |
| No-auth prompt | In a fresh agent directory with credential environment variables removed, Pi rejected a synthetic prompt with its API-key-required error. No provider request was made. |
| Complete response without a cloud provider | A temporary model configuration and HTTP server bound only to `127.0.0.1` returned one deterministic OpenAI-compatible response. With the production RPC launch flags and no `--provider`/`--model` overrides, Pi reported `disposition: started`, emitted `text_delta`, completed the assistant message with `stopReason: stop`, and emitted `agent_settled`. Exactly one loopback request occurred. |
| Host unit suite | 483 tests passed, including started-versus-queued/handled/invalid disposition cases. |
| Exact-commit Windows candidate | `0.1.0-rc.20261003` was built from clean source commit `b57ec9cf6ce424ba395955d501daf65082f5252f`. Release verification passed for 783 package files and all 784 portable ZIP entries. The portable ZIP SHA-256 is `a9e56557601de687202f2f4eb4a9352e77681c338d7e3db8839ec1c120d34805`; the installer SHA-256 is `22be85750437f0e1ca9364689928f07f851d367f89286ec45ef04f6ae9a63c40`. |
| Isolated installer lifecycle | Install, no-window Host lifecycle probe, repair, uninstall, startup cleanup, and Pi runtime verification all passed. Explorer remained present and no JARVIS process remained. The candidate's renderer smoke passed in `en-US` and `zh-CN`. |

The test prompts were synthetic and did not read the user's Vault. No external model provider was called. Real-provider answer quality, cancellation, network failures, and recovery still need a separate credentialed acceptance run with non-sensitive notes. This upgrade does not claim those behaviors were tested.

The candidate packages are local at `artifacts/installer/JARVIS-Setup-0.1.0-rc.20261003-win-x64.exe` and `artifacts/release/JARVIS-0.1.0-rc.20261003-win-x64.zip`. These generated artifacts are not tracked in Git; the release and installer verification receipts are under `artifacts/validation/`. The candidate was tested in an isolated current-user install path and did not replace a normal JARVIS installation.

Repeat the packaged-runtime checks after staging:

```powershell
.\scripts\test-pi-runtime-staging.ps1 -ArchivePath .\artifacts\vendor\pi\1.0.0\pi-windows-x64.zip
.\scripts\verify-pi-runtime-rpc.ps1 -RuntimeDirectory .\artifacts\staged\pi\1.0.0\AgentRuntime
dotnet test .\host\Jarvis.Host.Tests\Jarvis.Host.Tests.csproj -c Release
```
