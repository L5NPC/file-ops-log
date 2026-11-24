# 文件操作日志

简体中文 | [English](README.md)

记录 Harness 智能体执行的每一次文件操作，并在 Web 界面中展示。

## 安装

需要 Web 或 Desktop 版 DSH 配置（Host 部分依赖 `connection` 服务）。已在 DSH `0.2.2-rc.5` 上测试。

- **从本仓库安装：** 打开 插件 → 添加插件，填入 `https://github.com/L5NPC/file-ops-log.git`。
- **从本地目录安装：** 把本目录复制到一个固定的位置，然后在“添加插件”中填入它的绝对路径。
- **从包仓库安装：** 以唯一名称发布本包，然后按包名安装。

安装会在配置中保留或链接源码目录，因此之后不要删除或移动该目录。

## 界面位置

插件包安装并启用后，侧边栏会出现 **文件操作** 图标，点击它会在主栏中打开一个完整页面。

页面按时间倒序列出操作，按天分组，并提供：

- 带数量的类型筛选：创建、修改、删除、移动、复制、读取、其他；
- 最新优先与最早优先之间的切换；
- 对路径、命令、工具名和会话 ID 的搜索；
- 手动刷新，以及页面打开期间每 8 秒自动刷新一次；
- 每一行显示执行该操作的对话（会话标题）；点击该标题即可打开对应对话。列表无法打开的子代理会话会回退到它的上级对话，不可用的会话则以禁用状态显示并说明原因。

## 记录的内容

Host 部分监听共享的工具管道（先 `tools/pre-execute`，再 `tools/result`），并据此分类：

| 工具 | 操作 |
|---|---|
| `write` | 创建或修改（依据最终结果判定） |
| `edit` | 修改 |
| `apply_patch` | 依据补丁头判定 创建 / 修改 / 删除 / 移动 |
| `read`、`read_image` | 读取 |
| `present` | 其他（交付物） |
| `office_*` | 其他（生成的文件） |
| `bash` | 可识别的 Unix 文件命令：`rm`、`rmdir`、`unlink`、`shred`、`mv`、`cp`、`rsync`、`ditto`、`ln`、`install`、`mkdir`、`touch`、`mktemp`、`tee`、`truncate`、`dd`、`sed -i`、`perl -i`、`git rm`、`git mv`、`find -delete`，以及输出重定向 |
| `pwsh` | PowerShell/cmd 文件命令：`Remove-Item`（`del`、`erase`、`rd`、`ri`）、`Move-Item`（`move`、`mi`）、`Rename-Item`（`ren`、`rni`）、`Copy-Item`（`copy`、`cpi`、`xcopy`、`robocopy`）、`New-Item`（`md`、`ni`）、`Set-Content`、`Add-Content`、`Clear-Content`、`Out-File`、`Tee-Object`、`Invoke-WebRequest -OutFile`，以及 `>`/`>>` 重定向 |

每条记录保存操作类型、工具、路径、可选详情（shell 命令或补丁摘要，最多 1000 个字符）、成功/失败、开始与结束时间、耗时，以及智能体的会话 ID。

一次工具调用若执行了多个操作，会为每个操作生成一行，共用该调用的时间和详情。这些行带有 `1/3` 标记；如果该调用失败，它们的结果会显示为 **结果未知**，因为汇总结果无法说明是哪一步失败。

## 限制

- Shell 操作依据命令文本识别。隐藏在脚本、别名或非常规命令形式中的文件操作可能不会被记录（例如 `bash -c "rm x"` 或 `node -e "..."`）；仅在 shell 中读取文件而不写入的命令不会被记录。输出重定向记为 **修改**，`find -delete` 和 `patch` 只报告操作而不臆造目标路径。
- Windows：`pwsh` 工具按 PowerShell 参数规则解析，因此 `-Path`/`-Destination`/`-FilePath` 的值会被记录，而 `-ItemType Directory`、`-Value` 等非路径值不会被误当成路径。表中未列出的 PowerShell 专有命令（例如 `Expand-Archive`、`Set-ItemProperty`）不会被记录。Windows 上的 `bash` 命令按 Unix 语法处理。
- 只有经过 Harness 工具管道的调用才会被记录。Host 侧或外部的写入不在插件的可见范围内。
- 页面提供内存中保留的最新 2000 条记录；JSONL 文件保留更多历史。当窗口已满时，页面会给出提示。
- 该路由由 Web 载体鉴权，仅对所属浏览器会话可用。

## 数据

记录追加写入 `$DSH_HOME/plugin-data/file-ops-log/operations.jsonl`
（默认 `~/.dsh/plugin-data/file-ops-log/operations.jsonl`）。文件达到 4 MiB 时轮转为 `operations.1.jsonl`。删除该目录即可清空历史。

停用插件包会停止记录，并移除侧边栏图标和页面。
