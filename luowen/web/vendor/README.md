# vendor/ —— 预构建第三方产物（DEC-043 阶段 C 政策）

| 文件 | 来源 | 版本 | 许可证 | 用途 |
|---|---|---|---|---|
| `elk.bundled.js` | npm `elkjs@0.9.3`（kieler/elkjs） | 0.9.3 | EPL-2.0（LICENSE-elkjs.md） | 自动布局对照算法 ELK Layered（UMD，浏览器挂 `self.ELK`，Node 可 require） |
| `dagre.min.js` | npm `dagre@0.8.5`（dagrejs/dagre） | 0.8.5 | MIT（LICENSE-dagre.txt） | 自动布局对照算法分层布局（UMD，挂 `self.dagre`） |

政策（DEC-043 阶段 C）：仅手动升级（npm 拉取后覆盖 bundle，本目录不动其它）；终选若为自研算法，两份产物连同登记一并移除。许可全文见本目录 `LICENSE-elkjs.md` / `LICENSE-dagre.txt`。
