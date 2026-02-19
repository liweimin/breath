# 呼吸冥想引导（静态网页）

这是一个基于 `HTML + CSS + JavaScript` 的静态网页应用，支持：
- 自定义吸气 / 暂停1 / 呼气 / 暂停2 的秒数
- 实时声音引导（含环境雨声氛围）
- 导出整段练习音频为 `WAV`

## 项目由来

这是我用 Vibe Coding（Codex）做的一个小工具。  
我一直喜欢冥想，也发现 vibe coding 里常有等待和不确定。与其焦躁，不如用几轮呼吸把注意力收回来。这个页面是做给自己，也给同样在路上的人。

## 开源地址

- `https://github.com/liweimin/breath`

## 本地运行（推荐）

建议使用本地 HTTP 服务运行，避免浏览器对 `file://` 的限制：

```bash
python -m http.server 5500
```

浏览器打开：`http://localhost:5500`

## 文档目录

- `docs/MVP-需求文档.md`
- `docs/技术方案.md`
- `docs/项目现状.md`
- `docs/环境与命令.md`
- `docs/架构说明.md`
- `docs/关键决策.md`
- `docs/已知问题.md`
- `docs/迭代计划.md`
- `docs/迭代日志.md`

## 关于 `file://` 打开时的导出

如果你是双击 `index.html` 打开的（地址栏是本地磁盘路径），部分浏览器会限制音频文件读取/解码。当前逻辑如下：
- 能读取到真实呼气音频时：导出使用真实呼气音
- 读取被浏览器限制时：自动回退为合成呼气音，导出依然可以成功
- 想要最稳定、和线上一致的效果：请用本地 HTTP 服务打开

可选：如果你希望 `file://` 下也尽量使用内嵌音频数据，可先生成 `audio-data.js`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\generate-audio-data.ps1
```

## 部署到 Vercel（静态项目）

1. 先把代码推送到 GitHub。
2. 在 Vercel 中 `New Project` -> `Import Git Repository` -> 选择这个仓库。
3. `Framework Preset` 选 `Other`。
4. `Build Command` 留空；`Output Directory` 填 `.`（项目根目录）。

## 下次用 Codex / Claude Code 继续优化（建议流程）

1. 先同步代码并确认基线：
```bash
git pull
git log --oneline -n 5
```
2. 先让 AI 读取这几份文档：`docs/项目现状.md`、`docs/架构说明.md`、`docs/已知问题.md`、`docs/迭代计划.md`。
3. 一次只提一个明确目标（例如“修复某浏览器声音兼容”），并写清验收标准（在哪些设备/浏览器通过）。
4. 要求 AI 先给“修改点清单”，你确认后再提交和推送。
5. 每轮改动后按顺序验证：本地 HTTP -> 手机 Chrome -> 线上 Vercel。
6. 合并后更新 `docs/迭代日志.md` 和 `docs/项目现状.md`，保证下一次可以无缝衔接。
