# Bindraw — 前置摄像头手势识别画图

Bindraw 是 [yanxp.github.io](https://yanxp.github.io) 下的一个独立子项目：
**打开前置摄像头，直接在屏幕上用手势画画**。指尖即画笔，不用鼠标。

核心思路：用 TensorFlow.js 的 `@tensorflow-models/hand-pose-detection`
（基于 MediaPipe Hands）实时检测手部 21 个关键点，用一组轻量的手指
伸展启发式规则把当前姿势分类为「指向 / 握拳 / 手掌 / 剪刀 / 点赞 / OK」，
再由手势驱动一层**叠在摄像头画面之上的透明画布**做下笔、抬笔、擦除、
撤销、保存、清空等动作。

## 界面

- **全屏摄像头**：视频流铺满整个工作区，水平镜像后更贴近直觉。
- **透明画布叠层**：画布直接覆盖在摄像头画面之上，画的线条就像直接画在
  你当前看到的镜头画面上一样。
- **顶部工具栏**：画笔 / 橡皮擦、颜色、粗细、撤销 / 重做、清空、保存，
  以及三个可选开关：手势控制、显示摄像头、显示骨架。
- **左上手势徽章 + 左下状态栏**：实时显示当前手势与识别状态。
- **右上手势图例**：可折叠，避免遮挡画面。
- **加载遮罩 + 就绪横幅**：首屏加载模型时显示带进度说明的遮罩，模型
  就绪后中央弹出「✅ 准备就绪，竖起食指即可开始作画」的横幅（自动淡出）。

## 手势控制

| 手势 | 动作 |
| --- | --- |
| ☝️ 食指指向 | 下笔 — 跟随食指指尖连续作画 |
| ✊ 握拳 | 抬笔（只显示光标，不画） |
| ✋ 张开手掌 | 橡皮擦（以指尖为中心擦除） |
| ✌️ 剪刀手 | 撤销（保持 ~0.5s 触发，带冷却防抖） |
| 👍 点赞 | 保存当前画板为 PNG |
| 👌 OK | 清空画布（带确认） |

> 摄像头画面做了水平镜像以贴近用户直觉；识别坐标随后做水平翻转 +
> 指数移动平均（α = 0.45）再映射到画布，让指尖轨迹跟手且不抖。
> 手消失时 EMA 状态会重置，重新出现时不会在旧位置留下拖尾。

## 模型加载性能

- 首屏会下载 **2–5 MB** 的 MediaPipe Hands 模型，一般 **2–10 秒**完成
  （视网络而定），第二次访问由浏览器缓存直接命中。
- 加载时中央有遮罩显示当前阶段：请求摄像头权限 → 下载模型 → 识别中。
- 模型就绪后：
  - 中央弹出绿色「✅ 准备就绪」横幅（2.8 秒后自动消失）。
  - 页面标题切换为 `✅ 就绪 — …`。
  - 左下状态栏显示「✅ 就绪 · 请把手伸到摄像头前」。
- 优先尝试 `mediapipe` runtime（加载快、鲁棒性好），失败则回退 `tfjs`
  lite / full。

## 功能

- **前置摄像头手势识别**：MediaPipe Hands（首选 `mediapipe` runtime，
  失败回退 `tfjs`）在覆盖层 canvas 上绘制骨架与指尖高亮，徽章实时显示
  当前手势名。
- **手势驱动画板**：下笔 / 抬笔 / 擦除 / 撤销 / 保存 / 清空，持续类手势
  带有保持帧数阈值 + 冷却时间，避免误触发。
- **手动工具栏**（鼠标 / 触屏兼容，可与手势并用）：
  - 画笔 / 橡皮擦、颜色、粗细滑块
  - 撤销 / 重做（`Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`）
  - 清空、导出 PNG（`Ctrl/Cmd+S`）
- **开关**：手势控制、显示摄像头、显示骨架。
- **响应式布局**：全屏自适应；跟随系统的深色模式。

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
- [TensorFlow.js](https://www.tensorflow.org/js) core / converter / webgl backend
- [@mediapipe/hands](https://www.npmjs.com/package/@mediapipe/hands)（mediapipe runtime 依赖）
- [@tensorflow-models/hand-pose-detection](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection)
- HTML5 Canvas 2D API

## 目录结构

```
bindraw/
├── index.html        # 页面入口（布局、工具栏、加载遮罩、就绪横幅、CDN 与脚本引入）
├── css/
│   └── style.css     # 全屏摄像头 + 透明画布叠层样式、加载遮罩、深色模式
├── js/
│   ├── camera.js     # 摄像头采集 + 手势识别 + 骨架绘制 + 状态/就绪通知
│   └── bindraw.js    # 画板逻辑 + 订阅手势事件驱动画笔
└── README.md
```

## 实现要点

### 手势分类（camera.js）

1. 对每根手指做「伸展/收起」二分类：
   - 食指 / 中指 / 无名指 / 小指：`dist(tip, mcp) > dist(pip, mcp) * 1.35`
     （阈值从 1.6 降至 1.35，放宽自然姿态）。
   - 拇指：`dist(tip, mcp) > dist(ip, mcp) * 1.05`。
2. 将 `[t, i, m, r, p]` 五元组映射为命名手势（`fist` / `palm` /
   `point` / `scissors` / `thumbs_up`），并带有若干兜底规则。
3. **OK 手势**：拇指尖与食指尖距离 < 0.45 × 掌心参考尺度，且中/无名/
   小指至少有两根伸展，优先于五元组。
4. 每 30 帧打印一次 `[t,i,m,r,p]` 与当前手势到 console，方便调试。

### 指尖到画布的坐标映射（bindraw.js）

1. camera.js 输出的 `fingertip.nx` 已做水平镜像（`1 - x/W`）匹配镜像显示。
2. 在画板侧用指数移动平均（α = 0.45）平滑 `nx, ny`。**手消失时重置 EMA
   状态**，重新出现时不会从旧位置拖线。
3. 根据当前手势分三类行为：
   - `point`：`gesturePenDown()` → `gesturePenMove()`；一次下笔/抬笔结束
     才 `saveHistory()`。
   - `palm`：圆盘擦除（`globalCompositeOperation = 'destination-out'`），
     **擦除半径按 DPR 缩放**以在 Retina 屏视觉大小一致；退出 `palm` 时
     `saveHistory()` 以便撤销。
   - 其他：抬笔。仅对 `scissors / thumbs_up / ok` 做「保持 N 帧 + 冷却」
     的单次触发判定。

### 防抖与冷却

- `TRIGGER_HOLD_FRAMES = 15`（~ 0.5s @ 30fps）：手势必须保持这么多帧才触发一次。
- `TRIGGER_COOLDOWN_MS = 1200`：单次触发后的最短冷却；冷却期内 `heldFrames`
  会被钳制在 `TRIGGER_HOLD_FRAMES - 1`，确保后续再次跨过阈值能稳定触发。
- 画笔类手势（`point` / `palm`）不走触发通道，逐帧生效。

## 注意事项

- **HTTPS / localhost**：浏览器仅在安全上下文下允许访问摄像头。
- **模型加载**：首屏会下载数 MB 的模型（约 2–10 秒）；就绪后会弹出显眼的
  「✅ 准备就绪」横幅。
- **隐私**：视频帧与识别全部在浏览器本地完成，不会上传到任何服务器。
- **识别鲁棒性**：启发式手势分类对单手竖直面向摄像头时最稳；侧向、遮挡
  或快速移动时可能出现短暂误判，保持手势 0.5s 以上能显著提高稳定性。
- **诊断**：若识别不稳，可打开开发者工具查看 `[bindraw] fingers = ... gesture = ...`
  日志，确认当前手指状态是否被正确分类。
