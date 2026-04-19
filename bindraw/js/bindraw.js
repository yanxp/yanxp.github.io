/**
 * bindraw.js — 画板模块
 *
 * 提供画笔 / 橡皮擦 / 颜色 / 粗细 / 撤销 / 重做 / 清空 /
 * 摄像头截图导入 / 保存 PNG 等能力。
 */
(function () {
    'use strict';

    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    const statusEl = document.getElementById('draw-status');

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

    const MAX_HISTORY = 40;

    const state = {
        tool: 'pen',
        color: colorInput.value,
        size: parseInt(sizeSlider.value, 10),
        drawing: false,
        lastX: 0,
        lastY: 0,
        history: [],
        redoStack: []
    };

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

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
        // 设置基础样式
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }

    function saveHistory() {
        try {
            const url = canvas.toDataURL('image/png');
            state.history.push(url);
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
        const previous = state.history[state.history.length - 1];
        await restoreFromDataURL(previous);
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

    function setTool(tool) {
        state.tool = tool;
        btnPen.classList.toggle('active', tool === 'pen');
        btnEraser.classList.toggle('active', tool === 'eraser');
        btnPen.setAttribute('aria-pressed', String(tool === 'pen'));
        btnEraser.setAttribute('aria-pressed', String(tool === 'eraser'));
    }

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

        const dpr = window.devicePixelRatio || 1;
        ctx.lineWidth = state.size * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (state.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = state.color;
        }

        // 单击点也画上一个圆点
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

    async function captureToBoard() {
        if (!window.BindrawCamera || typeof window.BindrawCamera.captureFrame !== 'function') {
            setStatus('摄像头模块不可用');
            return;
        }
        const frame = window.BindrawCamera.captureFrame();
        if (!frame) {
            setStatus('摄像头尚未就绪');
            return;
        }
        // 清空并平铺到整个画板
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 保持等比居中（cover 风格：填满画板，可能裁剪）
        const srcW = frame.width;
        const srcH = frame.height;
        const dstW = canvas.width;
        const dstH = canvas.height;
        const scale = Math.max(dstW / srcW, dstH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const dx = (dstW - drawW) / 2;
        const dy = (dstH - drawH) / 2;
        ctx.drawImage(frame.canvas, 0, 0, srcW, srcH, dx, dy, drawW, drawH);
        ctx.restore();

        saveHistory();
        setStatus('已将摄像头画面导入画板');
    }

    function savePng() {
        canvas.toBlob((blob) => {
            if (!blob) {
                setStatus('保存失败');
                return;
            }
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

    function bindEvents() {
        // 工具
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
            if (state.tool !== 'eraser') {
                setTool('pen');
            }
        });
        sizeSlider.addEventListener('input', (e) => {
            state.size = parseInt(e.target.value, 10);
            if (sizeValue) sizeValue.textContent = String(state.size);
        });

        // 鼠标
        canvas.addEventListener('mousedown', beginStroke);
        window.addEventListener('mousemove', moveStroke);
        window.addEventListener('mouseup', endStroke);

        // 触屏
        canvas.addEventListener('touchstart', beginStroke, { passive: false });
        canvas.addEventListener('touchmove', moveStroke, { passive: false });
        canvas.addEventListener('touchend', endStroke, { passive: false });
        canvas.addEventListener('touchcancel', endStroke, { passive: false });

        // 键盘快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做
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

        // 窗口尺寸变化
        window.addEventListener('resize', () => resizeCanvas(true));
    }

    function init() {
        resizeCanvas(false);
        saveHistory(); // 初始空白状态
        bindEvents();
        setStatus('准备就绪');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
