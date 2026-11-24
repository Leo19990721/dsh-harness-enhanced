# DSH 办公环境增量更新指引（供 AI 自动执行）

当你（DeepSeek / GPT / Gemini）被用户要求按本指引更新当前 Windows 电脑的 DeepSeek Harness（DSH）时，请**依次执行以下 4 步**。

**严格边界**：
- 不要重装 `agy.exe`，不要修改用户的模型提供商、API Key、订阅登录态、Playwright MCP、权限预设（`cordis.patch.yml`）或聊天记录；
- 不要安装手机远程插件（`ds-harness-remote`、`dsh-remote-enhanced`）或其他无关插件；
- 不要自动关闭或自动启动 `DeepSeek Harness.exe`。

---

## 第 1 步：核对版本与路径，将需更新/需迁移的包下载并校验到固定目录

1. 确定持久化存放目录：`%USERPROFILE%\.dsh\plugin-packages\`（**严禁放到 `%TEMP%`**——`dsh plugin add` 会在 `profiles\desktop\package.json` 中记录 `.tgz` 的 `file:` 路径，放临时目录日后被系统清理会导致下次升级失败）。如目录不存在则创建。
2. 核对 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 中的 `dependencies` 和 `node_modules\<包名>\package.json` 的 `version`，检查以下 3 个自研插件：

| 插件名 | 目标版本 | 文件名 | 下载地址 |
| --- | --- | --- | --- |
| `dsh-subscriptions-enhanced` | `0.4.13` | `dsh-subscriptions-enhanced-0.4.13.tgz` | `https://github.com/Leo19990721/dsh-plugin-subscriptions-enhanced/releases/download/v0.4.13/dsh-subscriptions-enhanced-0.4.13.tgz` |
| `@local/dsh-toolbox-enhanced` | `0.1.8` | `dsh-toolbox-enhanced-0.1.8.tgz` | `https://github.com/Leo19990721/dsh-toolbox-enhanced/releases/download/v0.1.8/dsh-toolbox-enhanced-0.1.8.tgz` |
| `@local/dsh-harness-enhanced` | `0.1.11` | `local-dsh-harness-enhanced-0.1.11.tgz` | `https://github.com/Leo19990721/dsh-harness-enhanced/releases/download/v0.1.11/local-dsh-harness-enhanced-0.1.11.tgz` |

3. **只升级，不降级**。按语义版本（SemVer）比较，不按字符串排序（如 `0.4.9` 低于 `0.4.13`）：
   - 未安装（既无依赖记录，也无安装清单），或实装版本低于表中版本：安装或升级到表中版本。
   - 实装版本等于或高于表中版本，且原引用正常：跳过。若该插件的 `file:` 仍指向 `Temp`，或引用的 `.tgz` 已丢失，只迁移或补回**当前实装的同版本包**：优先复制仍可读取的原包，否则从原发布仓库下载同版本包。不要用表中较旧的包代替。
   - 有依赖记录但查不到实装版本时，不要当作未安装；先用原包清单或锁文件确认版本。若仍无法确认版本，或需要修复的 `file:` 引用找不到同版本包，说明具体问题，不生成可能降级或因缺包而失败的脚本。
4. 将纳入本次安装、升级或迁移的归档先暂存为 `%USERPROFILE%\.dsh\plugin-packages\<文件名>.part`。需要下载时，使用 PowerShell `Invoke-WebRequest -MaximumRedirection 5 -TimeoutSec 120`（沿用系统代理）：
   - 用系统自带 `tar.exe -xOzf "<.part路径>" package/package.json` 解析 JSON，核对 `name`、`version` 和非空的 `dsh.bundle.patch`。安装或升级核对表中版本；修复引用核对当前版本。
   - 校验通过后再原子改名为 `%USERPROFILE%\.dsh\plugin-packages\<文件名>`。若任意一个下载或校验失败，删除该 `.part` 并直接向用户报告原因，不要生成残缺脚本。

---

## 第 2 步：同步办公版全局规则（`AGENTS.md`）

1. 拉取最新版办公规则原文：
   `https://raw.githubusercontent.com/Leo19990721/dsh-harness-enhanced/main/docs/office-AGENTS.md`
2. 对比本机 `%USERPROFILE%\.dsh\AGENTS.md`：
   - 若内容完全一致，直接跳过；
   - 若内容不同，先原样备份旧文件为 `%USERPROFILE%\.dsh\AGENTS.md.bak`，再将最新原文写入（使用 UTF-8 无 BOM）；若旧文件里原本有用户自己补充的个性化规则，在最后汇报里明确提醒并给出 `.bak` 路径。

---

## 第 3 步：生成桌面一次性更新脚本（仅当第 1 步有待更新插件时）

- 第 1 步没有需要安装、升级或迁移的包时，跳过本步。若有版本未确认或失效引用未修复，先报告问题，不生成脚本。
- 只有存在待处理的包且都已校验通过时，才定位本机官方 CLI `dsh.cmd`：优先 `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`；若不在默认目录，尝试从正在运行的 `DeepSeek Harness.exe` 进程路径反推 `<安装目录>\resources\runtime\cli\bin\dsh.cmd`。确认文件存在后再写入脚本。
- 在当前用户桌面写入 `更新DSH插件.cmd`（**必须保存为 UTF-8 无 BOM**，避免首行 `@echo off` 报错；必须用 **`call`** 调用 `dsh.cmd`，并把所有待更新 `.tgz` 合并在**同一条** `add --ignore-scripts` 命令里一次性提交，防止旧临时路径残缺导致中途中断）。按下面模板填入实际展开的绝对路径：

```bat
@echo off
chcp 65001 >nul
setlocal

set "DSH_CLI=<实际存在的 dsh.cmd 绝对路径>"
if not exist "%DSH_CLI%" (
    echo 未找到 DSH 命令行工具：%DSH_CLI%
    pause
    exit /b 1
)

:wait_close
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
    echo.
    echo 检测到 DeepSeek Harness 仍在运行。
    echo 请先彻底退出 DeepSeek Harness（包括右下角系统托盘图标），再按任意键继续...
    pause >nul
    goto wait_close
)

echo.
echo 正在更新 DSH 插件，请稍候...
call "%DSH_CLI%" plugin --profile desktop add --ignore-scripts "<待更新tgz1绝对路径>" "<待更新tgz2绝对路径>"
if errorlevel 1 (
    echo.
    echo 插件更新失败，请将上方报错截图发给支持人员。
    pause
    exit /b 1
)

echo.
echo 全部插件更新完成！请关闭本窗口，再手动重新打开 DeepSeek Harness Desktop。
pause
```

（注意：**严禁**在脚本末尾自动启动 `DeepSeek Harness.exe`；若只更新 1 个或 3 个插件，把 `call "%DSH_CLI%" plugin --profile desktop add --ignore-scripts` 后的引号参数按实际待更新列表一一填入即可。）

---

## 第 4 步：简洁汇报给用户

用简短大白话汇报结果：
- 哪些插件需要安装、升级或同版本迁移，哪些已达目标版本或更高、无需处理；
- `AGENTS.md` 是否有更新；
- 若生成了桌面 `更新DSH插件.cmd`，提醒用户：**彻底退出 DSH Desktop（含右下角托盘图标）→ 双击桌面的 `更新DSH插件.cmd` → 跑完关闭窗口再手动重开 DSH**（桌面脚本用完可直接删除；`%USERPROFILE%\.dsh\plugin-packages\` 下的 `.tgz` 请保留勿删）。
