# DSH 办公环境一键初始化指引（供 AI 自动执行）

当你（DeepSeek / GPT / Gemini）被用户要求按本指引配置当前 Windows 电脑的 DeepSeek Harness（DSH）时，请**依次完成以下 5 步**。不要安装手机远程（`ds-harness-remote`、`dsh-remote-enhanced`）、WPS 365 或额外技能，不要修改用户已有的模型提供商与 API Key。

---

## 第 1 步：安装官方 Google Antigravity CLI（`agy.exe`）

1. 检查 `%LOCALAPPDATA%\agy\bin\agy.exe` 是否已存在。
2. 若不存在，在 PowerShell 中执行 Google 官方安装脚本（会自动沿用当前系统代理并校验下载）：
   ```powershell
   irm https://antigravity.google/cli/install.ps1 | iex
   ```
3. 安装后再次确认 `%LOCALAPPDATA%\agy\bin\agy.exe` 存在即可；**不要在命令行里交互启动 `agy` 登录**（后续让用户在 DSH「设置 → 模型 → 订阅账号 → Google Antigravity」点「登录」走官方 OAuth 即可）。
4. 若因网络原因暂未下载成功，不要卡住后续步骤，记录原因并在最后告知用户稍后补装即可。

---

## 第 2 步：写入办公版全局规则（`AGENTS.md`）

1. 下载办公版规则原文：
   `https://raw.githubusercontent.com/Leo19990721/dsh-harness-enhanced/main/docs/office-AGENTS.md`
2. 目标路径：`%USERPROFILE%\.dsh\AGENTS.md`。
3. 若目标文件已存在且内容不同，先原样备份为 `%USERPROFILE%\.dsh\AGENTS.md.bak`，再将下载的原文原样写入（不要自行删改内容）。

---

## 第 3 步：配置安全权限预设与 Playwright MCP

1. 目标文件：`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`。修改前先在同一目录外或以 `.bak` 备份原文件，**严格保留文件中所有已有的模型提供商、API Key 及其他配置**。
2. **默认权限预设**：确保 `@deepseek-ai/dsh-permission-presets`（`id: permission`）存在并将 `defaultPreset` 设为 `workspace-write`（`workspace-write` 保持 `sandbox: workspace-write`、`approval: ask`）。
3. **Playwright MCP**（若配置中尚无 `id: mcp-playwright`）：
   - 自动探测本机 Chrome 路径（常见为 `C:\Program Files\Google\Chrome\Application\chrome.exe`、`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe` 或 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`）。
   - 使用本机 DSH 自带 Node（`%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`）与 npm/pnpm，将 `@playwright/mcp` 安装到 `%USERPROFILE%\.dsh\tools\playwright-mcp`（如已存在则复用，找到其中 `node_modules\@playwright\mcp\cli.js`）。
   - 在 `cordis.patch.yml` 追加如下 `insert` 项（将路径替换为当前电脑真实展开后的绝对路径，不要写死其他用户名或盘符）：
     ```yaml
     - insert:
         - id: mcp-playwright
           name: '@deepseek-ai/dsh-mcp-client'
           config:
             serverName: playwright
             transport: stdio
             command: '<当前用户>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
             args:
               - '<当前用户>\.dsh\tools\playwright-mcp\node_modules\@playwright\mcp\cli.js'
               - --browser
               - chrome
               - --executable-path
               - '<探测到的本机 chrome.exe 绝对路径>'
               - --headless
               - --user-data-dir
               - '<当前用户>\.dsh\browser-profiles\playwright'
               - --output-dir
               - '<当前用户>\.dsh\artifacts\playwright'
               - --output-max-size
               - '104857600'
               - --codegen
               - none
               - --console-level
               - warning
             cwd: '<当前用户桌面路径>'
             startupTimeoutMs: 30000
             toolCallTimeoutMs: 90000
             closeTimeoutMs: 10000
             failOnStartupError: false
             reconnect:
               enabled: true
               initialDelayMs: 500
               maxDelayMs: 30000
               maxAttempts: 10
     ```

---

## 第 4 步：下载插件包并生成桌面一次性安装脚本

1. 将以下 3 个自研插件包下载到 `%TEMP%\dsh-install\`（先确保目录存在）：
   - `https://github.com/Leo19990721/dsh-plugin-subscriptions-enhanced/releases/download/v0.4.11/dsh-subscriptions-enhanced-0.4.11.tgz`
   - `https://github.com/Leo19990721/dsh-toolbox-enhanced/releases/download/v0.1.8/dsh-toolbox-enhanced-0.1.8.tgz`
   - `https://github.com/Leo19990721/dsh-harness-enhanced/releases/download/v0.1.10/local-dsh-harness-enhanced-0.1.10.tgz`
2. 在当前用户桌面生成 `安装DSH插件.cmd`（UTF-8 无 BOM 或 GBK 兼容，确保中文不乱码），执行逻辑如下：
   - 检查 `DeepSeek Harness.exe` 是否仍在运行；如仍在运行，提示用户彻底退出 DSH Desktop（包括右下角托盘图标）后按任意键继续，直到进程完全退出；
   - 使用官方 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd plugin --profile desktop add` 依次安装以下 6 个插件（**不要安装 `ds-harness-remote` 或 `dsh-remote-enhanced`**）：
     1. `dsh-toolbox-ui`
     2. `dsh-windows-mcp`
     3. `dshmarket`
     4. `%TEMP%\dsh-install\dsh-subscriptions-enhanced-0.4.11.tgz`
     5. `%TEMP%\dsh-install\dsh-toolbox-enhanced-0.1.8.tgz`
     6. `%TEMP%\dsh-install\local-dsh-harness-enhanced-0.1.10.tgz`
   - 任何一步失败时打印错误信息并 `pause`；
   - 全部成功后打印「全部插件安装完成！请关闭本窗口，再手动重新打开 DeepSeek Harness Desktop。」并 `pause`。
   - **严禁在脚本里自动启动 `DeepSeek Harness.exe`**（避免关闭命令窗口时连带关闭 DSH）。

---

## 第 5 步：简洁汇报并提示用户收尾

完成以上 4 步后，用简洁直白的话向用户汇报每一步的结果（是否成功、如有异常简明说明），并提醒用户完成最后 2 步：
1. 彻底退出 DSH Desktop（右下角托盘也退出），双击桌面 **`安装DSH插件.cmd`**；跑完关闭窗口，再手动重新打开 DSH（桌面该脚本用完可直接删除）。
2. 重开 DSH 后：
   - 如需让 AI 操控桌面软件，点输入框下方的「AI 控制电脑」按引导完成 Windows MCP 初始化；
   - 打开「设置 → 模型 → 订阅账号」，按需点击登录 Codex 或 Google Antigravity 即可开始使用。
