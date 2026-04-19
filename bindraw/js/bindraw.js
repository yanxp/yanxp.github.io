/**
 * bindraw.js — 画板 + 手势驱动逻辑
 *
 * - 提供鼠标 / 触屏的基础画板操作（画笔、橡皮擦、颜色、粗细、撤销、重做、
 *   清空、摄像头截图导入、保存 PNG）
 * - 订阅 window.BindrawCamera 的手势事件，基于手势驱动画笔：
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
    const btnCapture = document.getElementById('btn-capture');
    const btnSave = document.getElementById('btn-save');
    const colorInput = document.getElementById('color-picker');
    const sizeSlider = document.getElementById('size-slider');
    const sizeValue = document.getElementById('size-value');
    const gestureToggle = document.getElementById('gesture-toggle');

    const MAX_HISTORY = 40;
    // 持续手势触发动作所需帧数（约 500ms @ 30fps）
    const TRIGGER_HOLD_FRAMES = 15;
    // 触发后的冷却，防止重复
    const TRIGGER_COOLDOWN_MS = 1200;

    const state = {
        tool: 'pen',
        color: colorInput.value,
        size: parseInt(sizeSlider.value, 10),
        drawing: false,
        lastX: 0,
        lastY: 0,
        history: [],
        redoStack: [],
        // 手势相关
        gestureDrawing: false,
        gestureErasing: false,
        smoothX: null,
        smoothY: null,
        activeGesture: 'none',
        heldGesture: null,
        heldFrames: 0,
        lastTriggerAt: 0
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
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
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
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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

    function captureToBoard() {
        if (!window.BindrawCamera || typeof window.BindrawCamera.captureFrame !== 'function') {
            setStatus('摄像头模块不可用');
            return;
        }
        const frame = window.BindrawCamera.captureFrame();
        if (!frame) {
            setStatus('摄像头尚未就绪');
            return;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const srcW = frame.width;
        const srcH = frame.height;
        const dstW = canvas.width;
        const dstH = canvas.height;
        const scale = Math.max(dstW / srcW, dstH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        ctx.drawImage(frame.canvas, 0, 0, srcW, srcH,
            (dstW - drawW) / 2, (dstH - drawH) / 2, drawW, drawH);
        ctx.restore();
        saveHistory();
        setStatus('已将摄像头画面导入画板');
    }

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
            // 指数移动平均，兼顾跟手与稳定
            const alpha = 0.45;
            state.smoothX = state.smoothX * (1 - alpha) + nx * alpha;
            state.smoothY = state.smoothY * (1 - alpha) + ny * alpha;
        }
        return { nx: state.smoothX, ny: state.smoothY };
    }

    function canvasCoordFromNorm(nx, ny) {
        return { x: nx * canvas.width, y: ny * canvas.height };
    }

    function handleGestureTriggers(gesture) {
        // 触发类手势（scissors / thumbs_up / ok）需持续若干帧并满足冷却
        const now = performance.now();
        if (gesture === state.heldGesture) {
            state.heldFrames += 1;
        } else {
            state.heldGesture = gesture;
            state.heldFrames = 1;
        }

        const cooldownOk = now - state.lastTriggerAt > TRIGGER_COOLDOWN_MS;
        if (!cooldownOk) {
            // 冷却期内防止 heldFrames 跨过阈值而再也无法相等；下次冷却结束时可立即触发
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
        applyStrokeStyle('eraser');
        const r = Math.max(12, state.size * 2.5);
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
            updateCursor(0, 0, false);
            return;
        }

        const { nx, ny } = smoothPos(fingertip.nx, fingertip.ny);

        // 触发类动作（仅在进入该手势时计数）
        handleGestureTriggers(gesture);

        if (gesture === 'point') {
            gestureEraseStop();
            if (!state.gestureDrawing) {
                gesturePenDown(nx, ny);
            } else {
                gesturePenMove(nx, ny);
            }
            updateCursor(nx, ny, true, state.color);
            setStatus('✏️ 手势作画中');
        } else if (gesture === 'palm') {
            gesturePenUp();
            state.gestureErasing = true;
            gestureErase(nx, ny);
            updateCursor(nx, ny, true, '#ef4444');
            setStatus('🧽 手势擦除中');
        } else {
            // fist / scissors / thumbs_up / ok / none — 抬笔/停擦，仅显示光标
            gesturePenUp();
            gestureEraseStop();
            updateCursor(nx, ny, true, state.color);
            if (gesture === 'fist') setStatus('✊ 已抬笔');
            else if (gesture === 'scissors') setStatus('✌️ 保持以撤销…');
            else if (gesture === 'thumbs_up') setStatus('👍 保持以保存…');
            else if (gesture === 'ok') setStatus('👌 保持以清空…');
            else setStatus('等待手势');
        }
        state.activeGesture = gesture;
    }

    // ---------- 绑定事件 ----------

    function bindEvents() {
        btnPen.addEventListener('click', () => setTool('pen'));
        btnEraser.addEventListener('click', () => setTool('eraser'));
        btnUndo.addEventListener('click', undo);
        btnRedo.addEventListener('click', redo);
        btnClear.addEventListener('click', () => {
            if (confirm('确定要清空画布吗？')) clearCanvas();
        });
        btnCapture.addEventListener('click', captureToBoard);
        btnSave.addEventListener('click', savePng);

        colorInput.addEventListener('input', (e) => {
            state.color = e.target.value;
            if (state.tool !== 'eraser') setTool('pen');
        });
        sizeSlider.addEventListener('input', (e) => {
            state.size = parseInt(e.target.value, 10);
            if (sizeValue) sizeValue.textContent = String(state.size);
        });

        gestureToggle.addEventListener('change', (e) => {
            const on = !!e.target.checked;
            if (window.BindrawCamera && typeof window.BindrawCamera.setEnabled === 'function') {
                window.BindrawCamera.setEnabled(on);
            }
            setStatus(on ? '手势控制已开启' : '手势控制已关闭');
        });

        canvas.addEventListener('mousedown', beginStroke);
        window.addEventListener('mousemove', moveStroke);
        window.addEventListener('mouseup', endStroke);

        canvas.addEventListener('touchstart', beginStroke, { passive: false });
        canvas.addEventListener('touchmove', moveStroke, { passive: false });
        canvas.addEventListener('touchend', endStroke, { passive: false });
        canvas.addEventListener('touchcancel', endStroke, { passive: false });

        window.addEventListener('keydown', (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            if (e.key === 'z' || e.key === 'Z') {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
            } else if (e.key === 'y' || e.key === 'Y') {
                e.preventDefault();
                redo();
            }
        });

        window.addEventListener('resize', () => resizeCanvas(true));
    }

    function subscribeCamera() {
        const tryAttach = () => {
            if (window.BindrawCamera && typeof window.BindrawCamera.onGesture === 'function') {
                window.BindrawCamera.onGesture(onGestureFrame);
                return true;
            }
            return false;
        };
        if (!tryAttach()) {
            // camera.js 可能稍后加载完成
            const iv = setInterval(() => {
                if (tryAttach()) clearInterval(iv);
            }, 100);
        }
    }

    function init() {
        resizeCanvas(false);
        saveHistory();
        bindEvents();
        subscribeCamera();
        setStatus('准备就绪');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
