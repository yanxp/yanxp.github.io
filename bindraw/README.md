# Bindraw — 前置摄像头识别 + 手动画板

Bindraw 是 [yanxp.github.io](https://yanxp.github.io) 下的一个独立子项目，演示在浏览器中基于 TensorFlow.js 的前置摄像头实时物体识别，以及一个可自由创作的 HTML5 Canvas 画板，并支持把摄像头画面一键截图到画板继续编辑。

## 功能

- **前置摄像头识别**：通过 `getUserMedia` 获取前置摄像头画面，加载 `@tensorflow-models/coco-ssd` 进行实时物体检测，并在覆盖层 canvas 上绘制检测框与中文/英文标签。
- **画板工具**：
  - 自由画笔（平滑折线）
  - 橡皮擦（基于 `globalCompositeOperation = 'destination-out'`）
  - 颜色选择（`<input type="color">`）
  - 粗细调节（`<input type="range">`）
  - 撤销 / 重做（基于每笔快照，支持 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`）
  - 清空画布（带确认）
  - **截图到画板**：把摄像头当前帧作为画板背景
  - **保存图片**：导出 PNG 下载
- **响应式布局**：桌面端左右分栏，移动端上下堆叠；支持深色模式（跟随系统）。
- **触控支持**：移动端手指绘制可用。

## 使用方法

### 方式一：本地打开

```bash
# 克隆仓库后
cd bindraw
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/
```

> 直接 `file://` 双击打开 `index.html` 时，部分浏览器会拒绝访问摄像头；建议通过本地 HTTP 服务或 HTTPS 打开。

### 方式二：GitHub Pages

仓库开启 GitHub Pages 后，访问：

```
https://yanxp.github.io/bindraw/
```

GitHub Pages 默认提供 HTTPS，摄像头 API 可正常使用。

## 技术栈

- 原生 HTML / CSS / JavaScript（无前端框架）
- [TensorFlow.js](https://www.tensorflow.org/js) + [@tensorflow-models/coco-ssd](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)（CDN 引入）
- HTML5 Canvas 2D API

## 目录结构

```
bindraw/
├── index.html        # 页面入口（布局、工具栏、CDN、脚本引入）
├── css/
│   └── style.css     # 响应式样式 + 深色模式
├── js/
│   ├── camera.js     # 摄像头采集 + coco-ssd 识别 + captureFrame()
│   └── bindraw.js    # 画板所有交互逻辑
└── README.md
```

## 注意事项

- **HTTPS / localhost**：浏览器仅在安全上下文下允许访问摄像头。
- **首次加载**：模型约数 MB，首屏识别会有几秒延迟，属于正常现象。
- **隐私**：所有视频帧与识别仅在浏览器本地完成，不会上传服务器。
