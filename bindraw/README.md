# Bindraw — 前置摄像头手势识别画图

Bindraw 是 [yanxp.github.io](https://yanxp.github.io) 下的一个独立子项目：
**打开前置摄像头，用手势在浏览器里画画**。指尖即画笔，不用鼠标。

核心思路：用 TensorFlow.js 的 `@tensorflow-models/hand-pose-detection`
（基于 MediaPipe Hands）实时检测手部 21 个关键点，然后用一组轻量的
手指伸展启发式规则将当前姿势分类为「指向 / 握拳 / 手掌 / 剪刀 / 点赞 / OK」等
手势，再由手势驱动画板做下笔、抬笔、擦除、撤销、保存、清空等动作。

## 手势控制

| 手势 | 动作 |
| --- | --- |
| ☝️ 食指指向 | 下笔 — 跟随食指指尖连续作画 |
| ✊ 握拳 | 抬笔（只显示光标，不画） |
| ✋ 张开手掌 | 橡皮擦（以指尖为中心擦除） |
| ✌️ 剪刀手 | 撤销（保持 ~0.5s 触发，带冷却防抖） |
| 👍 点赞 | 保存当前画板为 PNG |
| 👌 OK | 清空画布（带确认） |

> 摄像头画面做了水平镜像以贴近用户直觉；识别时使用原始坐标系，
> 随后把指尖位置从视频坐标映射到画板坐标（包含水平翻转与 EMA 平滑），
> 让手势轨迹与屏幕上看到的一致且不抖。

## 功能

- **前置摄像头手势识别**：MediaPipe Hands（tfjs runtime），在覆盖层 canvas 上
  绘制骨架与指尖高亮；左上徽章实时显示当前手势名。
- **手势驱动画板**：下笔 / 抬笔 / 擦除 / 撤销 / 保存 / 清空，持续类手势带有
  保持帧数阈值 + 冷却时间，避免误触发。
- **手动工具栏**（鼠标 / 触屏兼容，可与手势并用）：
  - 画笔 / 橡皮擦、颜色、粗细滑块
  - 撤销 / 重做（`Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`）
  - 清空、摄像头截图导入背景、导出 PNG
- **手势控制开关**：工具栏上的复选框随时关闭手势控制，回退到纯手动画板。
- **响应式布局**：桌面端左右分栏，移动端上下堆叠；支持跟随系统的深色模式。

## 使用方法

### 方式一：本地启动（推荐）

```bash
cd bindraw
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/
```

> 直接 `file://` 打开 `index.html` 部分浏览器会拒绝访问摄像头；请使用
> 本地 HTTP 服务或 HTTPS 环境。

### 方式二：GitHub Pages

仓库开启 GitHub Pages 后直接访问：

```
https://yanxp.github.io/bindraw/
```

GitHub Pages 默认提供 HTTPS，摄像头 API 可正常使用。

## 技术栈

- 原生 HTML / CSS / JavaScript（无前端框架）
- [TensorFlow.js](https://www.tensorflow.org/js)
- [@tensorflow-models/hand-pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)
  （MediaPipe Hands，`runtime: 'tfjs'`）
- HTML5 Canvas 2D API

## 目录结构

```
bindraw/
├── index.html        # 页面入口（布局、工具栏、CDN、脚本引入、手势图例）
├── css/
│   └── style.css     # 响应式样式 + 手势徽章 + 指尖光标 + 深色模式
├── js/
│   ├── camera.js     # 摄像头采集 + MediaPipe Hands + 手势分类 + 事件广播
│   └── bindraw.js    # 画板逻辑 + 订阅手势事件并驱动画笔
└── README.md
```

## 实现要点

### 手势分类（camera.js）

1. 对每根手指做「伸展/收起」二分类：
   - 食指 / 中指 / 无名指 / 小指：`dist(tip, mcp) > dist(pip, mcp) * 1.6`
     伸展时指尖远离掌骨关节；收起时指尖弯回接近或越过 MCP。
   - 拇指：`dist(tip, cmc) > dist(ip, cmc) * 1.15`，用更小的阈值。
2. 将 `[t, i, m, r, p]` 五元组映射为命名手势（`fist`/`palm`/`point`/
   `scissors`/`thumbs_up`）。
3. **OK 手势**：拇指尖与食指尖距离 < 0.45 × 掌心参考尺度，且中/无名/小指
   伸展，即判为 `ok`，优先于五元组。

### 指尖到画板的坐标映射（bindraw.js）

1. camera.js 输出的 `fingertip.nx` 已做水平镜像（`1 - x/W`）以匹配镜像显示。
2. 在画板侧用指数移动平均（α = 0.45）平滑 `nx, ny`，兼顾跟手与稳定。
3. 根据当前手势分三类行为：
   - `point`：`gesturePenDown()` → `gesturePenMove()`，连续 `lineTo` 绘制；
     一次「下笔 → 抬笔」结束时才 `saveHistory()`。
   - `palm`：圆盘擦除（`globalCompositeOperation = 'destination-out'`）。
   - 其他：抬笔。仅对 `scissors / thumbs_up / ok` 做「保持 N 帧 + 冷却」的
     单次触发判定，触发撤销 / 保存 / 清空。

### 防抖与冷却

- `TRIGGER_HOLD_FRAMES = 15`（~ 0.5s @ 30fps）：手势必须保持这么多帧才触发一次。
- `TRIGGER_COOLDOWN_MS = 1200`：单次触发后的最短冷却时间。
- 画笔类手势（`point` / `palm`）不走触发通道，逐帧生效。

## 注意事项

- **HTTPS / localhost**：浏览器仅在安全上下文下允许访问摄像头。
- **模型加载**：首屏会下载数 MB 的模型（约 2–5 秒），期间状态栏会显示
  「加载手势识别模型…」。
- **隐私**：视频帧与识别全部在浏览器本地完成，不会上传到任何服务器。
- **识别鲁棒性**：启发式手势分类对单手竖直面向摄像头时最稳。
  侧向、遮挡或快速移动时可能出现短暂误判，实际使用中可保持手势 0.5s 以上再做动作。
