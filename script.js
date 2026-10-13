/* ==========================================================
   Interactive Online Whiteboard
   Features: pen, eraser, line, rectangle, ellipse, text,
   colour, background colour, brush size, fill shapes,
   undo/redo, save PNG, clear, touch/pen support,
   autosave (localStorage), live sync between browser tabs.
   ========================================================== */

// ---------- Canvas setup ----------
// The drawing surface has a fixed internal resolution. CSS scales it to the
// container, and pointer positions are mapped back to canvas coordinates.
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 800;

const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const canvasWrapper = document.getElementById('canvasWrapper');

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// ---------- DOM references ----------
const colorPicker = document.getElementById('colorPicker');
const bgColorPicker = document.getElementById('bgColorPicker');
const fillCheckbox = document.getElementById('fillCheckbox');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const saveButton = document.getElementById('saveButton');
const clearButton = document.getElementById('clearButton');
const statusText = document.getElementById('statusText');
const toolButtons = document.querySelectorAll('[data-tool]');

// ---------- State ----------
let painting = false;
let currentTool = 'pen';          // pen | eraser | line | rect | circle | text
let brushColor = '#000000';
let brushSize = 5;
let backgroundColor = '#ffffff';
let fillShapes = false;

let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let lastMidX = 0;
let lastMidY = 0;
let shapeSnapshot = null;         // canvas pixels captured before drawing a shape

const MAX_HISTORY = 50;
let undoStack = [];
let redoStack = [];

let activeTextInput = null;

const STORAGE_KEY = 'whiteboard-autosave';
const channel = ('BroadcastChannel' in window) ? new BroadcastChannel('whiteboard-sync') : null;

// ---------- Helpers ----------
function setStatus(message) {
    statusText.textContent = message;
}

function getPosition(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
}

function applyBackground(color) {
    backgroundColor = color;
    canvas.style.backgroundColor = color;
    bgColorPicker.value = color;
}

function prepareContext(erasing) {
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = brushColor;
    ctx.fillStyle = brushColor;
    // Eraser removes pixels so the background colour shows through.
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
}

function updateCursor() {
    canvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
}

function updateHistoryButtons() {
    undoButton.disabled = undoStack.length <= 1;
    redoButton.disabled = redoStack.length === 0;
}

// ---------- History (undo / redo) ----------
function snapshot() {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function commitState(broadcast = true) {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
    autosave();
    if (broadcast) broadcastBoard();
}

function restoreState(imageData) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.putImageData(imageData, 0, 0);
}

function undo() {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    restoreState(undoStack[undoStack.length - 1]);
    updateHistoryButtons();
    autosave();
    broadcastBoard();
    setStatus('Undo');
}

function redo() {
    if (redoStack.length === 0) return;
    const state = redoStack.pop();
    undoStack.push(state);
    restoreState(state);
    updateHistoryButtons();
    autosave();
    broadcastBoard();
    setStatus('Redo');
}

// ---------- Autosave and tab sync ----------
function autosave() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            image: canvas.toDataURL('image/png'),
            background: backgroundColor
        }));
    } catch (err) {
        // Storage may be full or blocked; the board still works without it.
    }
}

function loadBoardFromData(data, done) {
    const img = new Image();
    img.onload = () => {
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (data.background) applyBackground(data.background);
        if (done) done();
    };
    img.src = data.image;
}

function broadcastBoard() {
    if (!channel) return;
    try {
        channel.postMessage({ image: canvas.toDataURL('image/png'), background: backgroundColor });
    } catch (err) {
        // Ignore sync errors.
    }
}

if (channel) {
    channel.onmessage = (event) => {
        loadBoardFromData(event.data, () => {
            commitState(false);       // keep it in history, but don't echo it back
            setStatus('Updated from another tab');
        });
    };
}

// ---------- Drawing: pen and eraser ----------
function startFreehand(pos) {
    const erasing = currentTool === 'eraser';
    prepareContext(erasing);

    // Draw a dot so a single click leaves a mark.
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();

    lastX = pos.x;
    lastY = pos.y;
    lastMidX = pos.x;
    lastMidY = pos.y;
}

function drawFreehand(pos) {
    const erasing = currentTool === 'eraser';
    prepareContext(erasing);

    // Smooth the line with quadratic curves through midpoints.
    const midX = (lastX + pos.x) / 2;
    const midY = (lastY + pos.y) / 2;

    ctx.beginPath();
    ctx.moveTo(lastMidX, lastMidY);
    ctx.quadraticCurveTo(lastX, lastY, midX, midY);
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
    lastMidX = midX;
    lastMidY = midY;
}

// ---------- Drawing: shapes ----------
function drawShape(tool, x1, y1, x2, y2) {
    prepareContext(false);
    ctx.beginPath();

    if (tool === 'line') {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        return;
    }

    if (tool === 'rect') {
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
    } else if (tool === 'circle') {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2;
        const ry = Math.abs(y2 - y1) / 2;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    }

    if (fillShapes) ctx.fill();
    ctx.stroke();
}

// ---------- Text tool ----------
function finishTextInput(commit) {
    if (!activeTextInput) return;

    const input = activeTextInput.element;
    const { canvasX, canvasY, fontSize } = activeTextInput;
    const text = input.value;
    activeTextInput = null;
    input.remove();

    if (!commit || text.trim() === '') return;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = brushColor;
    ctx.font = fontSize + 'px Arial, sans-serif';
    ctx.textBaseline = 'top';

    text.split('\n').forEach((line, index) => {
        ctx.fillText(line, canvasX, canvasY + index * fontSize * 1.2);
    });
    commitState();
    setStatus('Text added');
}

function startTextInput(e, pos) {
    finishTextInput(true);

    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / canvas.width;
    const fontSize = Math.max(16, brushSize * 4);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input';
    input.style.left = (e.clientX - canvasWrapper.getBoundingClientRect().left) + 'px';
    input.style.top = (e.clientY - canvasWrapper.getBoundingClientRect().top) + 'px';
    input.style.fontSize = (fontSize * scale) + 'px';
    input.style.color = brushColor;

    input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();         // keep shortcuts from firing while typing
        if (ev.key === 'Enter') finishTextInput(true);
        if (ev.key === 'Escape') finishTextInput(false);
    });
    input.addEventListener('blur', () => finishTextInput(true));

    canvasWrapper.appendChild(input);
    activeTextInput = { element: input, canvasX: pos.x, canvasY: pos.y, fontSize: fontSize };
    setTimeout(() => input.focus(), 0);
}

// ---------- Pointer events (mouse, touch and pen) ----------
function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const pos = getPosition(e);

    if (currentTool === 'text') {
        e.preventDefault();
        startTextInput(e, pos);
        return;
    }

    finishTextInput(true);
    painting = true;
    canvas.setPointerCapture(e.pointerId);
    startX = pos.x;
    startY = pos.y;

    if (currentTool === 'pen' || currentTool === 'eraser') {
        startFreehand(pos);
    } else {
        shapeSnapshot = snapshot();
    }
}

function onPointerMove(e) {
    if (!painting) return;
    const pos = getPosition(e);

    if (currentTool === 'pen' || currentTool === 'eraser') {
        drawFreehand(pos);
    } else {
        // Redraw from the saved pixels so the shape previews live.
        restoreState(shapeSnapshot);
        drawShape(currentTool, startX, startY, pos.x, pos.y);
    }
}

function onPointerUp(e) {
    if (!painting) return;
    painting = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    shapeSnapshot = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    commitState();
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointercancel', onPointerUp);

// ---------- Toolbar ----------
function selectTool(tool) {
    finishTextInput(true);
    currentTool = tool;
    toolButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    updateCursor();
    setStatus('Tool: ' + tool);
}

toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
});

colorPicker.addEventListener('input', (e) => {
    brushColor = e.target.value;
    if (currentTool === 'eraser') selectTool('pen');
});

bgColorPicker.addEventListener('input', (e) => {
    applyBackground(e.target.value);
});

bgColorPicker.addEventListener('change', () => {
    autosave();
    broadcastBoard();
});

fillCheckbox.addEventListener('change', (e) => {
    fillShapes = e.target.checked;
});

brushSizeInput.addEventListener('input', (e) => {
    brushSize = Number(e.target.value);
    brushSizeValue.textContent = brushSize;
});

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

clearButton.addEventListener('click', () => {
    finishTextInput(false);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    commitState();
    setStatus('Board cleared');
});

function saveImage() {
    // Merge the background colour into the exported image.
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    exportCtx.fillStyle = backgroundColor;
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(canvas, 0, 0);

    exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'whiteboard-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus('Image saved');
    }, 'image/png');
}

saveButton.addEventListener('click', saveImage);

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
    const typing = e.target.tagName === 'INPUT' && e.target.type === 'text';
    if (typing) return;

    const key = e.key.toLowerCase();

    if (e.ctrlKey || e.metaKey) {
        if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        else if (key === 's') { e.preventDefault(); saveImage(); }
        return;
    }

    const shortcuts = { p: 'pen', e: 'eraser', l: 'line', r: 'rect', o: 'circle', t: 'text' };
    if (shortcuts[key]) selectTool(shortcuts[key]);
});

// ---------- Init ----------
function init() {
    let saved = null;
    try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (err) {
        saved = null;
    }

    applyBackground(backgroundColor);
    updateCursor();

    if (saved && saved.image) {
        loadBoardFromData(saved, () => {
            undoStack = [snapshot()];
            updateHistoryButtons();
            setStatus('Previous board restored');
        });
    } else {
        undoStack = [snapshot()];
        updateHistoryButtons();
    }
}

init();
