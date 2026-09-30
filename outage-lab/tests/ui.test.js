// Loads the real index.html and ui/app.js in jsdom and drives the page like a user.
// This checks wiring and rendering. It does not replace a check in real browsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

function installGlobals(win) {
  const names = ['window', 'document', 'location', 'history', 'navigator', 'localStorage', 'Node', 'HTMLElement', 'Event', 'HashChangeEvent'];
  for (const name of names) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? win : win[name], configurable: true, writable: true });
  }
}

async function waitFor(check, label, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = check();
      if (v) return v;
    } catch {
      // not ready yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const preset = (doc, name) => [...doc.querySelectorAll('.preset')].find((b) => b.textContent === name);
const pills = (doc, col) => [...doc.querySelectorAll(`#feature-table tbody td:nth-of-type(${col}) .pill`)].map((p) => p.textContent);

test('page boots from a share link and responds to the controls', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost/#s=v1-d.u.u.u.u.u.u-11', pretendToBeVisual: true });
  installGlobals(dom.window);
  localStorage.setItem('outage-lab:lang', 'en');
  await import('../web/ui/app.js');
  const doc = dom.window.document;

  await waitFor(() => doc.querySelectorAll('#feature-table tbody tr').length === 8, 'feature table');
  assert.equal(doc.getElementById('scenario-name').textContent, 'Airplane mode');
  assert.deepEqual(pills(doc, 1), Array(8).fill('Broken'));
  assert.deepEqual(pills(doc, 2), ['Limited', 'Limited', 'Limited', 'Limited', 'Works', 'Limited', 'Limited', 'Works']);
  assert.equal(doc.querySelector('.score.resilient .num').textContent, '63');
  assert.ok(doc.querySelectorAll('#graph svg path.edge.fail').length > 0);
  assert.match(doc.getElementById('storage-status').textContent, /memory/);

  // Preset button updates the table and the share link.
  preset(doc, 'Everything works').click();
  assert.equal(dom.window.location.hash, '#s=v1-u.u.u.u.u.u.u-11');
  assert.deepEqual(pills(doc, 1), Array(8).fill('Works'));
  assert.equal(preset(doc, 'Everything works').getAttribute('aria-pressed'), 'true');

  // Rocker switch: email down breaks the fragile checkout only.
  const emailDown = doc.querySelector('input[name="dep-email"][value="down"]');
  emailDown.checked = true;
  emailDown.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const rows = [...doc.querySelectorAll('#feature-table tbody tr')];
  const checkout = rows.find((r) => r.querySelector('th').textContent === 'Checkout and pay');
  assert.equal(checkout.querySelectorAll('.pill')[0].textContent, 'Broken');
  assert.equal(checkout.querySelectorAll('.pill')[1].textContent, 'Works');
  assert.equal(doc.getElementById('scenario-name').textContent, 'Email service down');

  // Slow state reveals a latency slider.
  const slow = doc.querySelector('input[name="dep-cdn"][value="slow"]');
  slow.checked = true;
  slow.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(doc.getElementById('lat-cdn'));
  assert.equal(doc.getElementById('scenario-name').textContent, 'Custom scenario');

  // Device context checkbox.
  const cache = doc.getElementById('ctx-cacheWarm');
  cache.checked = false;
  cache.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match(dom.window.location.hash, /-01$/);

  // Language toggle.
  doc.getElementById('lang-toggle').click();
  assert.equal(doc.documentElement.lang, 'as');
  assert.equal(doc.getElementById('results-title').textContent, 'এতিয়াও কি চলে');
  assert.equal(localStorage.getItem('outage-lab:lang'), 'as');
  doc.getElementById('lang-toggle').click();
  assert.equal(doc.documentElement.lang, 'en');

  // Hash navigation loads a scenario.
  dom.window.location.hash = '#s=v1-u.u.u.d.u.u.u-11';
  dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
  await waitFor(() => doc.getElementById('scenario-name').textContent === 'Login provider down', 'hash scenario');

  // Run the real journey for both apps.
  preset(doc, 'Backend down').click();
  doc.getElementById('run-journey').click();
  assert.equal(doc.getElementById('run-journey').disabled, true);
  await waitFor(() => !doc.getElementById('run-journey').disabled, 'journey to finish');
  const results = [...doc.querySelectorAll('.journey-col')].map((col) => [...col.querySelectorAll('.pill')].map((p) => p.textContent));
  assert.deepEqual(results[0], ['Works', 'Broken', 'Works', 'Broken', 'Broken', 'Broken', 'Works', 'Broken']);
  assert.deepEqual(results[1], ['Works', 'Limited', 'Works', 'Limited', 'Works', 'Limited', 'Works', 'Works']);
  await waitFor(() => /1 item/.test(doc.getElementById('queue-status').textContent), 'queue count');

  dom.window.close();
});
