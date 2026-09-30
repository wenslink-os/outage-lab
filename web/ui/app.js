import { DEPENDENCIES, MAX_LATENCY_MS } from '../core/dependencies.js';
import { FEATURES } from '../core/features.js';
import { evaluate, suiteScore, DEFAULT_TIMEOUT_MS } from '../core/engine.js';
import {
  PRESETS, getPreset, matchPreset, cloneScenario, encodeScenario, decodeScenario,
  toJSON, fromJSON, randomScenario
} from '../core/scenarios.js';
import { translate } from '../core/i18n.js';
import { createServices } from '../core/services.js';
import { createFragileClient, createResilientClient, JOURNEY } from '../core/clients.js';
import { createScaledClock } from '../core/clock.js';
import { openBestStore } from '../core/store.js';
import { renderGraph } from './graph.js';

const CLOCK_SCALE = 0.25;
const SUITE = suiteScore(PRESETS.map((p) => p.scenario));

const state = {
  scenario: getPreset('allGood'),
  graphMode: 'resilient',
  evaluation: null,
  storeInfo: null,
  flushClient: null,
  running: false,
  journey: { fragile: [], resilient: [] },
  hasRun: false,
  offlineReady: false
};

const $ = (id) => document.getElementById(id);
const t = translate;

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function setStatus(id, text) {
  $(id).textContent = text;
}

/* ---------- scenario state ---------- */

function setScenario(next, { updateHash = true } = {}) {
  state.scenario = cloneScenario(next);
  state.evaluation = evaluate(state.scenario);
  if (updateHash) {
    const url = `${location.pathname}${location.search}#s=${encodeScenario(state.scenario)}`;
    history.replaceState(null, '', url);
  }
  renderBoard();
  renderResults();
  renderGraphSection();
}

function loadFromHash() {
  const m = /^#s=(.+)$/.exec(location.hash);
  if (!m) return false;
  try {
    setScenario(decodeScenario(decodeURIComponent(m[1])), { updateHash: false });
    return true;
  } catch {
    return false;
  }
}

/* ---------- static text ---------- */

function renderStaticText() {
  document.title = t('app.title');
  setStatus('app-title', t('app.title'));
  setStatus('app-tagline', t('app.tagline'));
  setStatus('services-title', t('panel.services'));
  setStatus('device-title', t('panel.device'));
  setStatus('scenarios-title', t('panel.scenarios'));
  setStatus('share-title', t('panel.share'));
  setStatus('ctx-cacheWarm-label', t('ctx.cacheWarm'));
  setStatus('ctx-hasSession-label', t('ctx.hasSession'));
  setStatus('chaos', t('action.chaos'));
  setStatus('copy-link', t('action.copyLink'));
  setStatus('download-scenario', t('action.download'));
  setStatus('upload-label', t('action.upload'));
  setStatus('results-title', t('results.title'));
  setStatus('graph-title', t('graph.title'));
  setStatus('graph-caption', t('graph.caption'));
  setStatus('journey-title', t('journey.title'));
  setStatus('journey-caption', t('journey.caption'));
  setStatus('flush-queue', t('queue.flush'));
  setStatus('export-device', t('action.exportDevice'));
  setStatus('footer-text', t('footer.text'));
  setStatus('source-link', t('footer.source'));
  setStatus('offline-status', t(state.offlineReady ? 'offline.ready' : 'offline.notReady'));
  renderRunButton();
  renderStorageStatus();
}

function renderRunButton() {
  const btn = $('run-journey');
  btn.textContent = state.running ? t('journey.running') : t('journey.run');
  btn.disabled = state.running;
  $('flush-queue').disabled = state.running;
}

function renderStorageStatus() {
  if (!state.storeInfo) return;
  setStatus('storage-status', t(state.storeInfo.persistent ? 'storage.persistent' : 'storage.memory'));
}

/* ---------- switchboard ---------- */

function renderBoard() {
  const wrap = $('dep-switches');
  const eff = state.evaluation.effective;
  wrap.replaceChildren(
    ...DEPENDENCIES.map((dep) => {
      const d = state.scenario.deps[dep.id];
      const e = eff[dep.id];
      const inherited = e.state !== d.state && e.cause && e.cause !== dep.id;
      const effectiveText = inherited ? `${t(`state.${e.state}`)} (${t(`dep.${e.cause}`)})` : e.state === 'timeout' ? t('state.timeout') : '';
      const name = `dep-${dep.id}`;
      const rocker = h('div', { class: 'rocker' },
        ...['up', 'slow', 'down'].map((s) =>
          h('label', {},
            h('input', {
              type: 'radio', name, value: s, checked: d.state === s,
              onchange: () => {
                const next = cloneScenario(state.scenario);
                next.deps[dep.id] = { state: s, latencyMs: s === 'slow' ? Math.max(d.latencyMs, 1500) : 0 };
                setScenario(next);
              }
            }),
            h('span', {}, t(`state.${s}`))
          )
        )
      );
      const children = [h('legend', {}, h('span', {}, t(`dep.${dep.id}`)), h('span', { class: 'effective' }, effectiveText)), rocker];
      if (d.state === 'slow') {
        const id = `lat-${dep.id}`;
        const label = h('label', { for: id }, t('latency.label', { ms: d.latencyMs }));
        const input = h('input', {
          id, type: 'range', min: 100, max: MAX_LATENCY_MS, step: 100, value: d.latencyMs,
          oninput: (ev) => { label.textContent = t('latency.label', { ms: ev.target.value }); },
          onchange: (ev) => {
            const next = cloneScenario(state.scenario);
            next.deps[dep.id] = { state: 'slow', latencyMs: Number(ev.target.value) };
            setScenario(next);
            const again = document.getElementById(id);
            if (again) again.focus();
          }
        });
        children.push(h('div', { class: 'latency' }, label, input));
      }
      return h('fieldset', { class: 'switch' }, ...children);
    })
  );

  $('ctx-cacheWarm').checked = state.scenario.context.cacheWarm;
  $('ctx-hasSession').checked = state.scenario.context.hasSession;

  const current = matchPreset(state.scenario);
  $('presets').replaceChildren(
    ...PRESETS.map((p) =>
      h('button', {
        type: 'button', class: 'preset', 'aria-pressed': current === p.id ? 'true' : 'false',
        onclick: () => setScenario(getPreset(p.id))
      }, t(`preset.${p.id}`))
    )
  );
  setStatus('scenario-name', t(current ? `preset.${current}` : 'preset.custom'));
}

/* ---------- results ---------- */

function reasonText(r) {
  const ev = state.evaluation.effective[r.dep];
  const dep = t(`dep.${r.dep}`);
  const because = r.state === 'down' && r.cause && r.cause !== r.dep ? t('reason.because', { cause: t(`dep.${r.cause}`) }) : '';
  const base = { dep, because, ms: ev.latencyMs, timeout: DEFAULT_TIMEOUT_MS };
  switch (r.outcome) {
    case 'slow':
      return t('reason.slow', base);
    case 'hang':
      return t('reason.hang', base);
    case 'fallback':
      return r.state === 'timeout'
        ? t('reason.timeoutFallback', { ...base, fallback: t(`fallback.${r.fallback}`) })
        : t('reason.fallback', { ...base, fallback: t(`fallback.${r.fallback}`) });
    default:
      return r.fallback ? t('reason.failNoFallback', base) : t('reason.fail', base);
  }
}

function cell(feature, mode) {
  const result = state.evaluation.features[feature.id][mode];
  const lines = result.reasons.length
    ? result.reasons.map(reasonText)
    : [feature[mode].requires.length ? t('reason.none') : t('reason.local')];
  return h('td', {},
    h('span', { class: `pill ${result.status}` }, t(`status.${result.status}`)),
    ...lines.map((line) => h('span', { class: 'reason' }, line))
  );
}

function renderResults() {
  const score = state.evaluation.score;
  $('scores').replaceChildren(
    ...['fragile', 'resilient'].map((mode) =>
      h('div', { class: `score ${mode}` },
        h('h3', {}, t(`mode.${mode}`)),
        h('p', { class: 'hint' }, t(`mode.${mode}Hint`)),
        h('div', { class: 'numbers' },
          h('div', {}, h('div', { class: 'num' }, score[mode]), h('div', { class: 'num-label' }, t('score.current'))),
          h('div', {}, h('div', { class: 'num' }, SUITE[mode]), h('div', { class: 'num-label' }, t('score.suite', { n: PRESETS.length })))
        ),
        h('div', { class: 'meter', role: 'img', 'aria-label': `${t('score.title')}: ${score[mode]} / 100` },
          h('span', { style: `width:${score[mode]}%` }))
      )
    )
  );

  $('feature-table').replaceChildren(
    h('caption', { class: 'skip' }, t('results.title')),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('results.feature')),
      h('th', { scope: 'col' }, t('mode.fragile')),
      h('th', { scope: 'col' }, t('mode.resilient')))),
    h('tbody', {}, ...FEATURES.map((f) => h('tr', {}, h('th', { scope: 'row' }, t(`feature.${f.id}`)), cell(f, 'fragile'), cell(f, 'resilient'))))
  );
}

/* ---------- graph ---------- */

function renderGraphSection() {
  $('graph-mode').replaceChildren(
    ...['fragile', 'resilient'].map((mode) =>
      h('button', {
        type: 'button', 'aria-pressed': state.graphMode === mode ? 'true' : 'false',
        onclick: () => { state.graphMode = mode; renderGraphSection(); }
      }, t(`mode.${mode}`))
    )
  );
  $('graph-mode').setAttribute('aria-label', t('graph.show'));
  renderGraph($('graph'), { evaluation: state.evaluation, mode: state.graphMode, t });
}

/* ---------- journey ---------- */

function renderJourney() {
  const cols = ['fragile', 'resilient'].map((mode) => {
    const steps = state.journey[mode];
    const items = JOURNEY.map((feature) => {
      const step = steps.find((s) => s.feature === feature);
      const name = h('span', { class: 'name' }, t(`feature.${feature}`));
      if (!step) {
        return h('li', {}, h('div', { class: 'row' }, name, h('span', { class: 'pending' }, state.running ? '...' : '')));
      }
      return h('li', {},
        h('div', { class: 'row' }, name,
          h('span', {}, h('span', { class: `pill ${step.status}` }, t(`status.${step.status}`)), ' ',
            h('span', { class: 'took' }, t('journey.took', { ms: step.elapsedMs })))),
        step.notes.length
          ? h('details', {}, h('summary', {}, t('journey.log', { n: step.notes.length })), h('ul', {}, ...step.notes.map((n) => h('li', {}, `[${n.kind}] ${n.detail}`))))
          : null
      );
    });
    return h('div', { class: 'journey-col' }, h('h3', {}, t(`mode.${mode}`)),
      state.hasRun || state.running ? h('ol', {}, ...items) : h('p', { class: 'empty' }, t('journey.empty')));
  });
  $('journey-columns').replaceChildren(...cols);
}

async function renderQueueStatus(extra) {
  const client = state.flushClient;
  const n = client ? await client.queue.size() : 0;
  const base = n > 0 ? t('queue.count', { n }) : t('queue.empty');
  setStatus('queue-status', extra ? `${extra} ${base}` : base);
}

function buildClients() {
  const clock = createScaledClock(CLOCK_SCALE);
  const getScenario = () => state.scenario;
  const fragile = createFragileClient({ services: createServices({ getScenario, clock }), clock });
  const resilient = createResilientClient({ services: createServices({ getScenario, clock }), clock, store: state.storeInfo.store });
  return { fragile, resilient };
}

async function runJourney() {
  if (state.running) return;
  state.running = true;
  state.hasRun = true;
  state.journey = { fragile: [], resilient: [] };
  renderRunButton();
  renderJourney();
  try {
    const { fragile, resilient } = buildClients();
    state.flushClient = resilient;
    await resilient.seed(state.scenario.context);
    const onEvent = (ev) => {
      if (ev.kind === 'result') {
        state.journey[ev.mode].push(ev.step);
        renderJourney();
      }
    };
    await Promise.all([fragile.runJourney(onEvent), resilient.runJourney(onEvent)]);
  } finally {
    state.running = false;
    renderRunButton();
    renderJourney();
    await renderQueueStatus();
  }
}

async function flushQueue() {
  if (!state.flushClient || state.running) return;
  const btn = $('flush-queue');
  btn.disabled = true;
  try {
    const r = await state.flushClient.flushQueue();
    await renderQueueStatus(t('queue.flushed', { done: r.done.length, remaining: r.remaining }));
  } finally {
    btn.disabled = false;
  }
}

/* ---------- files and sharing ---------- */

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('share-status', t('action.copied'));
  } catch {
    setStatus('share-status', t('action.copyFailed'));
  }
}

async function uploadScenario(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    setScenario(fromJSON(await file.text()));
    setStatus('share-status', t('action.loaded'));
  } catch (error) {
    setStatus('share-status', t('action.loadFailed', { error: error.message }));
  }
}

async function exportDevice() {
  if (!state.flushClient) return;
  const data = await state.flushClient.exportData();
  download('outage-lab-device-data.json', JSON.stringify({ format: 'outage-lab-device-data', version: 1, data }, null, 2));
}

/* ---------- offline support ---------- */

function registerServiceWorker() {
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!('serviceWorker' in navigator) || !secure) return;
  navigator.serviceWorker.register('sw.js').then(
    () => navigator.serviceWorker.ready.then(() => {
      state.offlineReady = true;
      setStatus('offline-status', t('offline.ready'));
    }),
    () => setStatus('offline-status', t('offline.notReady'))
  );
}

/* ---------- boot ---------- */

async function boot() {
  state.evaluation = evaluate(state.scenario);
  state.storeInfo = await openBestStore(globalThis.indexedDB);
  const clock = createScaledClock(CLOCK_SCALE);
  state.flushClient = createResilientClient({ services: createServices({ getScenario: () => state.scenario, clock }), clock, store: state.storeInfo.store });

  $('ctx-cacheWarm').addEventListener('change', (ev) => {
    const next = cloneScenario(state.scenario);
    next.context.cacheWarm = ev.target.checked;
    setScenario(next);
  });
  $('ctx-hasSession').addEventListener('change', (ev) => {
    const next = cloneScenario(state.scenario);
    next.context.hasSession = ev.target.checked;
    setScenario(next);
  });
  $('chaos').addEventListener('click', () => setScenario(randomScenario()));
  $('copy-link').addEventListener('click', copyLink);
  $('download-scenario').addEventListener('click', () => download(`outage-lab-${encodeScenario(state.scenario)}.json`, toJSON(state.scenario, matchPreset(state.scenario) || 'custom')));
  $('upload-scenario').addEventListener('change', uploadScenario);
  $('run-journey').addEventListener('click', runJourney);
  $('flush-queue').addEventListener('click', flushQueue);
  $('export-device').addEventListener('click', exportDevice);
  window.addEventListener('hashchange', loadFromHash);

  if (!loadFromHash()) setScenario(state.scenario);
  renderAll();
  registerServiceWorker();
}

function renderAll() {
  renderStaticText();
  renderBoard();
  renderResults();
  renderGraphSection();
  renderJourney();
  renderQueueStatus();
}

boot().catch((error) => {
  document.body.prepend(h('p', { role: 'alert', style: 'padding:1rem;background:#b3261e;color:#fff' }, `Outage Lab failed to start: ${error.message}`));
});
