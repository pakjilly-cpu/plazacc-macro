# 플라자CC 예약 매크로 - 기술 문서

> 개발자(parksh) 참고용. 설계 의도와 기술적 판단 근거를 기록한다.

---

## 1. 프로젝트 개요

- **목적**: 어머니(이순금, 60대)의 플라자CC 골프장 예약 자동화
- **배경**: 매주 월요일 10시에 3주 뒤 날짜가 오픈되는데, 수동 클릭으로는 다른 사람에게 밀려 예약 실패가 반복됨
- **핵심 요구**: 10시 정각에 새로고침 → 날짜 클릭 → 슬롯 클릭까지 0.5초 이내 자동 완료
- **예약 특성**: confirmPopup 팝업이 뜨는 순간 예약이 잡힌 상태. 팝업 내 확인/비밀번호 입력은 천천히 해도 됨
- **사이트**: www.plazacc.co.kr (한화리조트 예약 시스템 연동)

---

## 2. 사이트 구조 분석

### iframe 중첩 구조

```
main.do (www.plazacc.co.kr)
  └─ iframe#iframeTopContents (www.plazacc.co.kr/.../ircc_iqry_work_memb.do)
      └─ iframe#bookingIframe (booking.hanwharesort.co.kr/.../serviceM00.mvc)
          ├─ iframe#ifrmStep1 (serviceF01.mvc) - 클럽 선택
          ├─ iframe#ifrmStep2 (serviceF02.mvc) - 달력/날짜 선택
          └─ iframe#ifrmStep3 (serviceS01.mvc) - 시간표 (핵심)
```

- **cross-origin 문제**: 최상위는 `plazacc.co.kr`, 예약 영역은 `booking.hanwharesort.co.kr`. 서로 다른 도메인이라 상위 프레임에서 하위 iframe DOM에 접근 불가.
- **같은 도메인 영역**: `serviceF02`(달력)와 `serviceS01`(시간표)은 둘 다 `booking.hanwharesort.co.kr` → 같은 탭의 sessionStorage 공유 가능.

### 시간표 DOM 구조

예약 가능한 슬롯은 다음 형태의 `<a>` 태그로 존재:

```html
<a href="javascript:confirmPopup('20260408','ID','0605','PZC','T-OUT','','기타','','가격')">예약</a>
```

- `confirmPopup` 함수: 위약 체크 AJAX → `_confirmPopup` → 팝업 오픈
- 코스 코드: `T-OUT`(타이거OUT), `T-IN`(타이거IN), `L-OUT`(라이온OUT), `L-IN`(라이온IN)
- 시간 형식: `'0605'` = 06:05

---

## 3. 기술적 접근 방식

### Chrome Extension (Manifest V3) 선택 이유

처음에는 Tampermonkey로 시도했으나, 회사(사무실) 크롬에 그룹 정책으로 Tampermonkey 설치/실행이 차단되어 있었다. Chrome Extension은 개발자 모드로 로컬 로드가 가능하므로 정책 우회가 된다.

### manifest.json 핵심 설정

```json
{
  "content_scripts": [{
    "matches": ["*://booking.hanwharesort.co.kr/*"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true,
    "world": "MAIN"
  }]
}
```

| 설정 | 이유 |
|------|------|
| `matches` | 예약 시스템이 `booking.hanwharesort.co.kr`에서 동작 |
| `all_frames: true` | 달력(serviceF02)과 시간표(serviceS01)가 각각 별도 iframe. 모든 프레임에 주입 필요 |
| `world: "MAIN"` | 페이지의 JS 컨텍스트에서 실행. `javascript:` href 클릭과 CSP 우회에 필수 (아래 상세) |
| `run_at: "document_idle"` | DOM 로드 후 실행. 다만 iframe 내부 콘텐츠 로딩 타이밍이 불확실하므로 폴링으로 보완 |

### `"world": "MAIN"`이 필요한 이유

1. **`javascript:` href 클릭**: 예약 링크가 `href="javascript:confirmPopup(...)"` 형태. `ISOLATED` world에서 `.click()`하면 페이지의 `confirmPopup` 함수에 접근 불가 → 아무 일도 안 일어남.
2. **CSP inline script 차단**: `ISOLATED` world에서 동적으로 `<script>` 태그를 삽입하는 우회 방법도 CSP가 차단함.
3. **`MAIN` world**: 페이지와 같은 JS 실행 환경. `confirmPopup`이 `window` 스코프에 있으므로 `.click()` 시 정상 호출됨.

### 탭별 sessionStorage 기반 iframe 간 통신

달력 iframe과 시간표 iframe은 같은 도메인(`booking.hanwharesort.co.kr`)이지만, 서로 다른 iframe이라 직접 함수 호출이나 이벤트 전달이 안 된다. 해결:

```
시간표(serviceS01) → sessionStorage에 명령 기록 → 달력(serviceF02) 100ms 폴링으로 읽기 → 실행
```

설정은 localStorage, 실행 상태와 명령은 탭별 sessionStorage를 사용한다:

| 키 | 저장소 / 용도 |
|----|------|
| `plazacc-s` | localStorage / 사용자 설정 (시간 범위, 목표 날짜 등) |
| `plazacc-job` | sessionStorage / 이 탭의 작업 상태와 실행 phase |
| `plazacc-cmd` | sessionStorage / 이 탭의 달력 명령과 acknowledgement |

### 페이지 감지 폴링

```javascript
(function detectPage(n){
  var isTimeTable = !!document.querySelector('a[href*="confirmPopup"]');
  var isCalendar = !isTimeTable && !!document.querySelector('img[alt*="일자 선택"]');
  if(isTimeTable){ initTimeTable(); return; }
  if(isCalendar){ initCalendar(); return; }
  // ...100ms 간격 재시도
})(0);
```

- `document_idle` 시점에 iframe 내부 콘텐츠가 아직 렌더링되지 않았을 수 있음
- 100ms 간격 폴링으로 DOM 요소 등장을 감지
- 작업 중이면 최대 10초(100회), 유휴 시 최대 2초(20회) 대기

---

## 4. 핵심 설계 결정과 이유

### (1) sessionStorage 통신을 선택한 이유

- **조건**: 달력(`serviceF02`)과 시간표(`serviceS01`)는 같은 도메인
- **대안 비교**:
  - `postMessage`: 부모 iframe 참조가 필요한데, cross-origin 상위 프레임 때문에 라우팅이 복잡
  - `BroadcastChannel`: 동일 origin 내 통신 가능하지만, 페이지 새로고침 시 채널이 끊김
  - `localStorage`: 새로고침에는 강하지만 다른 예약 탭까지 같은 job/cmd를 소비하여 중복 실행 위험
  - `sessionStorage`: 새로고침과 같은 탭의 iframe 사이에서는 유지되고, 다른 탭과는 분리
- **결론**: v22부터 설정만 localStorage에 두고 job/cmd는 sessionStorage로 분리한다.

### (2) 폴링 방식 선택 (100ms 간격)

- `storage` 이벤트는 같은 탭 내에서는 발생하지 않음 (다른 탭에서 변경 시에만 fire)
- 따라서 같은 탭 내 iframe 간 통신에는 `addEventListener('storage', ...)` 사용 불가
- 100ms 폴링은 CPU 부하 미미하면서 반응 속도 충분

### (3) 취소감시에서 같은 날짜일 때 `window.location.reload()`

**문제**: 취소표 감시 모드에서 날짜 1개만 감시할 때, 달력에 "같은 날짜 클릭" 명령을 보내면 iframe이 갱신되지 않음 (이미 해당 날짜가 선택된 상태이므로).

**해결**: 현재 시간표 URL의 `targetDate` 파라미터에서 날짜를 추출하여, 다음 감시 대상이 같은 날짜이면 달력 명령 대신 `window.location.reload()`로 시간표 자체를 새로고침.

```javascript
if(job.mode==='cancel' && nextDate===currentDateFromUrl){
  setTimeout(function(){ window.location.reload(); }, 3000);
}
```

### (4) 즉시 클릭 (딜레이 0ms)

초기에는 안전 마진으로 300ms 딜레이를 넣었으나, Playwright 성능 측정 결과 새로고침부터 슬롯 표시까지 185ms밖에 안 걸렸다. 경쟁 상황에서 300ms는 치명적이므로 제거.

```javascript
// 매칭 발견 → 즉시 클릭 (지연 없음!)
if(job.autoClick && matched.length > 0){
  t.element.click();   // 바로 클릭
}
```

### (5) 코스 우선순위 고정

사용자 선호: 타이거OUT > 타이거IN > 라이온OUT > 라이온IN. UI를 단순화하기 위해 드롭다운 대신 고정 순서로 처리.

```javascript
var courseOrder = {'T-OUT':0, 'T-IN':1, 'L-OUT':2, 'L-IN':3};
```

같은 코스 내에서는 시간 빠른 순 정렬.

10시 자동예약은 코스를 바깥쪽 루프로 두고 각 코스의 모든 목표 날짜를 먼저 확인한다. 예를 들어 목표 날짜가 8일과 12일이면 `T-OUT 8일 → T-OUT 12일 → T-IN 8일 → T-IN 12일 → ...`의 순서다. 각 코스/날짜 조합은 최초 확인 1회와 750ms 간격 재조회 2회로 총 3회 확인한다.

---

## 5. 버전 히스토리

| 버전 | 내용 | 비고 |
|------|------|------|
| v1 | Tampermonkey 유저스크립트 첫 버전 | `plazacc-reservation-macro.user.js` |
| v2 | Console snippet 버전 (55개 슬롯 스캔 성공) | `plazacc-snippet.js`, 사이트 DOM 구조 파악 |
| v3 | Tampermonkey v2 + 북마클릿 시도 | 회사 크롬 정책으로 Tampermonkey 실패 |
| v10 | **Chrome Extension 전환**, localStorage 기반 통신 | `chrome-extension/` 디렉토리 |
| v11 | detectPage 폴링, 슬롯 대기 폴링 추가 | document_idle 타이밍 문제 해결 |
| v12 | 속도 최적화(200→100ms), 취소감시 reload, `world:MAIN`, 코스 우선순위 고정 | 과거 버전 |
| v22 / 확장 4.0.0 | 절대 실행시각·상태 머신, service worker 영구 알람, 달력 클릭 다중 셀렉터, 0.45초 직접 이동 fallback, 20초 서버 지연 복구, 중복 클릭 잠금 | 기반 버전 |
| v23 / 확장 4.0.1 | 전체 버튼 회귀검증, 취소감시·예약 fallback 중지 보장, 시간 범위·월별 날짜 유효성 검사 | 기반 버전 |
| v24 / 확장 4.0.2 | 날짜별 최초 스캔 후 750ms 간격 4회만 재조회, 모든 목표 날짜 소진 시 종료 | 과거 버전 |
| v25 / 확장 4.0.3 | 코스 우선으로 모든 날짜 순회, 코스/날짜 조합별 총 3회 확인 | 현재 버전 |

---

## 6. 해결한 주요 버그들

### (1) `startJob` 인자 순서 버그

```javascript
// 버그: true가 settings 자리에 들어감
startJob('cancel', targets, true);

// 수정: settings 객체를 전달
startJob('cancel', targets, st);
```

`startJob(mode, dates, settings)` 시그니처에 `true`를 넘기면 settings가 boolean이 되어 `st.timeFrom` 등이 모두 undefined.

### (2) localStorage에 boolean `true` 저장

`plazacc-s`에 `true`가 저장되면 `JSON.parse`는 `true`를 반환하고, 이에 대해 `for(var k in d)` 루프가 실행되어도 문제가 생김. `load()` 함수에 타입 체크 방어 코드 추가:

```javascript
function load(){
  try {
    var v = JSON.parse(localStorage.getItem('plazacc-s'));
    return (v && typeof v === 'object') ? v : {};  // object가 아니면 빈 객체
  } catch(e) { return {}; }
}
```

### (3) `confirmPopup` javascript: href 클릭 미작동

**증상**: `element.click()`을 호출해도 `confirmPopup` 함수가 실행되지 않음.
**원인**: Chrome Extension content script는 기본적으로 `ISOLATED` world에서 실행. `javascript:` 프로토콜의 코드는 페이지의 JS 컨텍스트에서 실행되어야 하는데, ISOLATED world의 `.click()`은 페이지 함수에 접근 불가.
**해결**: `manifest.json`에 `"world": "MAIN"` 추가.

### (4) CSP inline script 차단

**시도**: `ISOLATED` world에서 `<script>` 태그를 동적 삽입하여 페이지 함수 호출.
**실패**: 한화리조트 사이트의 CSP(Content Security Policy)가 inline script를 차단.
**해결**: `world: "MAIN"`으로 근본 해결.

### (5) 같은 날짜 취소감시 루프 멈춤

**증상**: 단일 날짜 취소감시 시, 첫 스캔 후 다음 루프가 돌지 않음.
**원인**: 달력에 같은 날짜 클릭 명령을 보내도 iframe이 갱신되지 않음 → 시간표 content script 재실행 안 됨.
**해결**: 현재 URL의 날짜와 다음 감시 날짜가 같으면 `window.location.reload()`로 시간표 iframe 자체를 새로고침. 3초 간격으로 반복.

### (6) 확장 프로그램 경로 불일치 (WSL vs Windows)

개발은 WSL(`/home/parksh/plazacc-macro/chrome-extension/`)에서 하지만, 크롬은 Windows에서 실행. 크롬 "압축해제된 확장 프로그램을 로드합니다"에서 WSL 경로를 직접 지정할 수 없으므로 Windows Downloads 폴더에 복사 필요.

```
WSL: /home/parksh/plazacc-macro/chrome-extension/
  → Windows: C:\Users\parksh\Downloads\chrome-extension\
```

---

## 7. 성능 측정 (Playwright)

Playwright로 실제 사이트에서 측정한 결과:

| 구간 | 소요 시간 |
|------|-----------|
| 달력 새로고침 (클릭 → DOM 갱신) | ~130ms |
| 날짜 클릭 → 시간표 슬롯 표시 | ~60-110ms |
| 전체 흐름 (새로고침 → 슬롯 클릭) | ~185ms |

### 10시 자동예약 예상 시나리오

```
09:59:55  매크로 대기 중
10:00:00  달력 새로고침 클릭 (자동)
10:00:00  +130ms  달력 갱신 완료
10:00:00  +130ms  목표 날짜 클릭
10:00:00  +240ms  시간표 슬롯 표시 (60~110ms)
10:00:00  +240ms  조건 매칭 → 즉시 클릭
10:00:00  +300ms  confirmPopup 실행 → 예약 완료
```

**예상 총 소요: ~0.3-0.5초** (수동 클릭 대비 3-5초 단축)

---

## 8. 2026-07-13 장애와 v22 재발 방지

Chrome History와 booking origin의 localStorage 기록을 함께 확인한 결과, 10시 타이머는 `10:00:00.477`에 정상 발동했고 `serviceF02` 달력 reload도 실행됐다. 실패 지점은 그 다음 단계였다.

- `clickDate()`가 `a[href="#none"]`만 찾아 실제 날짜 요소를 발견하지 못했다.
- `plazacc-cmd`에는 `clickAfterReload:"6"`이 남았지만 시간표 `serviceS01`은 목표 날짜로 한 번도 이동하지 않았다.
- 기존 watchdog은 같은 명령만 다시 기록하거나 현재 프레임을 reload하여 실패 상태를 반복했다.
- 별도로, 10시 전 대기 작업이 있는 상태에서 시간표가 reload되면 `auto10started`를 확인하지 않고 기존 슬롯을 즉시 클릭하는 결함도 확인됐다.

v22에서는 다음 불변식을 코드와 회귀 테스트로 유지한다.

1. `phase=armed`인 작업은 페이지가 몇 번 reload되어도 목표 시각 전에 스캔·클릭하지 않는다.
2. 예약 가능한 링크가 0개여도 `serviceS01` URL이면 시간표 복구 로직을 초기화한다.
3. 달력 날짜 요소는 `#none`, `#none;`, `javascript:`, `onclick`, 날짜 선택 이미지 형태를 모두 탐색한다.
4. 달력 명령 후 0.45초 안에 시간표가 이동하지 않으면 `targetDate` URL 직접 이동으로 복구한다.
5. 목표 날짜와 현재 시간표 날짜가 다르면 슬롯이 보여도 클릭하지 않는다.
6. 서버 반영 지연은 각 코스/날짜 조합을 최초 1회 + 750ms 간격 재조회 2회로 총 3회 확인한다.
7. 페이지 타이머와 MV3 `chrome.alarms`가 함께 감시하며, 브라우저 재시작 시 저장된 알람을 복원한다.

---

## 8. 향후 개선 가능 사항

### 실전 테스트
- 다음 월요일 10시에 실제 예약 오픈 상황에서 테스트 필요
- 10시 직전 서버 부하로 응답 지연 가능성 확인

### 알림 기능
- 예약 성공/실패 시 카카오톡 알림 연동 (기존 `kakao_queue` 인프라 활용 가능)
- 브라우저 Notification API 활용한 데스크톱 알림

### 취소감시 개선
- 복수 날짜 감시 시 날짜별 결과(스캔 횟수, 마지막 확인 시각) 표시
- 감시 간격 사용자 설정 (현재 3초 고정)

### 코드 품질
- 설정 UI를 popup.html로 분리 (content script 경량화)
- 에러 로깅 및 디버그 모드 토글
- 테스트 자동화 (Playwright E2E 테스트 스크립트화)
