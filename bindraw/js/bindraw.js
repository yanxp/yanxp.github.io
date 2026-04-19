/**
 * bindraw.js — 画板 + 手势驱动逻辑
 *
 * 画布直接覆盖在摄像头画面上（透明背景），指到哪里画到哪里。
 *
 * - 鼠标 / 触屏：画笔、橡皮擦、颜色、粗细、撤销、重做、清空、保存 PNG
 * - 手势驱动（订阅 window.BindrawCamera 的手势事件）：
 *     ☝️ point     → 下笔，以指尖位置连续作画
 *     ✊ fist      → 抬笔（仅显示光标）
 *     ✋ palm      → 橡皮擦
 *     ✌️ scissors → 撤销（保持手势 ~0.5s 触发，防抖）
 *     👍 thumbs_up → 保存 PNG（保持手势触发）
 *     👌 ok        → 清空画布（保持手势触发）
 */
(function () {
    'use strict';

    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('draw-status');
    const cursorEl = document.getElementById('cursor-indicator');

    const btnPen = document.getElementById('tool-pen');
    const btnEraser = document.getElementById('tool-eraser');
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    const btnClear = document.getElementById('btn-clear');
    const btnSave = document.getElementById('btn-save');
    const colorInput = document.getElementById('color-picker');
    const sizeSlider = document.getElementById('size-slider');
    const sizeValue = document.getElementById('size-value');
    const gestureToggle = document.getElementById('gesture-toggle');
    const cameraToggle = document.getElementById('camera-toggle');
    const skeletonToggle = document.getElementById('skeleton-toggle');
    const legendToggle = document.getElementById('legend-toggle');
    const legendBody = document.getElementById('legend-body');

    const MAX_HISTORY = 40;
    // 持续触发类手势（scissors/thumbs_up/ok）的保持帧阈值
    const TRIGGER_HOLD_FRAMES = 24;   // ~0.8s @ 30fps，避开画画时手抖
    const TRIGGER_COOLDOWN_MS = 1200;
    // 画画粘滞：进入 point 画画后，需要连续 N 帧非 point 才真正抬笔
    const DRAW_STICKY_FRAMES = 5;

    const state = {
        tool: 'pen',
        color: colorInput.value,
        size: parseInt(sizeSlider.value, 10),
        drawing: false,
        lastX: 0,
        lastY: 0,
        history: [],
        redoStack: [],
        gestureDrawing: false,
        gestureErasing: false,
        smoothX: null,
        smoothY: null,
        activeGesture: 'none',
        heldGesture: null,
        heldFrames: 0,
        lastTriggerAt: 0,
        // 画画粘滞计数：进入 point 画画后，累计的连续非 point 帧数
        nonPointFrames: 0,
        // 最近一次真正有效的指尖归一化坐标（粘滞期间继续用它推进）
        lastNormX: null,
        lastNormY: null
    };

    // ---------- Canvas 尺寸与历史 ----------

    function resizeCanvas(preserve) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const newW = Math.max(1, Math.floor(rect.width * dpr));
        const newH = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width === newW && canvas.height === newH) return;

        let snapshot = null;
        if (preserve && canvas.width > 0 && canvas.height > 0) {
            snapshot = document.createElement('canvas');
            snapshot.width = canvas.width;
            snapshot.height = canvas.height;
            snapshot.getContext('2d').drawImage(canvas, 0, 0);
        }

        canvas.width = newW;
        canvas.height = newH;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // 画布透明，不填充背景色（让摄像头画面透出来）
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (snapshot) {
            ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, canvas.width, canvas.height);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    function saveHistory() {
        try {
            state.history.push(canvas.toDataURL('image/png'));
            if (state.history.length > MAX_HISTORY) state.history.shift();
            state.redoStack = [];
        } catch (err) {
            console.warn('[bindraw] saveHistory failed', err);
        }
    }

    function restoreFromDataURL(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                ctx.restore();
                resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
        });
    }

    async function undo() {
        if (state.history.length <= 1) {
            setStatus('没有可撤销的操作');
            return;
        }
        const current = state.history.pop();
        state.redoStack.push(current);
        await restoreFromDataURL(state.history[state.history.length - 1]);
        setStatus('已撤销');
    }

    async function redo() {
        if (state.redoStack.length === 0) {
            setStatus('没有可重做的操作');
            return;
        }
        const url = state.redoStack.pop();
        state.history.push(url);
        await restoreFromDataURL(url);
        setStatus('已重做');
    }

    function clearCanvas() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        saveHistory();
        setStatus('画布已清空');
    }

    // ---------- 工具状态 ----------

    function setTool(tool) {
        state.tool = tool;
        btnPen.classList.toggle('active', tool === 'pen');
        btnEraser.classList.toggle('active', tool === 'eraser');
        btnPen.setAttribute('aria-pressed', String(tool === 'pen'));
        btnEraser.setAttribute('aria-pressed', String(tool === 'eraser'));
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function applyStrokeStyle(toolOverride) {
        const dpr = window.devicePixelRatio || 1;
        const t = toolOverride || state.tool;
        ctx.lineWidth = state.size * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (t === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = state.color;
        }
    }

    // ---------- 鼠标 / 触屏 ----------

    function pointerPos(evt) {
        const rect = canvas.getBoundingClientRect();
        const clientX = evt.clientX ?? (evt.touches && evt.touches[0] && evt.touches[0].clientX);
        const clientY = evt.clientY ?? (evt.touches && evt.touches[0] && evt.touches[0].clientY);
        const x = ((clientX - rect.left) / rect.width) * canvas.width;
        const y = ((clientY - rect.top) / rect.height) * canvas.height;
        return { x, y };
    }

    function beginStroke(evt) {
        evt.preventDefault();
        state.drawing = true;
        const { x, y } = pointerPos(evt);
        state.lastX = x;
        state.lastY = y;
        applyStrokeStyle();
        ctx.beginPath();
        ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = state.tool === 'eraser' ? 'rgba(0,0,0,1)' : state.color;
        ctx.fill();
    }

    function moveStroke(evt) {
        if (!state.drawing) return;
        evt.preventDefault();
        const { x, y } = pointerPos(evt);
        ctx.beginPath();
        ctx.moveTo(state.lastX, state.lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        state.lastX = x;
        state.lastY = y;
    }

    function endStroke(evt) {
        if (!state.drawing) return;
        if (evt) evt.preventDefault();
        state.drawing = false;
        ctx.globalCompositeOperation = 'source-over';
        saveHistory();
    }

    // ---------- 其它操作 ----------

    function savePng() {
        canvas.toBlob((blob) => {
            if (!blob) { setStatus('保存失败'); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            a.href = url;
            a.download = `bindraw-${ts}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            setStatus('已下载 PNG');
        }, 'image/png');
    }

    // ---------- 手势驱动绘制 ----------

    function updateCursor(normX, normY, visible, color) {
        if (!cursorEl) return;
        if (!visible) {
            cursorEl.style.opacity = '0';
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const hostRect = cursorEl.parentElement.getBoundingClientRect();
        const x = (rect.left - hostRect.left) + normX * rect.width;
        const y = (rect.top - hostRect.top) + normY * rect.height;
        cursorEl.style.left = `${x}px`;
        cursorEl.style.top = `${y}px`;
        cursorEl.style.opacity = '1';
        cursorEl.style.borderColor = color || state.color;
    }

    function smoothPos(nx, ny) {
        if (state.smoothX === null) {
            state.smoothX = nx;
            state.smoothY = ny;
        } else {
            const alpha = 0.45;
            state.smoothX = state.smoothX * (1 - alpha) + nx * alpha;
            state.smoothY = state.smoothY * (1 - alpha) + ny * alpha;
        }
        return { nx: state.smoothX, ny: state.smoothY };
    }

    function resetSmooth() {
        state.smoothX = null;
        state.smoothY = null;
    }

    function canvasCoordFromNorm(nx, ny) {
        return { x: nx * canvas.width, y: ny * canvas.height };
    }

    function handleGestureTriggers(gesture) {
        const now = performance.now();
        if (gesture === state.heldGesture) {
            state.heldFrames += 1;
        } else {
            state.heldGesture = gesture;
            state.heldFrames = 1;
        }

        const cooldownOk = now - state.lastTriggerAt > TRIGGER_COOLDOWN_MS;
        if (!cooldownOk) {
            if (state.heldFrames >= TRIGGER_HOLD_FRAMES) {
                state.heldFrames = TRIGGER_HOLD_FRAMES - 1;
            }
            return false;
        }

        if (state.heldFrames >= TRIGGER_HOLD_FRAMES) {
            if (gesture === 'scissors') {
                state.lastTriggerAt = now;
                undo();
                return true;
            }
            if (gesture === 'thumbs_up') {
                state.lastTriggerAt = now;
                savePng();
                return true;
            }
            if (gesture === 'ok') {
                state.lastTriggerAt = now;
                if (confirm('OK 手势：确定要清空画布吗？')) clearCanvas();
                return true;
            }
        }
        return false;
    }

    function gesturePenDown(nx, ny) {
        const { x, y } = canvasCoordFromNorm(nx, ny);
        state.lastX = x;
        state.lastY = y;
        state.gestureDrawing = true;
        applyStrokeStyle('pen');
        ctx.beginPath();
        ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = state.color;
        ctx.fill();
    }

    function gesturePenMove(nx, ny) {
        const { x, y } = canvasCoordFromNorm(nx, ny);
        applyStrokeStyle('pen');
        ctx.beginPath();
        ctx.moveTo(state.lastX, state.lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        state.lastX = x;
        state.lastY = y;
    }

    function gestureErase(nx, ny) {
        const { x, y } = canvasCoordFromNorm(nx, ny);
        const dpr = window.devicePixelRatio || 1;
        applyStrokeStyle('eraser');
        // 橡皮擦半径按 CSS 像素定义，乘 DPR 以保持视觉大小一致
        const r = Math.max(12, state.size * 2.5) * dpr;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    function gesturePenUp() {
        if (state.gestureDrawing) {
            state.gestureDrawing = false;
            saveHistory();
        }
    }

    function gestureEraseStop() {
        if (state.gestureErasing) {
            state.gestureErasing = false;
            saveHistory();
        }
    }

    function onGestureFrame(payload) {
        if (!gestureToggle.checked) return;
        const { gesture, fingertip, disabled } = payload;

        if (disabled || !fingertip) {
            gesturePenUp();
            gestureEraseStop();
            state.activeGesture = 'none';
            state.heldGesture = null;
            state.heldFrames = 0;
            state.nonPointFrames = 0;
            resetSmooth();
            updateCursor(0, 0, false);
            return;
        }

        const { nx, ny } = smoothPos(fingertip.nx, fingertip.ny);
        state.lastNormX = nx;
        state.lastNormY = ny;

        // 画画时的粘滞判定：如果正在 point 画画，且当前帧是非 point / none，
        // 则在 DRAW_STICKY_FRAMES 帧内依然按 point 处理，避免短暂误判断线。
        let effectiveGesture = gesture;
        if (state.gestureDrawing && gesture !== 'point') {
            state.nonPointFrames += 1;
            if (state.nonPointFrames <= DRAW_STICKY_FRAMES && gesture !== 'palm') {
                effectiveGesture = 'point';
            }
        } else if (gesture === 'point') {
            state.nonPointFrames = 0;
        }

        // 画画过程中不响应 scissors/thumbs_up/ok 触发，避免误撤销/误清空
        if (!state.gestureDrawing) {
            handleGestureTriggers(gesture);
        } else {
            // 画画中保持冷却计数，但不允许触发
            state.heldGesture = null;
            state.heldFrames = 0;
        }

        if (effectiveGesture === 'point') {
            gestureEraseStop();
            if (!state.gestureDrawing) {
                gesturePenDown(nx, ny);
            } else {
                gesturePenMove(nx, ny);
            }
            updateCursor(nx, ny, true, state.color);
            setStatus(gesture === 'point'
                ? '✏️ 手势作画中'
                : `✏️ 手势作画中（粘滞 ${state.nonPointFrames}/${DRAW_STICKY_FRAMES}）`);
        } else if (effectiveGesture === 'palm') {
            gesturePenUp();
            state.gestureErasing = true;
            gestureErase(nx, ny);
            updateCursor(nx, ny, true, '#ef4444');
            setStatus('🧽 手势擦除中');
        } else {
            gesturePenUp();
            gestureEraseStop();
            state.nonPointFrames = 0;
            updateCursor(nx, ny, true, state.color);
            if (effectiveGesture === 'fist') {
                setStatus('✊ 抬笔');
            } else if (effectiveGesture === 'scissors') {
                setStatus('✌️ 保持剪刀手以撤销…');
            } else if (effectiveGesture === 'thumbs_up') {
                setStatus('👍 保持以保存 PNG…');
            } else if (effectiveGesture === 'ok') {
                setStatus('👌 保持以清空…');
            } else {
                setStatus('等待手势');
            }
        }

        state.activeGesture = gesture;
    }

    // ---------- 事件绑定 ----------

    function bindEvents() {
        btnPen.addEventListener('click', () => setTool('pen'));
        btnEraser.addEventListener('click', () => setTool('eraser'));
        btnUndo.addEventListener('click', undo);
        btnRedo.addEventListener('click', redo);
        btnClear.addEventListener('click', () => {
            if (confirm('确定要清空画布吗？')) clearCanvas();
        });
        btnSave.addEventListener('click', savePng);

        colorInput.addEventListener('input', (e) => {
            state.color = e.target.value;
        });
        sizeSlider.addEventListener('input', (e) => {
            state.size = parseInt(e.target.value, 10);
            if (sizeValue) sizeValue.textContent = String(state.size);
        });

        // 鼠标
        canvas.addEventListener('mousedown', beginStroke);
        canvas.addEventListener('mousemove', moveStroke);
        window.addEventListener('mouseup', endStroke);
        canvas.addEventListener('mouseleave', endStroke);

        // 触屏
        canvas.addEventListener('touchstart', beginStroke, { passive: false });
        canvas.addEventListener('touchmove', moveStroke, { passive: false });
        canvas.addEventListener('touchend', endStroke, { passive: false });
        canvas.addEventListener('touchcancel', endStroke, { passive: false });

        // 快捷键
        window.addEventListener('keydown', (e) => {
            const isMod = e.ctrlKey || e.metaKey;
            if (!isMod) return;
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
            else if (key === 's') { e.preventDefault(); savePng(); }
        });

        // 窗口缩放
        window.addEventListener('resize', () => resizeCanvas(true));

        // 手势控制开关 → 同步到 camera
        if (gestureToggle) {
            gestureToggle.addEventListener('change', (e) => {
                if (window.BindrawCamera && typeof window.BindrawCamera.setEnabled === 'function') {
                    window.BindrawCamera.setEnabled(e.target.checked);
                }
                if (!e.target.checked) {
                    gesturePenUp();
                    gestureEraseStop();
                    updateCursor(0, 0, false);
                }
            });
        }

        // 摄像头显示开关
        if (cameraToggle) {
            cameraToggle.addEventListener('change', (e) => {
                if (window.BindrawCamera && typeof window.BindrawCamera.setVisible === 'function') {
                    window.BindrawCamera.setVisible(e.target.checked);
                }
            });
        }

        // 骨架显示开关
        if (skeletonToggle) {
            skeletonToggle.addEventListener('change', (e) => {
                if (window.BindrawCamera && typeof window.BindrawCamera.setShowSkeleton === 'function') {
                    window.BindrawCamera.setShowSkeleton(e.target.checked);
                }
            });
        }

        // 手势图例折叠
        if (legendToggle && legendBody) {
            legendToggle.addEventListener('click', () => {
                const expanded = legendToggle.getAttribute('aria-expanded') === 'true';
                legendToggle.setAttribute('aria-expanded', String(!expanded));
                legendBody.hidden = expanded;
            });
        }
    }

    // ---------- 启动 ----------

    function init() {
        setTool('pen');
        resizeCanvas(false);
        saveHistory();
        bindEvents();

        if (window.BindrawCamera && typeof window.BindrawCamera.onGesture === 'function') {
            window.BindrawCamera.onGesture(onGestureFrame);
        } else {
            console.warn('[bindraw] BindrawCamera not available');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
