// ==UserScript==
// @name         플라자CC 예약 매크로
// @namespace    plazacc-macro
// @version      1.0
// @description  플라자CC 골프장 정기예약 자동화 (시간 매칭 + 자동 클릭)
// @match        https://www.plazacc.co.kr/plzcc/irsweb/golf2/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 설정 상수
  // ============================================================
  const STORAGE_KEY = 'plazacc_macro_settings';
  const STATE_KEY = 'plazacc_macro_state';
  const REFRESH_INTERVAL_MS = 400;   // 새로고침 간격 (ms)
  const MAX_REFRESH_COUNT = 50;      // 최대 새로고침 횟수
  const TARGET_HOUR = 10;            // 예약 오픈 시각 (시)
  const TARGET_MINUTE = 0;           // 예약 오픈 시각 (분)

  // ============================================================
  // 기본 설정
  // ============================================================
  const DEFAULT_SETTINGS = {
    timeFrom: '10:00',
    timeTo: '13:00',
    coursePreference: 'both', // 'out', 'in', 'both'
    coursePriority: 'out-first', // 'out-first', 'in-first'
  };

  // ============================================================
  // 설정 저장/로드
  // ============================================================
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function clearState() {
    localStorage.removeItem(STATE_KEY);
  }

  // ============================================================
  // 시간 파싱 유틸
  // ============================================================
  function timeToMinutes(timeStr) {
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!match) return -1;
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }

  function isTimeInRange(teeTime, fromTime, toTime) {
    const tee = timeToMinutes(teeTime);
    const from = timeToMinutes(fromTime);
    const to = timeToMinutes(toTime);
    if (tee < 0 || from < 0 || to < 0) return false;
    return tee >= from && tee <= to;
  }

  // ============================================================
  // 알림음 재생
  // ============================================================
  function playAlert() {
    try {
      const AudioCtx = window.AudioContext || window['webkitAudioContext'];
      const ctx = new AudioCtx();
      // 짧은 비프음 3회
      [0, 0.3, 0.6].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.value = 0.3;
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.15);
      });
    } catch {
      // 오디오 사용 불가 시 무시
    }
  }

  // ============================================================
  // DOM 에서 시간표 파싱 (여러 전략으로 시도)
  // ============================================================
  function parseTimeTable() {
    const results = [];

    // 전략 1: 테이블 기반 - "예약" 텍스트가 있는 링크/버튼 탐색
    const allLinks = document.querySelectorAll('a, button, input[type="button"]');
    allLinks.forEach(el => {
      const text = (el.textContent || el.value || '').trim();
      if (text !== '예약') return;

      // 주변에서 시간 텍스트 찾기
      let timeText = null;
      let courseType = null;

      // 같은 행(tr) 또는 부모 요소에서 시간 찾기
      const row = el.closest('tr') || el.closest('div') || el.parentElement;
      if (row) {
        const rowText = row.textContent || '';
        const timeMatch = rowText.match(/(\d{1,2}:\d{2})/);
        if (timeMatch) {
          timeText = timeMatch[1];
        }

        // 코스 구분: 테이블 열 위치로 판단
        const table = el.closest('table');
        if (table && row.tagName === 'TR') {
          const cells = row.querySelectorAll('td, th');
          const cellIndex = Array.from(cells).findIndex(cell => cell.contains(el));
          // 테이블 헤더에서 코스 이름 확인
          const headerRow = table.querySelector('tr');
          if (headerRow) {
            const headers = headerRow.querySelectorAll('td, th');
            for (let i = 0; i < headers.length; i++) {
              const headerText = headers[i].textContent || '';
              if (headerText.includes('OUT') || headerText.includes('타이거')) {
                // OUT 코스 영역의 열 범위 기억
                if (cellIndex <= i + 2) courseType = 'out';
              }
              if (headerText.includes('IN') || headerText.includes('라이온')) {
                if (cellIndex >= i - 1) courseType = 'in';
              }
            }
          }
        }
      }

      // 시간을 못 찾았으면, 인접 요소에서 찾기
      if (!timeText) {
        let sibling = el.previousElementSibling;
        for (let i = 0; i < 5 && sibling; i++) {
          const sibText = (sibling.textContent || '').trim();
          const m = sibText.match(/(\d{1,2}:\d{2})/);
          if (m) { timeText = m[1]; break; }
          sibling = sibling.previousElementSibling;
        }
      }

      // 부모를 거슬러 올라가며 코스 판별
      if (!courseType) {
        let parent = el.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          const pText = (parent.textContent || '').substring(0, 200);
          if (pText.includes('OUT') || pText.includes('타이거')) { courseType = 'out'; break; }
          if (pText.includes('IN') || pText.includes('라이온')) { courseType = 'in'; break; }
          parent = parent.parentElement;
        }
      }

      if (timeText) {
        results.push({
          time: timeText,
          course: courseType || 'unknown',
          element: el,
        });
      }
    });

    // 전략 2: onclick 속성에서 시간 정보 추출
    if (results.length === 0) {
      document.querySelectorAll('[onclick]').forEach(el => {
        const onclick = el.getAttribute('onclick') || '';
        // 예약 관련 함수 호출에서 시간 파라미터 찾기
        const timeMatch = onclick.match(/(\d{1,2}:\d{2})/);
        const text = (el.textContent || '').trim();
        if ((text === '예약' || onclick.includes('reservation') || onclick.includes('rsv')) && timeMatch) {
          let courseType = 'unknown';
          const parent = el.closest('td, div');
          if (parent) {
            const headerText = parent.closest('table')?.querySelector('tr')?.textContent || '';
            if (headerText.includes('OUT')) courseType = 'out';
            if (headerText.includes('IN')) courseType = 'in';
          }
          results.push({
            time: timeMatch[1],
            course: courseType,
            element: el,
          });
        }
      });
    }

    return results;
  }

  // ============================================================
  // 시간 매칭 + 예약 버튼 클릭
  // ============================================================
  function scanAndClick(settings) {
    const slots = parseTimeTable();
    if (slots.length === 0) return { found: false, reason: '시간표를 찾을 수 없습니다' };

    // 시간 범위 필터링
    const matching = slots.filter(s =>
      isTimeInRange(s.time, settings.timeFrom, settings.timeTo)
    );

    if (matching.length === 0) {
      return {
        found: false,
        reason: `${settings.timeFrom}~${settings.timeTo} 범위에 예약 가능한 시간이 없습니다 (전체 ${slots.length}개 슬롯 확인)`,
      };
    }

    // 코스 우선순위에 따라 정렬
    let sorted;
    if (settings.coursePreference === 'out') {
      sorted = matching.filter(s => s.course === 'out' || s.course === 'unknown');
    } else if (settings.coursePreference === 'in') {
      sorted = matching.filter(s => s.course === 'in' || s.course === 'unknown');
    } else {
      // 둘 다 OK - 우선순위에 따라 정렬
      if (settings.coursePriority === 'out-first') {
        sorted = [
          ...matching.filter(s => s.course === 'out'),
          ...matching.filter(s => s.course === 'unknown'),
          ...matching.filter(s => s.course === 'in'),
        ];
      } else {
        sorted = [
          ...matching.filter(s => s.course === 'in'),
          ...matching.filter(s => s.course === 'unknown'),
          ...matching.filter(s => s.course === 'out'),
        ];
      }
    }

    if (sorted.length === 0) {
      return {
        found: false,
        reason: `선호 코스에 예약 가능한 시간이 없습니다 (범위 내 ${matching.length}개 중)`,
      };
    }

    // 첫 번째 매칭 슬롯 클릭
    const target = sorted[0];
    try {
      target.element.click();
      return {
        found: true,
        time: target.time,
        course: target.course,
      };
    } catch (e) {
      return { found: false, reason: `클릭 실패: ${e.message}` };
    }
  }

  // ============================================================
  // UI 패널 생성
  // ============================================================
  function createPanel() {
    const settings = loadSettings();

    const panel = document.createElement('div');
    panel.id = 'plazacc-macro-panel';
    panel.innerHTML = `
      <style>
        #plazacc-macro-panel {
          position: fixed;
          top: 10px;
          right: 10px;
          width: 300px;
          background: #fff;
          border: 3px solid #2d6a4f;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          z-index: 999999;
          font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
          font-size: 14px;
          user-select: none;
        }
        #plazacc-macro-panel * {
          box-sizing: border-box;
        }
        .macro-header {
          background: #2d6a4f;
          color: white;
          padding: 12px 16px;
          border-radius: 9px 9px 0 0;
          font-size: 16px;
          font-weight: bold;
          cursor: move;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .macro-header .minimize-btn {
          background: none;
          border: 2px solid white;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .macro-body {
          padding: 16px;
        }
        .macro-body.hidden {
          display: none;
        }
        .macro-row {
          margin-bottom: 12px;
        }
        .macro-row label {
          display: block;
          font-weight: bold;
          margin-bottom: 4px;
          color: #333;
          font-size: 13px;
        }
        .macro-row .time-inputs {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .macro-row input[type="time"] {
          padding: 8px;
          border: 2px solid #ccc;
          border-radius: 6px;
          font-size: 16px;
          width: 120px;
          text-align: center;
        }
        .macro-row input[type="time"]:focus {
          border-color: #2d6a4f;
          outline: none;
        }
        .macro-radio-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .macro-radio-group label {
          font-weight: normal;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        .macro-radio-group input[type="radio"] {
          width: 18px;
          height: 18px;
          cursor: pointer;
        }
        .macro-buttons {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }
        .macro-btn {
          flex: 1;
          padding: 12px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.2s;
        }
        .macro-btn-start {
          background: #2d6a4f;
          color: white;
        }
        .macro-btn-start:hover {
          background: #1b4332;
        }
        .macro-btn-start:disabled {
          background: #aaa;
          cursor: not-allowed;
        }
        .macro-btn-stop {
          background: #d32f2f;
          color: white;
        }
        .macro-btn-stop:hover {
          background: #b71c1c;
        }
        .macro-btn-test {
          background: #1565c0;
          color: white;
        }
        .macro-btn-test:hover {
          background: #0d47a1;
        }
        .macro-status {
          margin-top: 12px;
          padding: 10px;
          background: #f5f5f5;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.6;
          min-height: 60px;
        }
        .macro-status .status-label {
          font-weight: bold;
        }
        .status-waiting { color: #e65100; }
        .status-scanning { color: #1565c0; }
        .status-success { color: #2d6a4f; }
        .status-error { color: #d32f2f; }
        .status-idle { color: #666; }
        .macro-clock {
          text-align: center;
          font-size: 24px;
          font-weight: bold;
          color: #2d6a4f;
          margin: 8px 0;
          font-family: 'Consolas', monospace;
        }
      </style>

      <div class="macro-header" id="macro-drag-handle">
        <span>플라자CC 예약 매크로</span>
        <button class="minimize-btn" id="macro-minimize" title="접기/펼치기">-</button>
      </div>

      <div class="macro-body" id="macro-body">
        <div class="macro-clock" id="macro-clock">--:--:--</div>

        <div class="macro-row">
          <label>원하는 시간 범위</label>
          <div class="time-inputs">
            <input type="time" id="macro-time-from" value="${settings.timeFrom}">
            <span style="font-size: 18px; font-weight: bold;">~</span>
            <input type="time" id="macro-time-to" value="${settings.timeTo}">
          </div>
        </div>

        <div class="macro-row">
          <label>코스 선택</label>
          <div class="macro-radio-group">
            <label>
              <input type="radio" name="macro-course" value="out"
                ${settings.coursePreference === 'out' ? 'checked' : ''}>
              타이거 OUT 만
            </label>
            <label>
              <input type="radio" name="macro-course" value="in"
                ${settings.coursePreference === 'in' ? 'checked' : ''}>
              타이거 IN 만
            </label>
            <label>
              <input type="radio" name="macro-course" value="both"
                ${settings.coursePreference === 'both' ? 'checked' : ''}>
              둘 다 OK (OUT 우선)
            </label>
          </div>
        </div>

        <div class="macro-buttons">
          <button class="macro-btn macro-btn-start" id="macro-btn-start">
            대기 시작
          </button>
          <button class="macro-btn macro-btn-stop" id="macro-btn-stop" style="display:none;">
            중지
          </button>
        </div>

        <div class="macro-buttons" style="margin-top: 8px;">
          <button class="macro-btn macro-btn-test" id="macro-btn-test">
            지금 테스트
          </button>
          <button class="macro-btn" id="macro-btn-diag"
            style="background:#757575;color:white;font-size:13px;">
            진단
          </button>
        </div>

        <div class="macro-status" id="macro-status">
          <div><span class="status-label status-idle">대기</span></div>
          <div>설정 후 "대기 시작"을 눌러주세요</div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // ---- 시계 업데이트 ----
    function updateClock() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      const clockEl = document.getElementById('macro-clock');
      if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
    }
    updateClock();
    setInterval(updateClock, 200);

    // ---- 드래그 기능 ----
    const handle = document.getElementById('macro-drag-handle');
    let isDragging = false, dragX, dragY;
    handle.addEventListener('mousedown', e => {
      if (e.target.id === 'macro-minimize') return;
      isDragging = true;
      dragX = e.clientX - panel.getBoundingClientRect().left;
      dragY = e.clientY - panel.getBoundingClientRect().top;
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - dragX) + 'px';
      panel.style.top = (e.clientY - dragY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // ---- 접기/펼치기 ----
    document.getElementById('macro-minimize').addEventListener('click', () => {
      const body = document.getElementById('macro-body');
      const btn = document.getElementById('macro-minimize');
      body.classList.toggle('hidden');
      btn.textContent = body.classList.contains('hidden') ? '+' : '-';
    });

    // ---- 설정 변경 시 자동 저장 ----
    function getCurrentSettings() {
      return {
        timeFrom: document.getElementById('macro-time-from').value,
        timeTo: document.getElementById('macro-time-to').value,
        coursePreference: document.querySelector('input[name="macro-course"]:checked')?.value || 'both',
        coursePriority: 'out-first',
      };
    }

    ['macro-time-from', 'macro-time-to'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        saveSettings(getCurrentSettings());
      });
    });
    document.querySelectorAll('input[name="macro-course"]').forEach(el => {
      el.addEventListener('change', () => {
        saveSettings(getCurrentSettings());
      });
    });

    // ---- 상태 표시 ----
    function setStatus(type, lines) {
      const statusEl = document.getElementById('macro-status');
      const labels = {
        idle: '<span class="status-label status-idle">대기</span>',
        waiting: '<span class="status-label status-waiting">대기 중...</span>',
        scanning: '<span class="status-label status-scanning">검색 중...</span>',
        success: '<span class="status-label status-success">성공!</span>',
        error: '<span class="status-label status-error">실패</span>',
      };
      statusEl.innerHTML = `<div>${labels[type] || ''}</div>` +
        lines.map(l => `<div>${l}</div>`).join('');
    }

    // ---- 대기 시작 ----
    let waitingTimer = null;

    function startWaiting() {
      const s = getCurrentSettings();
      saveSettings(s);
      document.getElementById('macro-btn-start').style.display = 'none';
      document.getElementById('macro-btn-stop').style.display = 'block';

      // 상태 저장 (새로고침 후에도 유지)
      saveState({
        active: true,
        settings: s,
        refreshCount: 0,
        startedAt: Date.now(),
      });

      setStatus('waiting', [
        `시간: ${s.timeFrom} ~ ${s.timeTo}`,
        `코스: ${s.coursePreference === 'out' ? '타이거OUT' : s.coursePreference === 'in' ? '타이거IN' : '둘다(OUT우선)'}`,
        '10:00:00에 자동 새로고침됩니다',
      ]);

      waitingTimer = setInterval(() => {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const sec = now.getSeconds();
        const ms = now.getMilliseconds();

        // 10시 정각 또는 그 이후 (0.5초 전에 새로고침)
        if (h === TARGET_HOUR && m === TARGET_MINUTE && sec === 0 && ms >= 0) {
          clearInterval(waitingTimer);
          setStatus('scanning', ['새로고침 중...']);
          // 상태 업데이트 후 새로고침
          const state = loadState() || {};
          state.refreshCount = (state.refreshCount || 0) + 1;
          state.phase = 'scanning';
          saveState(state);
          location.reload();
        }
        // 9:59:59.500 이후면 0.5초 뒤에 새로고침
        else if (h === TARGET_HOUR - 1 && m === 59 && sec === 59 && ms >= 500) {
          clearInterval(waitingTimer);
          setStatus('scanning', ['새로고침 준비 중...']);
          const state = loadState() || {};
          state.refreshCount = (state.refreshCount || 0) + 1;
          state.phase = 'scanning';
          saveState(state);
          setTimeout(() => location.reload(), 500 - ms + 500);
        }
        // 이미 10시가 지났으면 바로 실행
        else if (h === TARGET_HOUR && m >= TARGET_MINUTE && m < TARGET_MINUTE + 5) {
          clearInterval(waitingTimer);
          const state = loadState() || {};
          state.refreshCount = (state.refreshCount || 0) + 1;
          state.phase = 'scanning';
          saveState(state);
          location.reload();
        }
      }, 100);
    }

    function stopWaiting() {
      if (waitingTimer) clearInterval(waitingTimer);
      waitingTimer = null;
      clearState();

      document.getElementById('macro-btn-start').style.display = 'block';
      document.getElementById('macro-btn-stop').style.display = 'none';
      setStatus('idle', ['중지되었습니다. "대기 시작"을 눌러 다시 시작하세요.']);
    }

    // ---- 버튼 이벤트 ----
    document.getElementById('macro-btn-start').addEventListener('click', startWaiting);
    document.getElementById('macro-btn-stop').addEventListener('click', stopWaiting);

    // ---- 테스트 버튼: 현재 페이지에서 바로 스캔+클릭 시도 ----
    document.getElementById('macro-btn-test').addEventListener('click', () => {
      const s = getCurrentSettings();
      saveSettings(s);
      setStatus('scanning', ['시간표 스캔 중...']);

      setTimeout(() => {
        const result = scanAndClick(s);
        if (result.found) {
          playAlert();
          setStatus('success', [
            `${result.time} (${result.course === 'out' ? '타이거OUT' : result.course === 'in' ? '타이거IN' : '코스미확인'}) 예약 클릭!`,
            '팝업에서 정보를 입력하세요!',
          ]);
        } else {
          setStatus('error', [result.reason]);
        }
      }, 300);
    });

    // ---- 진단 버튼: DOM에서 찾은 시간표 정보 표시 ----
    document.getElementById('macro-btn-diag').addEventListener('click', () => {
      const slots = parseTimeTable();
      if (slots.length === 0) {
        // 예약 버튼을 못 찾으면 페이지의 모든 링크/버튼 정보 표시
        const allClickable = document.querySelectorAll('a, button, input[type="button"]');
        const info = [];
        allClickable.forEach(el => {
          const text = (el.textContent || el.value || '').trim().substring(0, 30);
          if (text && text !== '') {
            info.push(text);
          }
        });
        const unique = [...new Set(info)].slice(0, 20);
        setStatus('error', [
          `시간표 못 찾음 (0개 슬롯)`,
          `페이지 내 클릭 요소 ${allClickable.length}개:`,
          ...unique.map(t => `  "${t}"`),
          '',
          '이 정보를 캡처해서 보내주세요!',
        ]);
      } else {
        setStatus('scanning', [
          `${slots.length}개 예약 슬롯 발견:`,
          ...slots.slice(0, 10).map(s =>
            `  ${s.time} | ${s.course === 'out' ? 'OUT' : s.course === 'in' ? 'IN' : '?'} | ${s.element.tagName}`
          ),
          slots.length > 10 ? `  ... 외 ${slots.length - 10}개` : '',
        ]);
      }
    });

    // ---- 페이지 로드 시 이전 상태 복원 ----
    const savedState = loadState();
    if (savedState && savedState.active) {
      const s = savedState.settings || getCurrentSettings();

      // 설정 UI 복원
      document.getElementById('macro-time-from').value = s.timeFrom;
      document.getElementById('macro-time-to').value = s.timeTo;
      document.querySelectorAll('input[name="macro-course"]').forEach(el => {
        el.checked = el.value === s.coursePreference;
      });

      if (savedState.phase === 'scanning') {
        // 스캔 모드 - 즉시 시간표 탐색
        document.getElementById('macro-btn-start').style.display = 'none';
        document.getElementById('macro-btn-stop').style.display = 'block';

        setStatus('scanning', [
          `새로고침 #${savedState.refreshCount || 1}`,
          '시간표 스캔 중...',
        ]);

        // DOM 로드 후 스캔
        setTimeout(() => {
          const result = scanAndClick(s);
          if (result.found) {
            // 성공! 알림 + 상태 초기화
            playAlert();
            clearState();
            setStatus('success', [
              `${result.time} (${result.course === 'out' ? '타이거OUT' : result.course === 'in' ? '타이거IN' : '코스미확인'}) 예약 클릭 완료!`,
              '',
              '팝업에서 비밀번호와 보안문자를',
              '입력해주세요!',
            ]);
            document.getElementById('macro-btn-start').style.display = 'block';
            document.getElementById('macro-btn-stop').style.display = 'none';
          } else {
            // 못 찾음 - 재새로고침
            const count = savedState.refreshCount || 1;
            if (count < MAX_REFRESH_COUNT) {
              setStatus('scanning', [
                `새로고침 #${count} - 매칭 없음`,
                result.reason,
                `${REFRESH_INTERVAL_MS}ms 후 재시도...`,
              ]);
              savedState.refreshCount = count + 1;
              saveState(savedState);
              setTimeout(() => location.reload(), REFRESH_INTERVAL_MS);
            } else {
              // 최대 횟수 초과
              clearState();
              setStatus('error', [
                `${MAX_REFRESH_COUNT}회 새로고침 후 매칭 실패`,
                result.reason,
                '"대기 시작"을 눌러 다시 시도하세요',
              ]);
              document.getElementById('macro-btn-start').style.display = 'block';
              document.getElementById('macro-btn-stop').style.display = 'none';
            }
          }
        }, 800); // 페이지 완전 로드 대기

      } else {
        // 대기 모드 복원
        startWaiting();
      }
    }
  }

  // ============================================================
  // 정기예약 페이지에서만 패널 표시
  // ============================================================
  // 약간의 딜레이 후 패널 생성 (페이지 완전 로드 대기)
  if (document.readyState === 'complete') {
    createPanel();
  } else {
    window.addEventListener('load', createPanel);
  }

})();
