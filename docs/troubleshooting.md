# 调试记录

从零到能用踩过的坑。按主题整理，不是时间线。

---

## 一、Tampermonkey 装不上 / 装了不跑

### 症状

脚本显示已安装、图标上有数字、但页面毫无反应。

### 根因

**Edge 137+ 把用户脚本拆成独立权限**，必须在扩展详情页手动开启。

| 项 | 位置 | 说明 |
|---|---|---|
| 开发人员模式 | `edge://extensions` 左下 | **不等于**用户脚本权限 |
| 允许用户脚本 | 扩展详情页 → 权限区 | 真正的开关 |

这个开关状态写在 `Secure Preferences` 里，但是**加密存储**：

```json
"ui": {
  "developer_mode": "8010149633DD8C6F879F2F95B4D2F3537FEA233CC322355CD5B8439FC8EA6F0...",
  "developer_mode_encrypted_hash": "djIwd2Fw1iJZc5s6IqFlNTQbBVYwxHuCEye5jGB2amv4+cnR"
}
```

配置文件改不了，只能用 UI 操作。

### 修复

只能手动开，或用 UI Automation 拨那个开关：

```powershell
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
# 找到 x≈1813 处的无名 Button，读 ToggleState / 调 Toggle()
$btn.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
```

### 附带的坑

开关打开后**必须完全重启浏览器**。任务栏里残留一个 `msedge.exe` 进程，权限就不会重载。

---

## 二、本地脚本装不上（混合内容）

### 症状

用 `python -m http.server` 托管 `*.user.js`，在地址栏打开后跳到：

```
https://www.tampermonkey.net/script_installation.php#url=http://127.0.0.1:8765/xxx.user.js
```

页面显示「This page is not intended to be viewed directly」，没有安装按钮。

### 根因

Tampermonkey 把 `*.user.js` 的重定向交给了官网的 **HTTPS 中转页**，那个页面再去 `fetch` `http://127.0.0.1` —— **HTTPS 页面请求 HTTP 资源 = 混合内容，被浏览器拦截**。

### 修复

走扩展页面内部的「实用工具 → 从 URL 安装」。扩展有全站访问权限，不受混合内容限制。

自动化版本：

```powershell
# 1. 打开 chrome-extension://<id>/options.html#nav=utils
# 2. UIA 找到 Edit 控件，SetValue 填入 URL
# 3. UIA 找到「安装」按钮，InvokePattern.Invoke()
# 4. 确认页再点「更新 / 安装」
```

---

## 三、复制脚本到 Console 变成乱码

### 症状

粘贴后 Console 报 `SyntaxError: Invalid or unexpected token`，代码里的中文显示成 `锟斤拷`。

### 根因

PowerShell 的 `Get-Content -Raw` 在 5.1 版本默认按 **GBK** 解析 UTF-8 文件，读出来就已经是乱码，再写进剪贴板自然坏掉。

### 修复

显式指定编码，并且**脚本本身保持纯 ASCII**（中文用 `\uXXXX` 转义）：

```powershell
$c = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $c
```

或者干脆 `[System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($p))`，前提是文件里没有非 ASCII 字符。

### 附带的坑

Edge DevTools 的 Console 有**粘贴保护**：首次粘贴会要求手动输入 `allow pasting`。这也可能导致「Ctrl+V 什么都没出来」。

---

## 四、播放器认错元素

### 症状

`duration` 读到 `NaN` 或 `0`，而界面上明明显示着时长。

### 根因

学习通页面里存在多个 `<audio>`，其中 `id="auditionAudio"` 是**试听占位元素**，永远不加载媒体：

```html
<audio id="auditionAudio" src="...c2=1&isMicroCourse=false&editorPreview=0">
```

真正的播放器由 video.js 生成，`id="audio_html5_api"`。

### 修复

不能取 `querySelector` 的第一个，必须按有效性过滤：

```js
const playable = all.filter(m => isFinite(m.duration) && m.duration > 0
                              && (m.currentSrc || m.src));
```

---

## 五、多个音频同时播放 → 触发风控

### 症状

三个音频进度同时前进，页面弹出：

```
【9010】操作异常，请输入图片中的验证码
服务繁忙，不能保证您能否正常完成任务...(e: 202)
```

### 根因

油猴的 `@match` 会让脚本在**每个 frame 各注入一份**。学习通每个附件独占一个 iframe，于是每个 iframe 的实例各自播放自己的孩子，全部同时开始。

### 修复

```js
if (window.top !== window) return;   // 子 frame 全部退出
```

顶层用递归穿透 iframe 收集所有媒体，统一调度。

外加三重保险：

- 每轮 `pause()` 所有非当前播放器
- 移除播放器绑定时的 `forcePlay()`
- 移除 `pause` 事件里的「1.2 秒后自动恢复播放」

### 风控后的处理

手动填验证码，然后**停 30 分钟以上**。学习通的风控是累加的，短时间内反复触发会从验证码升级到成绩作废。

---

## 六、任务点走完不打勾

### 症状

进度条跑到 100%，直接跳了下一节，但上一个任务点的圆圈数字没归零。

### 根因

服务端记录进度不是瞬时的。播放器周期性上报 `playingTime`，最后一次上报（等于总时长）需要在切节前落地。

### 修复

播完后固定等 **15 秒**再切。

试着靠读页面的「任务点已完成」文字来判断，但那个文字不在 `innerText` 里（Vue 渲染成别的节点），读不到，所以改回固定等待。

---

## 七、纯图文章节卡死

### 症状

文档 / 图片类章节（没有任何音视频）停在原地不动。

### 根因

```js
const list = playable();
if (!list.length) return;   // 没媒体就直接退出，永远走不到切节逻辑
```

### 修复

加无媒体计时器，停留 15 秒后 `nextUnit()`。这个停留同时也满足服务端「浏览过文档」的记录要求。

---

## 八、其他框架不可用的原因

### OCS 网课助手（5.2.7）

安装成功、`enabled: true`、权限全开，但界面不渲染。Console 报：

```
Uncaught SyntaxError: Failed to execute 'appendChild' on 'Node':
Unexpected identifier '$'
    at Object.send (<anonymous>:24:223)
```

查 OCS 源码确认：`createElement('script')` 0 处、`eval` 0 处、`appendChild` 仅 6 处 —— **这个错误不来自 OCS 自身**。

OCS 声明了十几个 `@grant`（`GM_info` / `GM_xmlhttpRequest` / `unsafeWindow` …），必须经过 Tampermonkey 的 **GM API 桥接层**。桥接层在注入时崩了，脚本第一行读 `GM_info` 就抛异常。

本脚本用 `@grant none`，不经过桥接，所以不受影响。

如果确实需要 OCS，换 **Violentmonkey**（MV2 架构，GM API 由 content script 直接提供，不走 Chromium 的 `userScripts` 桥接）。
