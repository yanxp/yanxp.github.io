/**
 * camera.js — 前置摄像头采集 + MediaPipe Hands 手势识别
 *
 * - 通过 getUserMedia 获取前置摄像头画面
 * - 使用 @tensorflow-models/hand-pose-detection (MediaPipe Hands, tfjs runtime)
 *   检测手部 21 个关键点
 * - 基于手指伸展状态做轻量启发式手势分类
 * - 在覆盖 canvas 上绘制骨架与指尖光标
 * - 通过回调将 { gesture, fingertip, raw } 广播给画板模块
 *
 * 导出：window.BindrawCamera = { init, captureFrame, onGesture, setEnabled }
 */
(function () {
    'use strict';

    const videoEl = document.getElementById('camera-video');
    const overlayEl = document.getElementById('camera-overlay');
    const statusEl = document.getElementById('camera-status');
    const emojiEl = document.getElementById('gesture-emoji');
    const nameEl = document.getElementById('gesture-name');
    const overlayCtx = overlayEl.getContext('2d');

    // MediaPipe Hands 骨架连接
    const HAND_CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
        [0, 5], [5, 6], [6, 7], [7, 8],           // index
        [5, 9], [9, 10], [10, 11], [11, 12],      // middle
        [9, 13], [13, 14], [14, 15], [15, 16],    // ring
        [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
        [0, 17]                                    // palm base
    ];

    const GESTURE_META = {
        point:     { emoji: '☝️', name: '指向（作画）' },
        fist:      { emoji: '✊', name: '握拳（抬笔）' },
        palm:      { emoji: '✋', name: '手掌（橡皮擦）' },
        scissors:  { emoji: '✌️', name: '剪刀（撤销）' },
        thumbs_up: { emoji: '👍', name: '点赞（保存）' },
        ok:        { emoji: '👌', name: 'OK（清空）' },
        none:      { emoji: '🖐', name: '等待手势' }
    };

    let detector = null;
    let stream = null;
    let running = false;
    let enabled = true;
    let lastFrame = null; // 最近一帧识别结果
    const listeners = [];

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function updateGestureBadge(gesture) {
        const meta = GESTURE_META[gesture] || GESTURE_META.none;
        if (emojiEl) emojiEl.textContent = meta.emoji;
        if (nameEl) nameEl.textContent = meta.name;
    }

    function dist(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.hypot(dx, dy);
    }

    /**
     * 基于 21 个关键点判断每根手指是否伸展。
     * 约定 [thumb, index, middle, ring, pinky]，1 表示伸展。
     *
     * 对食指/中指/无名指/小指：tip 到对应 MCP 的距离显著大于 PIP 到 MCP 的距离
     * 对拇指：tip 到 CMC 的距离显著大于 IP 到 CMC 的距离
     */
    function fingersUp(kp) {
        const thumbExtended =
            dist(kp[4], kp[1]) > dist(kp[3], kp[1]) * 1.15;
        const indexExtended =
            dist(kp[8], kp[5]) > dist(kp[6], kp[5]) * 1.6;
        const middleExtended =
            dist(kp[12], kp[9]) > dist(kp[10], kp[9]) * 1.6;
        const ringExtended =
            dist(kp[16], kp[13]) > dist(kp[14], kp[13]) * 1.6;
        const pinkyExtended =
            dist(kp[20], kp[17]) > dist(kp[18], kp[17]) * 1.6;
        return [
            thumbExtended ? 1 : 0,
            indexExtended ? 1 : 0,
            middleExtended ? 1 : 0,
            ringExtended ? 1 : 0,
            pinkyExtended ? 1 : 0
        ];
    }

    /**
     * 将 fingersUp 结果与几个额外几何特征组合，分类为命名手势。
     */
    function classifyGesture(kp) {
        const [t, i, m, r, p] = fingersUp(kp);

        // 用掌心大小作参考尺度
        const handSize = dist(kp[0], kp[9]) || 1;

        // OK 手势：拇指尖与食指尖相近，且中/无名/小指伸展
        const thumbIndexTipDist = dist(kp[4], kp[8]);
        if (thumbIndexTipDist < handSize * 0.45 && m && r && p) {
            return 'ok';
        }

        const key = [t, i, m, r, p].join('');
        switch (key) {
            case '00000': return 'fist';
            case '11111': return 'palm';
            case '01111': return 'palm';      // 拇指内扣的张开掌
            case '01000': return 'point';
            case '11000': return 'point';     // 容忍拇指偏差
            case '01100': return 'scissors';
            case '11100': return 'scissors';
            case '10000': return 'thumbs_up';
            default:
                // 兜底：只要食指伸展且中/无名/小指大部分收起，就算指向
                if (i && !m && !r && !p) return 'point';
                return 'none';
        }
    }

    function drawSkeleton(hand) {
        const kp = hand.keypoints;
        overlayCtx.save();

        // 连线
        overlayCtx.lineWidth = Math.max(2, overlayEl.width / 320);
        overlayCtx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
        overlayCtx.beginPath();
        HAND_CONNECTIONS.forEach(([a, b]) => {
            overlayCtx.moveTo(kp[a].x, kp[a].y);
            overlayCtx.lineTo(kp[b].x, kp[b].y);
        });
        overlayCtx.stroke();

        // 关键点
        const r = Math.max(3, overlayEl.width / 240);
        overlayCtx.fillStyle = 'rgba(37, 99, 235, 0.95)';
        kp.forEach((pt) => {
            overlayCtx.beginPath();
            overlayCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
            overlayCtx.fill();
        });

        // 食指指尖特别强调
        overlayCtx.fillStyle = '#f97316';
        overlayCtx.beginPath();
        overlayCtx.arc(kp[8].x, kp[8].y, r * 1.8, 0, Math.PI * 2);
        overlayCtx.fill();

        overlayCtx.restore();
    }

    function renderGestureLabel(hand, gesture) {
        const meta = GESTURE_META[gesture] || GESTURE_META.none;
        const kp = hand.keypoints;

        // 取手腕附近做标签位置
        const x = Math.min(overlayEl.width - 180, Math.max(10, kp[0].x - 60));
        const y = Math.max(36, kp[0].y + 24);

        // 由于 video + overlay 通过 CSS scaleX(-1) 镜像显示，
        // 此处把文字局部翻回去保持可读。
        overlayCtx.save();
        overlayCtx.translate(x + 180, y - 24);
        overlayCtx.scale(-1, 1);

        const label = `${meta.emoji}  ${meta.name}`;
        overlayCtx.font = `600 ${Math.max(14, overlayEl.width / 38)}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
        const w = overlayCtx.measureText(label).width + 20;
        const h = Math.max(30, overlayEl.width / 22);

        overlayCtx.fillStyle = 'rgba(17, 24, 39, 0.78)';
        overlayCtx.fillRect(0, 0, w, h);

        overlayCtx.fillStyle = '#ffffff';
        overlayCtx.textBaseline = 'middle';
        overlayCtx.fillText(label, 10, h / 2);
        overlayCtx.restore();
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

    function notifyListeners(payload) {
        listeners.forEach((fn) => {
            try { fn(payload); } catch (err) { console.error(err); }
        });
    }

    async function detectLoop() {
        if (!detector || !running) return;
        try {
            if (videoEl.readyState >= 2) {
                const hands = await detector.estimateHands(videoEl, { flipHorizontal: false });
                syncOverlaySize();
                overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);

                if (hands && hands.length > 0) {
                    const hand = hands[0];
                    const gesture = classifyGesture(hand.keypoints);
                    lastFrame = { gesture, hand };
                    drawSkeleton(hand);
                    renderGestureLabel(hand, gesture);
                    updateGestureBadge(gesture);

                    // 将指尖归一化到 [0, 1]，同时水平翻转以匹配镜像显示
                    const tip = hand.keypoints[8];
                    const nx = 1 - tip.x / overlayEl.width; // 镜像
                    const ny = tip.y / overlayEl.height;
                    notifyListeners({
                        gesture,
                        fingertip: { nx, ny, x: tip.x, y: tip.y },
                        raw: hand
                    });
                } else {
                    lastFrame = null;
                    updateGestureBadge('none');
                    notifyListeners({ gesture: 'none', fingertip: null, raw: null });
                }
            }
        } catch (err) {
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
                video: {
                    facingMode: 'user',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
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
            console.warn('[bindraw] video.play() rejected', err);
        }
        syncOverlaySize();

        setStatus('加载手势识别模型…');
        try {
            if (!window.handPoseDetection) {
                throw new Error('handPoseDetection 未加载');
            }
            detector = await window.handPoseDetection.createDetector(
                window.handPoseDetection.SupportedModels.MediaPipeHands,
                { runtime: 'tfjs', modelType: 'full', maxHands: 1 }
            );
        } catch (err) {
            console.error('[bindraw] hand model load failed', err);
            setStatus('手势模型加载失败（画板仍可用）');
            return;
        }

        setStatus('识别中');
        running = true;
        detectLoop();
    }

    /**
     * 截取当前视频帧（已把镜像翻回），返回离屏 canvas。
     */
    function captureFrame() {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(videoEl, 0, 0, w, h);
        ctx.restore();
        return { canvas: off, width: w, height: h };
    }

    function onGesture(fn) {
        if (typeof fn === 'function') listeners.push(fn);
    }

    function setEnabled(flag) {
        enabled = !!flag;
        if (!enabled) {
            overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
            updateGestureBadge('none');
            // 通知一次 none 让画板复位
            notifyListeners({ gesture: 'none', fingertip: null, raw: null, disabled: true });
        }
    }

    function isEnabled() {
        return enabled;
    }

    window.BindrawCamera = {
        init: initCamera,
        captureFrame,
        onGesture,
        setEnabled,
        isEnabled
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCamera);
    } else {
        initCamera();
    }
})();
