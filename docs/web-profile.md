# 共享 Web profile（本地分支）

`sh bin/dsh-tui-web` 通过官方 DSH CLI 启动 `--profile web`，只叠加
`cordis.web-ui.patch.yml`。每次启动直接读取 Web profile 的 bundle、安装包、
用户补丁和 home 补丁，没有另一份需要同步的 TUI 后端配置。

上游自动化命令（`run`、`-p`、`cli`、`session`、`models`、`skills`、`mcp`、
`auth`、`capabilities`、`dsh`）保留原参数，直接进入独立 CLI，沿用上游
默认的 headless profile，不叠加终端 UI。详见 [CLI](cli.md)。

覆盖层只增加终端 UI 服务、替换 Web 命令行解析器，并使用独立的 loopback
动态端口，让原来的 3080 Web 服务继续运行，不自动打开浏览器。KB、Pi
兼容、SSH、LiveVoice 等仍是 Web 的同一份安装包；LiveVoice 的麦克风和
音频控件仍属于浏览器界面。

`dsh-tui.followProfileDefaults: true` 从共享 DSH 服务读取默认模型、推理
强度和预设。旧的 `~/.dsh-tui/model.json`、`effort.json`、
`agent-preset.json`、权限默认值和 TUI effortDefault 不再覆盖 Web；终端
显示偏好继续保留。该模式跳过 TUI 自己增加的模型工具、提示词过滤器和
重试默认值。TUI 的模型和预设选择通过共享设置服务保存。显式会话选择和
已有会话历史继续属于各自会话，与 Web 一样，不因默认值改变而重写历史。

沿用 DSH HMR 监视 Web 配置补丁和 bundle 列表；运行中可应用配置修改及
bundle 的增加、删除。新会话读取最新默认值。已加载的核心代码或包解析
变化可能需要重启 TUI；重启直接使用 Web 当前安装，无需第二次更新或复制。
终端 UI 本身的代码由本地分支维护。

共享的是配置与安装包，不是同一个运行中的 Agent 进程。Web 和各终端保有
自己的活跃 Agent，使用同一个会话存储。

验证：

```sh
npm run compile:src
node scripts/verify-web-profile-follow.mjs
python3 scripts/verify-web-profile-pty.py
```

测试使用隔离的 home 并禁止外部 fetch。前者检查后端配置相等及实时配置、
bundle 更新；后者使用真实终端 UI，检查旧 TUI 偏好不会覆盖 Web，并在
Web 配置修改后通过 `/new` 验证新会话。
