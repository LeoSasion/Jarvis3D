# Agent 真实运行时与来源验收（2026-10-02）

本轮把回答中的 `[S1]` / `[S2]` 绑定到该回答所属的用户轮次和运行 ID。点击后显示发送时保存的摘录快照；不存在、歧义或旧格式的来源显示“未核验”，不会被错误链接。完整回答可以下载为 Markdown，包含本轮来源路径、行号、截断提示和快照正文。新会话存档保留运行 ID 与用户消息 ID，重启后继续核验同一份快照。

## 已验证

| 范围 | 结果 |
| --- | --- |
| 来源与导出 | 前端 623 项测试通过；Edge/Playwright 使用独立合成夹具，在 1440×1080 和 390×844 下检查 S1/S2 点击、S3 未核验、无摘录追问隔离、旧恢复包装、焦点、中文界面、完整重载后的快照与下载。重载后 Markdown 与首次导出逐字相同，控制台无错误或警告。 |
| 官方 Pi 包 | `third_party/pi/runtime.json` 锁定的 Windows x64 Pi 0.83.0 已下载并按归档/入口 SHA-256、文件数、树收据完成暂存。`pi.exe --version` 返回 `0.83.0`。 |
| Pi 本地 RPC | `scripts/verify-pi-runtime-rpc.ps1` 在独立临时目录、无模型推理下，以 Host 的聊天权限参数调用官方 Pi，`get_state`、`get_messages`、`new_session` 全部成功。 |
| Host→Pi | 使用独立临时 Agent 目录的定向 Host 测试，实际通过 `PiAgentOptions.FromEnvironment` 与 `PiRpcClient` 启动该官方可执行文件，上述三条 RPC 命令均成功，子进程保持连接。 |
| 未配置服务商 | 同样的 Host 通路发送一条纯合成问题，得到 `Accepted=false`、`AUTH_REQUIRED`，没有 Host 崩溃或虚假回答。 |

真实启动检查发现：即使禁用可选主题，Pi 仍从 `PI_PACKAGE_DIR/theme` 读取内置资源。此前 Host 把该环境变量设为空的私有目录，导致 Pi 在首次 RPC 前退出。现在已指向经过完整性验证的 `AgentRuntime` 目录；Agent 可写状态仍保存在独立私有目录，工具、扩展、技能、项目上下文和可选主题继续通过启动参数禁用。

## 尚未验证

当前隔离 Pi 运行没有可用的服务商认证。本轮未向外部服务商发送笔记或请求，因此还不能评价真实回答质量、流式输出、取消、断连、重试和重启续聊的服务商端体验。浏览器来源验收使用纯合成夹具；真实 Pi 的无凭据错误路径使用纯合成问题，没有读取用户 Vault。完成这部分需要在本机安全配置服务商后，用非敏感测试笔记重复“搜索 → 两份摘录 → 问答/比较 → 核对来源 → 重启续聊”并注入取消与断连。

本地复验命令：

```powershell
.\scripts\verify-pi-runtime-rpc.ps1 -RuntimeDirectory C:\path\to\AgentRuntime
```

关联：[下一阶段计划](../next-stage.md)、[Agent 与发布边界](../../host/README.md)。
