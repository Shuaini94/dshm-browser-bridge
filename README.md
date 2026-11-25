# dshm-browser-bridge

把「浏览器自动化」装进 DSHM：插件在宿主进程里架一个本地桥（`127.0.0.1:8765`），
并把内置的浏览器扩展写到 `<workspace>/browser-bridge-extension/`。
Agent 通过桥驱动浏览器：打开网址、点按钮、填表单、读页面文字、调用页面同源接口。

## 安装（DSHM 端侧）

```
pnpm add github.com/<你的账号>/dshm-browser-bridge
```

装完**重启 DSHM 应用**才会挂载（重启前插件列表里看不到，不算失败）。

重启后插件自动：

1. 起本地桥 `127.0.0.1:8765`；
2. 导出扩展文件到 `Download/com.dshm.dshclient/browser-bridge-extension/`。

## 安装浏览器扩展（每台设备一次，手动）

Chrome 内核只接受用户手动加载未打包扩展，插件无法代劳：

1. 海泰浏览器 → `chrome://extensions` → 打开**开发者模式**；
2. 点**加载已解压的扩展程序** → 选 `browser-bridge-extension` 目录；
3. 看到 **DSHM Browser Bridge** 即成功。

## 桥协议

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/enqueue` | 入队命令 `{action, params, target}`，返回 `{id}` |
| GET | `/get?id=` | 取结果，未完成返回 `{pending:true}` |
| GET | `/hello_list` | 已上线客户端 |
| GET | `/ext/<file>` | 下载扩展文件 |

扩展动作：`status` `goto` `text` `html` `click` `hover` `fill` `cookie` `fetch` `api`
`open` `tabs` `query` `count` `rect` `storage` `attach`。

- `target` 是 URL 片段，只有 URL 匹配的标签页会取走该命令；
- 拉起浏览器：调宿主
  `http://127.0.0.1:3120/dshm-open-link?token=<token>&url=<网址>&timeout=8`，
  **不要带 `bundle` 参数**（带了会多弹「暂无应用能打开此文件」）。

## 边界

- 扩展必须跑在浏览器里 ⇒ 浏览器没启动时只能靠上面的宿主启动通道拉起；
- `chrome://`、扩展商店、`about:`、`file://` 无法注入；
- 装扩展前已打开的页面需 F5 一次。

## 许可

MIT
