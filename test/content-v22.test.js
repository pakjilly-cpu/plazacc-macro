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
  confirmResult = true,
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
    confirm() { return confirmResult; },
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

  return { clock, scheduler, storage, sessionStorage, log, location, document, window };
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
    ...overrides,
  };
}

function storageWithJob(job) {
  return new MemoryStorage({ 'plazacc-job': JSON.stringify(job) });
}

function setForm(harness, { dates = '5', from = '10', to = '14' } = {}) {
  harness.document.getElementById('m-dates').value = dates;
  harness.document.getElementById('m-from').value = from;
  harness.document.getElementById('m-to').value = to;
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
  assert.ok(harness.scheduler.timeoutDelays().includes(750));
  assert.equal(harness.log.slotClicks.length, 0);

  harness.scheduler.advance(750);

  assert.equal(harness.log.reloads, 1);
  assert.equal(storage.json('plazacc-job').active, true);
});

test('auto10 checks every course and date three times in course-first order', () => {
  const now = new Date(2026, 6, 13, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 6, 13, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    triggeredAt: now - 1000,
    dates: ['11', '13'],
    targetYm: '202608',
  }));

  const courses = ['T-OUT', 'T-IN', 'L-OUT', 'L-IN'];
  const dates = ['11', '13'];
  let tick = 0;
  let finalHarness;

  for (let courseIdx = 0; courseIdx < courses.length; courseIdx += 1) {
    for (let dateIdx = 0; dateIdx < dates.length; dateIdx += 1) {
      for (let check = 1; check <= 3; check += 1) {
        tick += 1;
        finalHarness = createHarness({
          now: now + tick,
          url: `https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=202608${dates[dateIdx]}`,
          storage,
          slots: [],
        });
        const job = storage.json('plazacc-job');
        if (courseIdx === courses.length - 1 && dateIdx === dates.length - 1 && check === 3) {
          assert.equal(job, null);
          continue;
        }
        assert.equal(job.active, true);
        if (check < 3) {
          assert.equal(job.courseIdx, courseIdx);
          assert.equal(job.idx, dateIdx);
          assert.equal(job.retryCount, check);
        } else {
          const expectedDateIdx = dateIdx === dates.length - 1 ? 0 : dateIdx + 1;
          const expectedCourseIdx = dateIdx === dates.length - 1 ? courseIdx + 1 : courseIdx;
          assert.equal(job.courseIdx, expectedCourseIdx);
          assert.equal(job.idx, expectedDateIdx);
          assert.equal(job.retryCount, 0);
          assert.equal(storage.json('plazacc-cmd').refreshAndClick, dates[expectedDateIdx]);
        }
      }
    }
  }

  assert.equal(storage.getItem('plazacc-job'), null);
  assert.match(
    finalHarness.document.getElementById('m-status').innerHTML,
    /각 코스\/날짜 조합 총 3회 확인 완료/,
  );
});

test('auto10 prefers a later-date higher-priority course over an earlier-date lower-priority course', () => {
  const now = new Date(2026, 7, 8, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 7, 8, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    dates: ['8', '12'],
    targetYm: '202608',
  }));

  for (let check = 1; check <= 3; check += 1) {
    const harness = createHarness({
      now: now + check,
      url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260808',
      storage,
      slots: [{ date: '20260808', id: 't-in-early-date', time: '1030', course: 'T-IN' }],
    });
    assert.equal(harness.log.slotClicks.length, 0);
  }

  const jobAfterFirstDate = storage.json('plazacc-job');
  assert.equal(jobAfterFirstDate.courseIdx, 0);
  assert.equal(jobAfterFirstDate.idx, 1);

  const higherPriorityHarness = createHarness({
    now: now + 4,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260812',
    storage,
    slots: [{ date: '20260812', id: 't-out-later-date', time: '1100', course: 'T-OUT' }],
  });

  assert.equal(higherPriorityHarness.log.slotClicks.length, 1);
  assert.match(higherPriorityHarness.log.slotClicks[0].href, /t-out-later-date/);
  assert.equal(storage.json('plazacc-job').courseIdx, 0);
  assert.equal(storage.json('plazacc-job').phase, 'reserving');
});

test('auto10 moves to Tiger IN after Tiger OUT is exhausted for every target date', () => {
  const now = new Date(2026, 7, 8, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 7, 8, 10, 0, 0, 0).getTime();
  const storage = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    dates: ['8', '12'],
    targetYm: '202608',
  }));
  let tick = 0;

  for (const day of ['08', '12']) {
    for (let check = 1; check <= 3; check += 1) {
      tick += 1;
      createHarness({
        now: now + tick,
        url: `https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=202608${day}`,
        storage,
        slots: [],
      });
    }
  }

  const tigerInJob = storage.json('plazacc-job');
  assert.equal(tigerInJob.courseIdx, 1);
  assert.equal(tigerInJob.idx, 0);
  assert.equal(storage.json('plazacc-cmd').refreshAndClick, '8');

  const tigerInHarness = createHarness({
    now: now + tick + 1,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260808',
    storage,
    slots: [{ date: '20260808', id: 't-in-after-out', time: '1030', course: 'T-IN' }],
  });

  assert.equal(tigerInHarness.log.slotClicks.length, 1);
  assert.match(tigerInHarness.log.slotClicks[0].href, /t-in-after-out/);
  assert.equal(storage.json('plazacc-job').courseIdx, 1);
  assert.equal(storage.json('plazacc-job').phase, 'reserving');
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

test('scan button filters the selected time range and keeps course priority ordering', () => {
  const now = new Date(2026, 5, 1, 9, 50, 0, 0).getTime();
  const storage = new MemoryStorage();
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage,
    slots: [
      { date: '20260605', id: 'early-outside', time: '0950', course: 'T-OUT' },
      { date: '20260605', id: 't-in', time: '1030', course: 'T-IN' },
      { date: '20260605', id: 't-out', time: '1100', course: 'T-OUT' },
    ],
  });
  setForm(harness, { from: '10', to: '12' });

  harness.document.getElementById('m-scan').onclick();

  const status = harness.document.getElementById('m-status').innerHTML;
  assert.match(status, /전체: 3개/);
  assert.match(status, /매칭: <b[^>]*>2개/);
  assert.ok(status.indexOf('11:00 타이거OUT') < status.indexOf('10:30 타이거IN'));
  assert.equal(harness.log.slotClicks.length, 0);
  assert.equal(storage.json('plazacc-s').timeFrom, '10');
  assert.equal(storage.getItem('plazacc-job'), null);
});

test('all action buttons reject reversed time ranges and impossible month dates', () => {
  const now = new Date(2026, 5, 1, 9, 50, 0, 0).getTime();
  for (const buttonId of ['m-scan', 'm-auto10', 'm-test', 'm-cancel']) {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    const harness = createHarness({
      now,
      url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
      storage,
      sessionStorage: session,
      slots: [],
    });
    setForm(harness, { dates: '5', from: '14', to: '10' });
    harness.document.getElementById(buttonId).onclick();
    assert.match(harness.document.getElementById('m-status').innerHTML, /시간 범위를 확인/);
    assert.equal(session.getItem('plazacc-job'), null);
  }

  for (const buttonId of ['m-auto10', 'm-test', 'm-cancel']) {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    const harness = createHarness({
      now,
      url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
      storage,
      sessionStorage: session,
    });
    setForm(harness, { dates: '31', from: '10', to: '14' });
    harness.document.getElementById(buttonId).onclick();
    assert.match(harness.document.getElementById('m-status').innerHTML, /6월에 존재하는 날짜.*1~30일/);
    assert.equal(session.getItem('plazacc-job'), null);
  }
});

test('one-minute test arms the same persistent scheduler and stop cancels every pending action', () => {
  const now = new Date(2026, 5, 1, 9, 58, 30, 0).getTime();
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: local,
    sessionStorage: session,
  });
  setForm(harness, { dates: '5', from: '10', to: '14' });

  harness.document.getElementById('m-test').onclick();

  const job = session.json('plazacc-job');
  assert.equal(job.active, true);
  assert.equal(job.mode, 'auto10');
  assert.equal(job.phase, 'armed');
  assert.equal(job.targetYm, '202606');
  assert.equal(job.triggerH, 9);
  assert.equal(job.triggerM, 59);
  assert.equal(job.targetAt, new Date(2026, 5, 1, 9, 59, 0, 0).getTime());
  assert.equal(harness.document.getElementById('m-stop').style.display, 'block');
  assert.equal(harness.document.getElementById('m-test').style.display, 'none');
  assert.equal(harness.log.extensionEvents.some((event) => JSON.parse(event.detail).type === 'SCHEDULE_AUTO10'), true);

  harness.document.getElementById('m-stop').onclick();
  harness.scheduler.advance(90_000);

  assert.equal(session.getItem('plazacc-job'), null);
  assert.equal(session.getItem('plazacc-cmd'), null);
  assert.equal(harness.log.reloads, 0);
  assert.equal(harness.log.slotClicks.length, 0);
  assert.equal(harness.document.getElementById('m-status').innerHTML, '중지됨');
  assert.equal(harness.log.extensionEvents.some((event) => JSON.parse(event.detail).type === 'CANCEL_SCHEDULE'), true);
});

test('one-minute test schedules midnight on the following date', () => {
  const now = new Date(2026, 5, 1, 23, 59, 30, 0).getTime();
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: local,
    sessionStorage: session,
  });
  setForm(harness, { dates: '5' });
  harness.document.getElementById('m-test').onclick();

  const job = session.json('plazacc-job');
  assert.equal(job.triggerH, 0);
  assert.equal(job.triggerM, 0);
  assert.equal(job.targetAt, new Date(2026, 5, 2, 0, 0, 0, 0).getTime());
});

test('cancel-watch stop prevents both initial and repeating reload timers', () => {
  const now = new Date(2026, 5, 1, 12, 0, 0, 0).getTime();
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: local,
    sessionStorage: session,
  });
  setForm(harness, { dates: '5' });
  harness.document.getElementById('m-cancel').onclick();
  assert.equal(session.json('plazacc-job').mode, 'cancel');
  harness.document.getElementById('m-stop').onclick();
  harness.scheduler.advance(4_000);
  assert.equal(harness.log.reloads, 0);
  assert.equal(session.getItem('plazacc-job'), null);

  const loopSession = storageWithJob({
    ...autoJob(),
    runId: 'cancel-loop',
    mode: 'cancel',
    phase: 'scanning',
    auto10started: false,
    dates: ['5'],
    targetYm: '202606',
    idx: 0,
  });
  const loopHarness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: new MemoryStorage(),
    sessionStorage: loopSession,
    slots: [],
  });
  loopHarness.document.getElementById('m-stop').onclick();
  loopHarness.scheduler.advance(4_000);
  assert.equal(loopHarness.log.reloads, 0);
  assert.equal(loopSession.getItem('plazacc-job'), null);
});

test('cancel-watch cycles across multiple target dates without losing its job', () => {
  const now = new Date(2026, 5, 1, 12, 0, 0, 0).getTime();
  const session = storageWithJob({
    ...autoJob(),
    runId: 'cancel-cycle',
    mode: 'cancel',
    phase: 'scanning',
    auto10started: false,
    dates: ['5', '6'],
    targetYm: '202606',
    idx: 0,
  });
  createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: new MemoryStorage(),
    sessionStorage: session,
    slots: [],
  });
  assert.equal(session.json('plazacc-job').idx, 1);
  assert.equal(session.json('plazacc-cmd').refreshAndClick, '6');

  createHarness({
    now: now + 200,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260606',
    storage: new MemoryStorage(),
    sessionStorage: session,
    slots: [],
  });
  assert.equal(session.json('plazacc-job').idx, 0);
  assert.equal(session.json('plazacc-cmd').refreshAndClick, '5');
  assert.equal(session.json('plazacc-job').active, true);
});

test('stop during a reservation attempt cancels the delayed direct-call fallback', () => {
  const now = new Date(2026, 5, 1, 10, 0, 1, 0).getTime();
  const targetAt = new Date(2026, 5, 1, 10, 0, 0, 0).getTime();
  const session = storageWithJob(autoJob({
    phase: 'triggered',
    auto10started: true,
    targetAt,
    expiresAt: targetAt + 30 * 60 * 1000,
    dates: ['5'],
    targetYm: '202606',
  }));
  const harness = createHarness({
    now,
    url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
    storage: new MemoryStorage(),
    sessionStorage: session,
    slots: [{ date: '20260605', id: 'no-handler', time: '1030', course: 'T-OUT' }],
  });

  assert.equal(harness.log.slotClicks.length, 1);
  assert.equal(harness.document.getElementById('m-scan').style.display, 'none');
  assert.equal(harness.document.getElementById('m-stop').style.display, 'block');
  harness.document.getElementById('m-stop').onclick();
  harness.scheduler.advance(2_000);

  assert.equal(harness.log.confirmPopupCalls.length, 0);
  assert.equal(session.getItem('plazacc-job'), null);
  assert.equal(
    harness.log.console.some(({ args }) => String(args[0]).includes('후속 호출 취소')),
    true,
  );
});

test('declining confirmation leaves auto, test, and cancel actions unarmed', () => {
  const now = new Date(2026, 5, 1, 9, 50, 0, 0).getTime();
  for (const buttonId of ['m-auto10', 'm-test', 'm-cancel']) {
    const session = new MemoryStorage();
    const harness = createHarness({
      now,
      url: 'https://booking.hanwharesort.co.kr/serviceS01.do?targetDate=20260605',
      storage: new MemoryStorage(),
      sessionStorage: session,
      confirmResult: false,
    });
    setForm(harness, { dates: '5' });
    harness.document.getElementById(buttonId).onclick();
    assert.equal(session.getItem('plazacc-job'), null);
    assert.equal(harness.log.extensionEvents.length, 0);
  }
});
