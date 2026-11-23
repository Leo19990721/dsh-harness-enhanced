# DSH 办公环境增量更新指引（供 AI 自动执行）

当你（DeepSeek / GPT / Gemini）被用户要求按本指引更新当前 Windows 电脑的 DeepSeek Harness（DSH）时，请**仅执行以下增量更新步骤**。

**严格边界**：
- 不要重装 `agy.exe`，不要修改用户的模型提供商、API Key、订阅登录态、Playwright MCP、权限预设（`cordis.patch.yml`）或聊天记录；
- 不要安装手机远程插件（`ds-harness-remote`、`dsh-remote-enhanced`）或其他无关插件；
- 不要自动关闭或自动启动 `DeepSeek Harness.exe`。

---

## 第 1 步：核对当前插件版本，只下载需要更新的包

先检查 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\` 下以下 3 个自研插件当前已安装的版本（读取各自 `package.json` 的 `version` 字段；若未安装则视为需要安装）：

| 插件名 | 目标版本 | 下载地址 |
| --- | --- | --- |
| `dsh-subscriptions-enhanced` | `0.4.12` | `https://github.com/Leo19990721/dsh-plugin-subscriptions-enhanced/releases/download/v0.4.12/dsh-subscriptions-enhanced-0.4.12.tgz` |
| `@local/dsh-toolbox-enhanced` | `0.1.8` | `https://github.com/Leo19990721/dsh-toolbox-enhanced/releases/download/v0.1.8/dsh-toolbox-enhanced-0.1.8.tgz` |
| `@local/dsh-harness-enhanced` | `0.1.11` | `https://github.com/Leo19990721/dsh-harness-enhanced/releases/download/v0.1.11/local-dsh-harness-enhanced-0.1.11.tgz` |

- 已是目标版本的插件**直接跳过**，无需重复下载或覆盖。
- 需要更新或补装的插件，下载到 `%TEMP%\dsh-update\`（先确保目录存在），并确认文件非空、下载完整。

---

## 第 2 步：同步办公版全局规则（`AGENTS.md`）

1. 拉取最新版办公规则原文：
   `https://raw.githubusercontent.com/Leo19990721/dsh-harness-enhanced/main/docs/office-AGENTS.md`
2. 对比本机 `%USERPROFILE%\.dsh\AGENTS.md`：
   - 若内容完全一致，直接跳过；
   - 若内容不同，先原样备份旧文件为 `%USERPROFILE%\.dsh\AGENTS.md.bak`，再将最新原文写入（若发现用户曾自行补充过个性化规则，在最后汇报里明确提醒并给出备份路径，方便按需合并）。

---

## 第 3 步：生成桌面一次性更新脚本（仅当有插件需要更新时）

- 若第 1 步确认 3 个插件**全部已是目标版本**，跳过本步，无需在桌面生成脚本。
- 若至少有 1 个插件需要更新，在当前用户桌面生成 `更新DSH插件.cmd`（注意编码与中文显示不乱码，可用 `chcp 65001 >nul` + UTF-8 无 BOM），逻辑如下：
  1. 检查 `DeepSeek Harness.exe` 是否仍在运行；如仍在运行，提示用户**先彻底退出 DeepSeek Harness Desktop（包括右下角系统托盘图标）**后按任意键重试，直到进程完全退出；
  2. 使用官方 CLI `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add "<已下载的 .tgz 绝对路径>"`，**只依次安装本次下载的新包**；
  3. 任何一步失败时打印错误信息并 `pause`；
  4. 全部成功后打印「插件更新完成！请关闭本窗口，再手动重新打开 DeepSeek Harness Desktop。」并 `pause`；
  5. **严禁在脚本里自动启动 `DeepSeek Harness.exe`**（避免关闭命令行窗口时连带关闭 DSH）。

---

## 第 4 步：简洁汇报给用户

用简短大白话汇报结果：
- 哪些插件需要更新（从什么版本升到什么版本）、哪些已是最新；
- `AGENTS.md` 是否有更新；
- 若生成了 `更新DSH插件.cmd`，提醒用户：**彻底退出 DSH Desktop（含右下角托盘图标）→ 双击桌面的 `更新DSH插件.cmd` → 跑完关闭窗口再手动重开 DSH**（桌面脚本用完可直接删除）。
