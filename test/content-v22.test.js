'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CONTENT_PATH = path.resolve(__dirname, '../chrome-extension/content.js');
const CONTENT_SOURCE = fs.readFileSync(CONTENT_PATH, 'utf8');

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(
      Object.entries(initial).map(([key, value]) => [key, String(value)]),
    );
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }

  json(key) {
    const value = this.getItem(key);
    return value === null ? null : JSON.parse(value);
  }
}

class Scheduler {
  constructor(clock) {
    this.clock = clock;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(fn, delay = 0) {
    return this.add(fn, delay, 0);
  }

  setInterval(fn, delay = 0) {
    const interval = Math.max(1, Number(delay) || 0);
    return this.add(fn, interval, interval);
  }

  add(fn, delay, interval) {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      fn,
      due: this.clock.now + Math.max(0, Number(delay) || 0),
      interval,
    });
    return id;
  }

  clear(id) {
    this.tasks.delete(id);
  }

  advance(ms) {
    const target = this.clock.now + ms;
    let executions = 0;

    while (true) {
      let next = null;
      for (const task of this.tasks.values()) {
        if (task.due <= target && (!next || task.due < next.due ||
          (task.due === next.due && task.id < next.id))) {
          next = task;
        }
      }
      if (!next) break;
      if (++executions > 10000) throw new Error('scheduler runaway');

      this.clock.now = next.due;
      if (next.interval) next.due += next.interval;
      else this.tasks.delete(next.id);
      next.fn();
    }

    this.clock.now = target;
  }

  timeoutDelays() {
    return [...this.tasks.values()]
      .filter((task) => task.interval === 0)
      .map((task) => task.due - this.clock.now);
  }
}

function makeElement(tagName = 'div', attributes = {}) {
  let innerHTML = '';
  const element = {
    tagName: tagName.toUpperCase(),
    id: attributes.id || '',
    style: {},
    value: attributes.value || '',
    checked: attributes.checked !== false,
    textContent: attributes.textContent || '',
    attributes: { ...attributes },
    appendChild() {},
    click() {},
    closest() { return null; },
    querySelector() { return null; },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 20, left: 0, top: 0 };
    },
  };

  Object.defineProperty(element, 'innerHTML', {
    configurable: true,
    get() { return innerHTML; },
    set(value) { innerHTML = String(value); },
  });
  return element;
}

function materializeIds(html, elements) {
  const tagWithId = /<([a-z0-9]+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/gi;
  for (const match of html.matchAll(tagWithId)) {
    const attributesText = `${match[2]} ${match[4]}`;
    const valueMatch = attributesText.match(/\bvalue="([^"]*)"/i);
    const element = makeElement(match[1], {
      id: match[3],
      value: valueMatch ? valueMatch[1] : '',
      checked: /\bchecked\b/i.test(attributesText),
    });
    elements.set(match[3], element);
  }
}

function createHarness({
  now,
  url,
  storage,
  sessionStorage,
  slots = [],
  calendarElements = [],
  actionLog,
}) {
  const clock = { now };
  const scheduler = new Scheduler(clock);
  const elements = new Map();
  const events = new Map();
  const log = actionLog || {
    slotClicks: [],
    reloads: 0,
    navigations: [],
    extensionEvents: [],
    console: [],
  };
  if (!log.calendarClicks) log.calendarClicks = [];
  if (!log.confirmPopupCalls) log.confirmPopupCalls = [];
  const popupElements = [];

  const slotElements = slots.map((slot, index) => {
    const href = slot.href ||
      `javascript:confirmPopup('${slot.date}','${slot.id || `slot-${index}`}','${slot.time || '1030'}','PZC','${slot.course || 'T-OUT'}','','','','')`;
    const element = makeElement('a', { href, textContent: '예약' });
    element.click = () => {
      log.slotClicks.push({ href, at: clock.now });
      if (slot.callsConfirmPopup) {
        window.confirmPopup(
          slot.date,
          slot.id || `slot-${index}`,
          slot.time || '1030',
          'PZC',
          slot.course || 'T-OUT',
        );
      }
      if (slot.popupAppearsAfter !== undefined) {
        scheduler.setTimeout(() => popupElements.push(makeElement('div')), slot.popupAppearsAfter);
      }
    };
    return element;
  });

  const calendarElementList = calendarElements.map((fixture, index) => {
    const {
      tagName = 'a',
      textContent = '',
      ...attributes
    } = fixture;
    const element = makeElement(tagName, { ...attributes, textContent });
    element.click = () => log.calendarClicks.push({ index, at: clock.now });
    return element;
  });

  const body = makeElement('body');
  body.appendChild = (element) => {
    if (element.id) elements.set(element.id, element);
  };

  const document = {
    hidden: false,
    body,
    onmousemove: null,
    onmouseup: null,
    createElement(tagName) {
      const element = makeElement(tagName);
      const ownDescriptor = Object.getOwnPropertyDescriptor(element, 'innerHTML');
      Object.defineProperty(element, 'innerHTML', {
        get: ownDescriptor.get,
        set(value) {
          ownDescriptor.set.call(element, value);
          materializeIds(String(value), elements);
        },
      });
      return element;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(selector) {
      if (selector === 'a[href*="confirmPopup"]') return slotElements[0] || null;
      if (selector === 'img[alt*="일자 선택"]') {
        return calendarElementList.find((element) =>
          element.tagName === 'IMG' && String(element.getAttribute('alt') || '').includes('일자 선택')) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'a[href*="confirmPopup"]') return slotElements;
      if (selector === '.modal') return popupElements;
      if (selector === 'a, button, [role="button"], input[type="button"], input[type="image"], img[alt*="일자 선택"]') {
        return calendarElementList;
      }
      return [];
    },
    addEventListener(type, listener) {
      const listeners = events.get(type) || [];
      listeners.push(listener);
      events.set(type, listeners);
    },
  };

  let currentHref = url;
  const location = {
    get href() { return currentHref; },
    set href(value) {
      currentHref = String(value);
      log.navigations.push(currentHref);
    },
    reload() { log.reloads += 1; },
  };

  const windowEvents = new Map();
  const window = {
    location,
    open() {},
    confirm() { return true; },
    confirmPopup(...args) {
      log.confirmPopupCalls.push({ args, at: clock.now });
    },
    addEventListener(type, listener) {
      const listeners = windowEvents.get(type) || [];
      listeners.push(listener);
      windowEvents.set(type, listeners);
    },
    dispatchEvent(event) {
      log.extensionEvents.push(event);
      for (const listener of windowEvents.get(event.type) || []) listener(event);
      return true;
    },
  };
  window.window = window;

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock.now]));
    }

    static now() {
      return clock.now;
    }
  }

  class FakeXMLHttpRequest {
    open() {}
    send() {}
    abort() {}
    getResponseHeader() { return null; }
  }

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const quietConsole = {};
  for (const method of ['log', 'info', 'warn', 'error']) {
    quietConsole[method] = (...args) => log.console.push({ method, args });
  }

  const sandbox = {
    window,
    document,
    localStorage: storage,
    XMLHttpRequest: FakeXMLHttpRequest,
    CustomEvent: FakeCustomEvent,
    Date: FakeDate,
    performance: { now: () => clock.now - now },
    setTimeout: scheduler.setTimeout.bind(scheduler),
    clearTimeout: scheduler.clear.bind(scheduler),
    setInterval: scheduler.setInterval.bind(scheduler),
    clearInterval: scheduler.clear.bind(scheduler),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    console: quietConsole,
    Math,
    JSON,
  };
  if (sessionStorage) sandbox.sessionStorage = sessionStorage;

  vm.runInNewContext(CONTENT_SOURCE, sandbox, { filename: CONTENT_PATH });

  return { clock, scheduler, storage, log, location, document };
}

function autoJob(overrides = {}) {
  return {
    active: true,
    runId: 'run-regression',
    mode: 'auto10',
    phase: 'armed',
    dates: ['13'],
    idx: 0,
    autoClick: true,
    auto10started: false,
    triggerH: 10,
    triggerM: 0,
    settings: {
      timeFrom: '10',
      timeTo: '14',
      targetDates: '13',
      autoRefresh: true,
    },
    retryCount: 0,
    dateRetryStartedAt: 0,
    ...overrides,
  };
}

function storageWithJob(job) {
  return new MemoryStorage({ 'plazacc-job': JSON.stringify(job) });
}

test('09:59 persisted armed job survives repeated timetable reloads without clicking a matching slot', () => {
  const now = new Date(2026, 6, 13, 9, 59, 0, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({ targetAt, expiresAt: targetAt + 30 * 60 * 1000 }));
  const log = {
    slotClicks: [], reloads: 0, navigations: [], extensionEvents: [], console: [],
  };
  const fixture = {
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260713',
    storage,
    slots: [{ date: '20260713', time: '1030', course: 'T-OUT' }],
    actionLog: log,
  };

  createHarness(fixture);
  createHarness(fixture);

  const job = storage.json('plazacc-job');
  assert.equal(log.slotClicks.length, 0);
  assert.equal(job.active, true);
  assert.equal(job.phase, 'armed');
  assert.equal(job.auto10started, false);
  assert.equal(job.targetAt, targetAt);
  assert.equal(job.retryCount, 0);
  assert.equal(job.reserving, undefined);
});

test('triggered job blocks a slot from the wrong date, requests calendar navigation, then watchdog uses the direct URL fallback', () => {
  const now = new Date(2026, 6, 13, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    triggeredAt: now - 1000,
  }));

  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260712',
    storage,
    slots: [{ date: '20260712', time: '1030', course: 'T-OUT' }],
  });

  assert.equal(harness.log.slotClicks.length, 0);
  assert.deepEqual(storage.json('plazacc-cmd'), {
    refreshAndClick: '13',
    runId: 'run-regression',
    requestedAt: now,
    source: 'date-mismatch',
  });
  assert.equal(storage.json('plazacc-job').phase, 'navigating');

  harness.scheduler.advance(450);

  assert.equal(harness.log.slotClicks.length, 0);
  assert.equal(harness.log.navigations.length, 1);
  assert.match(harness.location.href, /targetDate=20260713/);
  assert.equal(storage.json('plazacc-job').navigationDay, '13');
  assert.equal(storage.json('plazacc-job').navigationFallbackAt, now + 450);
});

test('serviceS01 with zero confirmPopup links initializes and keeps the triggered job alive for retry', () => {
  const now = new Date(2026, 6, 13, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    triggeredAt: now - 1000,
  }));

  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260713',
    storage,
    slots: [],
  });

  const jobAfterScan = storage.json('plazacc-job');
  assert.equal(harness.document.getElementById('plazacc-macro-panel') !== null, true);
  assert.equal(jobAfterScan.active, true);
  assert.equal(jobAfterScan.phase, 'scanning');
  assert.equal(jobAfterScan.retryCount, 1);
  assert.equal(jobAfterScan.dateRetryStartedAt, now);
  assert.ok(harness.scheduler.timeoutDelays().includes(750));
  assert.equal(harness.log.slotClicks.length, 0);

  harness.scheduler.advance(750);

  assert.equal(harness.log.reloads, 1);
  assert.equal(storage.json('plazacc-job').active, true);
});

test('an expired triggered job is removed before it can click a stale slot', () => {
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const now = targetAt + 31 * 60 * 1000;
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
  }));
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260713',
    storage,
    slots: [{ date: '20260713', time: '1030', course: 'T-OUT' }],
  });

  assert.equal(harness.log.slotClicks.length, 0);
  assert.equal(storage.getItem('plazacc-job'), null);
});

test('a confirmPopup call from the slot click is not repeated when the popup signal appears after the 250ms probe', () => {
  const now = new Date(2026, 6, 13, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    triggeredAt: now - 1000,
  }));
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260713',
    storage,
    slots: [{
      date: '20260713',
      id: 'delayed-popup-slot',
      time: '1030',
      course: 'T-OUT',
      callsConfirmPopup: true,
      // The first 250ms popup probe sees nothing. The DOM signal arrives later.
      popupAppearsAfter: 300,
    }],
  });

  assert.equal(harness.log.slotClicks.length, 1);
  assert.equal(harness.log.confirmPopupCalls.length, 1);

  harness.scheduler.advance(250);

  assert.equal(harness.log.confirmPopupCalls.length, 1);
  assert.equal(storage.json('plazacc-job').phase, 'reserving');
  assert.equal(
    harness.log.console.some(({ args }) => String(args[0]).includes('직접 호출 1회')),
    false,
  );

  harness.scheduler.advance(1000);

  assert.equal(harness.log.confirmPopupCalls.length, 1);
  assert.equal(storage.getItem('plazacc-job'), null);
});

test('separate tab session jobs stay isolated while the shared recent clickKey blocks a duplicate slot click', () => {
  const now = new Date(2026, 6, 13, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const localStorage = new MemoryStorage();
  const tabOneStorage = storageWithJob(autoJob({
    runId: 'run-tab-one',
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
  }));
  const tabTwoStorage = storageWithJob(autoJob({
    runId: 'run-tab-two',
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
  }));
  const log = {
    slotClicks: [],
    calendarClicks: [],
    confirmPopupCalls: [],
    reloads: 0,
    navigations: [],
    extensionEvents: [],
    console: [],
  };
  const fixture = {
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260713',
    storage: localStorage,
    slots: [{ date: '20260713', id: 'same-slot', time: '1030', course: 'T-OUT' }],
    actionLog: log,
  };

  createHarness({ ...fixture, sessionStorage: tabOneStorage });
  createHarness({ ...fixture, sessionStorage: tabTwoStorage });

  assert.equal(log.slotClicks.length, 1);
  assert.equal(tabOneStorage.json('plazacc-job').phase, 'reserving');
  assert.equal(tabTwoStorage.json('plazacc-job').phase, 'scanning');
  assert.equal(tabTwoStorage.json('plazacc-job').reserving, undefined);
  assert.equal(localStorage.getItem('plazacc-job'), null);
  assert.deepEqual(localStorage.json('plazacc-last-click'), {
    clickKey: '20260713|same-slot|1030',
    at: now,
    runId: 'run-tab-one',
  });
});

test('serviceF02 clickAfterReload accepts deployed date-link variants and stores a dateClicked acknowledgement', async (t) => {
  const now = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const variants = [
    {
      name: 'href #none; with day text',
      element: { tagName: 'a', href: '#none;', textContent: '13' },
    },
    {
      name: 'onclick containing the full date',
      element: { tagName: 'a', href: 'javascript:;', onclick: "selectDate('20260713')" },
    },
    {
      name: 'date-selection image alt text',
      element: { tagName: 'img', alt: '13일자 선택' },
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, () => {
      const storage = new MemoryStorage({
        'plazacc-cmd': JSON.stringify({
          clickAfterReload: '13',
          clickAfterReloadStart: now - 50,
          runId: 'run-calendar-regression',
          attempt: 0,
        }),
      });
      const harness = createHarness({
        now,
        url: 'https://booking.hanwharesort.co.kr/serviceF02.do',
        storage,
        calendarElements: [variant.element],
      });

      harness.scheduler.advance(100);

      assert.equal(harness.log.calendarClicks.length, 1);
      assert.deepEqual(storage.json('plazacc-cmd'), {
        dateClicked: '13',
        runId: 'run-calendar-regression',
        clickedAt: now + 100,
      });
    });
  }
});

test('a two-month calendar clicks only the day belonging to the configured target month', () => {
  const now = new Date(2026, 4, 11, 10, 0, 0, 0).getTime();
  const job = autoJob({
    phase: 'navigating',
    auto10started: true,
    dates: ['6'],
    targetYm: '202606',
  });
  const storage = new MemoryStorage({
    'plazacc-job': JSON.stringify(job),
    'plazacc-cmd': JSON.stringify({
      clickAfterReload: '6',
      clickAfterReloadStart: now - 50,
      runId: job.runId,
    }),
  });
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceF02.do',
    storage,
    calendarElements: [
      { tagName: 'a', href: 'javascript:;', onclick: "selectDate('20260506')" },
      { tagName: 'a', href: 'javascript:;', onclick: "selectDate('20260606')" },
    ],
  });

  harness.scheduler.advance(100);

  assert.equal(harness.log.calendarClicks.length, 1);
  assert.equal(harness.log.calendarClicks[0].index, 1);
  assert.equal(storage.json('plazacc-cmd').dateClicked, '6');
});
