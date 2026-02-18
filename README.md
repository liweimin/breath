# 呼吸冥想引导（静态网页）

这是一个基于 `HTML + CSS + JavaScript` 的静态网页应用，支持：
- 自定义吸气 / 暂停1 / 呼气 / 暂停2 的秒数
- 实时声音引导（含环境雨声氛围）
- 导出整段练习音频为 `WAV`

## 本地运行（推荐）

建议使用本地 HTTP 服务运行，避免浏览器对 `file://` 的限制：

```bash
python -m http.server 5500
```

浏览器打开：`http://localhost:5500`

## 文档目录

- `docs/MVP-需求文档.md`
- `docs/技术方案.md`

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
