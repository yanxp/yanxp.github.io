/**
 * camera.js — 前置摄像头采集与实时物体识别
 *
 * - 通过 getUserMedia 获取前置摄像头视频流
 * - 加载 coco-ssd 模型并对视频帧做实时检测
 * - 在覆盖 canvas 上绘制检测框与标签
 * - 暴露 window.BindrawCamera.captureFrame() 供画板模块调用
 */
(function () {
    'use strict';

    const videoEl = document.getElementById('camera-video');
    const overlayEl = document.getElementById('camera-overlay');
    const statusEl = document.getElementById('camera-status');
    const overlayCtx = overlayEl.getContext('2d');

    const COLORS = [
        '#ef4444', '#f97316', '#eab308', '#22c55e',
        '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'
    ];

    let model = null;
    let stream = null;
    let detectionRunning = false;
    let lastPredictions = [];

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function colorForLabel(label) {
        let hash = 0;
        for (let i = 0; i < label.length; i += 1) {
            hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
        }
        return COLORS[hash % COLORS.length];
    }

    function syncOverlaySize() {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;
        if (
            overlayEl.width !== videoEl.videoWidth ||
            overlayEl.height !== videoEl.videoHeight
        ) {
            overlayEl.width = videoEl.videoWidth;
            overlayEl.height = videoEl.videoHeight;
        }
    }

    function drawPredictions(predictions) {
        syncOverlaySize();
        overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);

        predictions.forEach((p) => {
            const [x, y, w, h] = p.bbox;
            const color = colorForLabel(p.class);
            const label = `${p.class} ${(p.score * 100).toFixed(0)}%`;

            overlayCtx.lineWidth = Math.max(2, overlayEl.width / 400);
            overlayCtx.strokeStyle = color;
            overlayCtx.strokeRect(x, y, w, h);

            // 因为外层做了 scaleX(-1) 镜像，这里文字也会被镜像；
            // 用本地变换把文字翻回正常朝向。
            overlayCtx.save();
            overlayCtx.translate(x + w, y);
            overlayCtx.scale(-1, 1);

            const fontSize = Math.max(14, overlayEl.width / 50);
            overlayCtx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
            const textWidth = overlayCtx.measureText(label).width;
            const pad = 6;
            const boxHeight = fontSize + pad * 2;

            overlayCtx.fillStyle = color;
            overlayCtx.fillRect(0, -boxHeight, textWidth + pad * 2, boxHeight);

            overlayCtx.fillStyle = '#ffffff';
            overlayCtx.textBaseline = 'middle';
            overlayCtx.fillText(label, pad, -boxHeight / 2);
            overlayCtx.restore();
        });
    }

    async function detectLoop() {
        if (!model || !detectionRunning) return;
        try {
            if (videoEl.readyState >= 2) {
                const preds = await model.detect(videoEl);
                lastPredictions = preds;
                drawPredictions(preds);
            }
        } catch (err) {
            // 单帧失败不应该中断循环
            console.warn('[bindraw] detect error', err);
        }
        requestAnimationFrame(detectLoop);
    }

    async function initCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus('当前浏览器不支持摄像头 API');
            return;
        }

        setStatus('请求摄像头权限…');
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
        } catch (err) {
            console.error('[bindraw] getUserMedia failed', err);
            let message = '无法访问摄像头';
            if (err && err.name === 'NotAllowedError') {
                message = '摄像头权限被拒绝，请在浏览器设置中允许后刷新页面';
            } else if (err && err.name === 'NotFoundError') {
                message = '未检测到可用摄像头';
            } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
                message = '请在 HTTPS 或 localhost 下访问以启用摄像头';
            }
            setStatus(message);
            return;
        }

        videoEl.srcObject = stream;
        await new Promise((resolve) => {
            if (videoEl.readyState >= 1) return resolve();
            videoEl.addEventListener('loadedmetadata', resolve, { once: true });
        });
        try {
            await videoEl.play();
        } catch (err) {
            // autoplay 被浏览器策略阻止时仍继续
            console.warn('[bindraw] video.play() rejected', err);
        }
        syncOverlaySize();

        setStatus('加载识别模型…');
        try {
            // cocoSsd 由 CDN 暴露为全局变量
            model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        } catch (err) {
            console.error('[bindraw] coco-ssd load failed', err);
            setStatus('识别模型加载失败（可继续使用画板）');
            return;
        }

        setStatus('识别中');
        detectionRunning = true;
        detectLoop();
    }

    /**
     * 截取当前视频帧，返回 { canvas, width, height } 供画板使用。
     * 已经把前置摄像头的镜像翻回（与用户在屏幕上看到的方向一致）。
     */
    function captureFrame() {
        if (!videoEl.videoWidth || !videoEl.videoHeight) {
            return null;
        }
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        // 把前置摄像头画面水平翻转以匹配屏幕显示方向
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.restore();
        return { canvas: off, width: w, height: h };
    }

    function getLastPredictions() {
        return lastPredictions.slice();
    }

    window.BindrawCamera = {
        init: initCamera,
        captureFrame,
        getLastPredictions
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCamera);
    } else {
        initCamera();
    }
})();
