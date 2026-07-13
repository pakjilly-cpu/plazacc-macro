'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../chrome-extension/background.js'), 'utf8');

function eventHook() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); } };
}

function createHarness() {
  const data = {};
  const alarms = new Map();
  const onMessage = eventHook();
  const chrome = {
    storage: { local: {
      get(key, cb) { setImmediate(() => cb({ [key]: data[key] })); },
      set(update, cb) {
        setImmediate(() => { Object.assign(data, JSON.parse(JSON.stringify(update))); if (cb) cb(); });
      },
    } },
    alarms: {
      create(name, info) { alarms.set(name, info); },
      clear(name) { alarms.delete(name); },
      onAlarm: eventHook(),
    },
    runtime: {
      lastError: null,
      onMessage,
      onStartup: eventHook(),
      onInstalled: eventHook(),
    },
    tabs: {
      sendMessage() {},
      reload() {},
    },
  };
  vm.runInNewContext(SOURCE, { chrome, console, Promise, Date, Math, JSON, setTimeout, clearTimeout });

  function send(type, runId = 'run-race') {
    const targetAt = Date.now() + 60_000;
    const msg = {
      source: 'plazacc-main',
      type,
      data: { runId, targetAt, expiresAt: targetAt + 30 * 60_000 },
    };
    return new Promise((resolve, reject) => {
      const listener = onMessage.listeners[0];
      const timeout = setTimeout(() => reject(new Error(`response timeout: ${type}`)), 1000);
      listener(msg, { tab: { id: 7 }, frameId: 12 }, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  return { data, alarms, send };
}

test('schedule and fired messages are serialized so trigger alarms cannot resurrect', async () => {
  for (const order of [
    ['SCHEDULE_AUTO10', 'SCHEDULE_FIRED'],
    ['SCHEDULE_FIRED', 'SCHEDULE_AUTO10'],
  ]) {
    const harness = createHarness();
    await Promise.all(order.map((type) => harness.send(type)));

    const schedules = harness.data['plazacc-auto-schedules'];
    assert.ok(schedules['run-race'].firedAt, `missing firedAt for ${order.join(' -> ')}`);
    assert.equal([...harness.alarms.keys()].some((name) => name.includes(':trigger:')), false);
    assert.equal([...harness.alarms.keys()].some((name) => name.includes(':prep:')), false);
    assert.equal([...harness.alarms.keys()].some((name) => name.includes(':recovery:')), true);
  }
});

test('cancel queued behind schedule removes stored state and every alarm', async () => {
  const harness = createHarness();
  await Promise.all([
    harness.send('SCHEDULE_AUTO10', 'run-cancel'),
    harness.send('CANCEL_SCHEDULE', 'run-cancel'),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const schedules = harness.data['plazacc-auto-schedules'] || {};
  assert.equal(schedules['run-cancel'], undefined);
  assert.equal([...harness.alarms.keys()].some((name) => name.endsWith(':run-cancel')), false);
});
