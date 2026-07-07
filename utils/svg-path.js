/**
 * SVG Path 解析器 —— 将 SVG path 'd' 字符串转换为 Canvas 2D 绘图命令。
 * 支持 M/m L/l C/c Q/q H/h V/v Z/z 命令（绝对/相对）。
 */

const PARAM_COUNT = {
  M: 2, L: 2, C: 6, Q: 4, H: 1, V: 1, Z: 0,
  m: 2, l: 2, c: 6, q: 4, h: 1, v: 1, z: 0
};

function tokenize(d) {
  const tokens = [];
  const regex = /([MLCQHVAZmlcqhvaz])|(-?\d*\.?\d+(?:e[+-]?\d+)?)/g;
  let match;
  while ((match = regex.exec(d)) !== null) {
    if (match[1] !== undefined) {
      tokens.push({ type: 'cmd', value: match[1] });
    } else {
      tokens.push({ type: 'num', value: parseFloat(match[2]) });
    }
  }
  return tokens;
}

/**
 * 在 Canvas 2D 上下文上描绘 SVG 路径。
 * 调用前应先 ctx.beginPath()。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} d - SVG path 的 d 属性
 */
function tracePath(ctx, d) {
  if (!d) return;
  const tokens = tokenize(d);
  let cmd = 'M';
  let params = [];
  let cx = 0, cy = 0;   // current point
  let sx = 0, sy = 0;   // subpath start point

  const flush = () => {
    if (params.length === 0) return;
    const lower = cmd.toLowerCase();
    const rel = cmd === lower;

    switch (lower) {
      case 'm': {
        let x = params[0], y = params[1];
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; sx = x; sy = y;
        ctx.moveTo(x, y);
        break;
      }
      case 'l': {
        let x = params[0], y = params[1];
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y;
        ctx.lineTo(x, y);
        break;
      }
      case 'c': {
        let x1 = params[0], y1 = params[1];
        let x2 = params[2], y2 = params[3];
        let x = params[4], y = params[5];
        if (rel) {
          x1 += cx; y1 += cy;
          x2 += cx; y2 += cy;
          x += cx; y += cy;
        }
        ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
        cx = x; cy = y;
        break;
      }
      case 'q': {
        let x1 = params[0], y1 = params[1];
        let x = params[2], y = params[3];
        if (rel) {
          x1 += cx; y1 += cy;
          x += cx; y += cy;
        }
        ctx.quadraticCurveTo(x1, y1, x, y);
        cx = x; cy = y;
        break;
      }
      case 'h': {
        let x = params[0];
        if (rel) x += cx;
        cx = x;
        ctx.lineTo(x, cy);
        break;
      }
      case 'v': {
        let y = params[0];
        if (rel) y += cy;
        cy = y;
        ctx.lineTo(cx, y);
        break;
      }
      case 'z': {
        ctx.closePath();
        cx = sx; cy = sy;
        break;
      }
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'cmd') {
      if (params.length > 0) flush();
      cmd = t.value;
      params = [];
      if (cmd.toLowerCase() === 'z') flush();
    } else {
      params.push(t.value);
      const need = PARAM_COUNT[cmd];
      if (need && params.length === need) {
        flush();
        params = [];
        // 首个 M 之后的多组坐标视为隐式 L
        if (cmd === 'M') cmd = 'L';
        else if (cmd === 'm') cmd = 'l';
      }
    }
  }
  if (params.length > 0) flush();
}

/**
 * 将路径按子路径拆分（以 M 开头）。
 * @param {string} d
 * @returns {string[]} 子路径数组
 */
function splitPath(d) {
  if (!d) return [];
  return d.split(/(?=M)/).map(s => s.trim()).filter(Boolean);
}

/**
 * 计算路径的包围盒 {x, y, width, height}。
 * @param {string} d
 */
function getPathBounds(d) {
  if (!d) return { x: 0, y: 0, width: 0, height: 0 };
  const matches = d.matchAll(/(-?\d+\.?\d*)[ ,]+(-?\d+\.?\d*)/g);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of matches) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

module.exports = { tracePath, splitPath, getPathBounds, tokenize };
