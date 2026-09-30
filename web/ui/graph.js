import { DEPENDENCIES } from '../core/dependencies.js';
import { FEATURES } from '../core/features.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW = 46;
const NODE_H = 32;
const TOP = 20;
const COLS = { network: 16, remote: 276, feature: 556 };
const WIDTH = { network: 170, remote: 190, feature: 190 };

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function edgeClass(reason) {
  if (!reason) return 'ok';
  if (reason.outcome === 'slow') return 'slow';
  if (reason.outcome === 'fallback') return 'fallback';
  return 'fail';
}

function curve(x1, y1, x2, y2) {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
}

/**
 * Render the dependency graph for one mode.
 * t(key) translates; evaluation comes from engine.evaluate().
 */
export function renderGraph(container, { evaluation, mode, t }) {
  const network = DEPENDENCIES.filter((d) => d.kind === 'network');
  const remote = DEPENDENCIES.filter((d) => d.kind === 'remote');
  const height = TOP * 2 + FEATURES.length * ROW;
  const svg = el('svg', { viewBox: `0 0 762 ${height}`, role: 'img', 'aria-label': t('graph.title') });

  const pos = {};
  const place = (id, col, index, count) => {
    const offset = ((FEATURES.length - count) * ROW) / 2;
    pos[id] = { x: COLS[col], y: TOP + offset + index * ROW, w: WIDTH[col] };
  };
  network.forEach((d, i) => place(d.id, 'network', i, network.length));
  remote.forEach((d, i) => place(d.id, 'remote', i, remote.length));
  FEATURES.forEach((f, i) => place(`f:${f.id}`, 'feature', i, FEATURES.length));

  const edges = el('g');
  const mid = NODE_H / 2;
  for (const r of remote) {
    for (const n of network) {
      const a = pos[n.id];
      const b = pos[r.id];
      const state = evaluation.effective[n.id].state;
      const cls = state === 'down' ? 'fail' : state === 'up' ? 'ok' : 'slow';
      edges.append(el('path', { class: `edge ${cls}`, d: curve(a.x + a.w, a.y + mid, b.x, b.y + mid) }));
    }
  }
  for (const f of FEATURES) {
    const result = evaluation.features[f.id][mode];
    for (const dep of f[mode].requires) {
      const a = pos[dep];
      const b = pos[`f:${f.id}`];
      const reason = result.reasons.find((x) => x.dep === dep);
      edges.append(el('path', { class: `edge ${edgeClass(reason)}`, d: curve(a.x + a.w, a.y + mid, b.x, b.y + mid) }));
    }
  }
  svg.append(edges);

  const nodes = el('g');
  const drawNode = (id, label, cls, sub) => {
    const p = pos[id];
    const g = el('g', { class: `node ${cls}` });
    g.append(el('rect', { x: p.x, y: p.y, width: p.w, height: NODE_H, rx: 5 }));
    g.append(el('text', { x: p.x + 10, y: p.y + 21 }, label));
    if (sub) g.append(el('title', {}, sub));
    nodes.append(g);
  };
  for (const d of DEPENDENCIES) {
    const state = evaluation.effective[d.id].state;
    drawNode(d.id, t(`dep.${d.id}`), state, t(`state.${state}`));
  }
  for (const f of FEATURES) {
    const status = evaluation.features[f.id][mode].status;
    drawNode(`f:${f.id}`, t(`feature.${f.id}`), status, t(`status.${status}`));
  }
  svg.append(nodes);

  container.replaceChildren(svg);
  return svg;
}
