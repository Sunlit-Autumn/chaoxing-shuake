---
name: 脚本不工作 / 播放异常
about: 装了不生效、不播放、不跳节、重复播放、进度不涨
title: '[Bug] '
labels: bug
assignees: ''
---

## 现象

<!-- 一句话描述你看到的：是完全没有反应？还是播放了但不打勾？还是跳错了节？ -->

## 环境

- 浏览器及版本：（例：Edge 137.0.3296.68）
- Tampermonkey 版本：
- 脚本版本（打开脚本首行的 `@version`）：
- 学习通页面地址开头：（`mooc1.chaoxing.com/mycourse/studentstudy` 或 `mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu`）

## 三个必查项

> 这三个是「装了不生效」的绝大多数原因，请逐条确认后再提交。

- [ ] 已在 `edge://extensions` → Tampermonkey → 详细信息里打开 **「允许用户脚本」** 开关
- [ ] 打开开关后 **完全退出浏览器**（任务栏图标消失）再重开
- [ ] 页面打开时，Tampermonkey 图标上显示的数字 ≥ 1

## Console 输出

<!--
F12 → Console → 上方筛选框输入 [cx] → 把输出的内容全部复制过来
如果一条都没有，也请明确写"无输出"
-->

```
粘贴在这里
```

## 调试信息

<!--
F12 → Console → 输入 cxAll() 回车 → 把返回的数组复制过来
这会列出页面上所有 <video>/<audio>，含 duration、readyState、是否在 iframe 里
-->

```
粘贴在这里
```

## 截图

<!-- 直接把图片拖进这个输入框 -->

## 其它补充

<!-- 有什么特殊之处：跨域 iframe、纯文档章节、切换章节时出错、风控验证码等 -->
