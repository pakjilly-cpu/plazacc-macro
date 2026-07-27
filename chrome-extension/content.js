// 플라자CC 매크로 v25 - 코스 우선 순회 + 조합별 총 3회 확인
(function(){
'use strict';

var MACRO_VERSION='25';
var AUTO_RECOVERY_MS=30*60*1000;
var SCAN_RETRY_MS=750;
// 최초 확인 1회 + 재조회 2회 = 코스/날짜 조합별 총 3회
var MAX_SCAN_RETRIES=2;
var _runtimeStorage=localStorage;
try{if(typeof sessionStorage!=='undefined')_runtimeStorage=sessionStorage;}catch(e){}
try{
  if(_runtimeStorage!==localStorage&&!_runtimeStorage.getItem('plazacc-job')){
    var legacyJob=localStorage.getItem('plazacc-job');
    var legacyCmd=localStorage.getItem('plazacc-cmd');
    if(legacyJob)_runtimeStorage.setItem('plazacc-job',legacyJob);
    if(legacyCmd)_runtimeStorage.setItem('plazacc-cmd',legacyCmd);
    localStorage.removeItem('plazacc-job');localStorage.removeItem('plazacc-cmd');
  }
}catch(e){}

// MAIN world와 확장 프로그램 service worker 사이의 DOM 이벤트 브리지.
// Tampermonkey에서 실행될 때는 수신자가 없으므로 그대로 무시된다.
function emitExtensionEvent(type,data){
  try{
    window.dispatchEvent(new CustomEvent('plazacc:extension',{detail:JSON.stringify({type:type,data:data||{}})}));
  }catch(e){}
}

// 사이트가 Date.now를 오버라이드할 수 있으므로 원본 캡처
var _origDateNow = Date.now.bind(Date);
// 혹시 이미 오버라이드된 경우 대비: performance.now + 기준시점 사용
var _timeBase = (function(){
  var dn = Date.now();
  // Date.now()가 숫자가 아니면 new Date().getTime()으로 폴백
  if(typeof dn !== 'number'){ return {base: new Date().getTime(), perf: performance.now()}; }
  return null;
})();
function _now(){
  if(_timeBase) return Math.round(_timeBase.base + (performance.now() - _timeBase.perf));
  var v = _origDateNow();
  if(typeof v !== 'number') return new Date().getTime();
  return v;
}

// ===== 서버 시간 동기화 =====
var _tsOffset = 0; // 밀리초 (서버시간 - PC시간)
var _tsSynced = false;

function syncedNow(){
  return new Date(_now() + _tsOffset);
}

// 서버 Date 헤더로 PC 시계 오차 측정 (3회 측정, 최소 RTT 채택)
var _syncSeq = 0;
function doSyncTime(label){
  var best = null;
  var done = 0;
  var total = 3;
  function sample(){
    _syncSeq++;
    var t0 = _now();
    var url = window.location.href.split('#')[0]; // #none 제거
    url += (url.indexOf('?') >= 0 ? '&' : '?') + '_nocache=' + _syncSeq + '' + Math.floor(Math.random()*99999);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 2500;
    var handled = false;
    function failed(){
      if(handled)return;
      handled=true;
      done++;
      if(done < total){ setTimeout(sample, 150); }
      else if(best){
        _tsOffset = best.offset;
        _tsSynced = true;
        console.log('[매크로] '+(label||'시간보정')+' 완료(일부): ' + (_tsOffset>0?'+':'') + (_tsOffset/1000).toFixed(1) + '초');
      } else {
        _tsSynced = true;
        console.log('[매크로] '+(label||'시간보정')+' 실패, PC 시간 사용');
      }
    }
    xhr.onreadystatechange = function(){
      if(handled) return;
      if(xhr.readyState < 2) return; // HEADERS_RECEIVED 이상
      var dateStr = null;
      try{ dateStr = xhr.getResponseHeader('Date'); }catch(e){}
      if(!dateStr){if(xhr.readyState===4)failed();return;}
      handled = true;
      var t1 = _now();
      var serverTime = new Date(dateStr).getTime();
      var rtt = t1 - t0;
      var offset = serverTime - t0 - Math.floor(rtt / 2);
      if(!best || rtt < best.rtt){
        best = {offset: offset, rtt: rtt};
      }
      try{ xhr.abort(); }catch(e){} // 본문 다운로드 중단
      done++;
      if(done < total){
        setTimeout(sample, 150);
      } else {
        _tsOffset = best.offset;
        _tsSynced = true;
        console.log('[매크로] '+(label||'시간보정')+' 완료: ' + (_tsOffset>0?'+':'') + (_tsOffset/1000).toFixed(1) + '초 (RTT:' + best.rtt + 'ms)');
      }
    };
    xhr.onerror = failed;
    xhr.ontimeout = failed;
    xhr.send();
  }
  sample();
}
// 시간표 프레임만 서버 시간을 측정한다. all_frames에서 불필요한 요청 폭주 방지.
var _frameUrl='';
try{_frameUrl=window.location.href;}catch(e){}
var _likelyTimeTable=/serviceS01/i.test(_frameUrl)||!!document.querySelector('a[href*="confirmPopup"]');
if(_likelyTimeTable)doSyncTime('초기보정');

// 목표 시간 10초 전 자동 재측정 (직전 최신 오프셋 확보)
var _reSyncDone = false;
setInterval(function(){
  if(!_likelyTimeTable)return;
  if(_reSyncDone) return;
  var job=getJob();
  if(!job.active||job.mode!=='auto10') return;
  var tH=job.triggerH!=null?job.triggerH:10, tM=job.triggerM!=null?job.triggerM:0;
  // 목표 10초 전 = (tH:tM:00) - 10초
  var preH=tH, preM=tM-1, preSec=50;
  if(preM<0){preM=59;preH=(preH-1+24)%24;}
  var pc = new Date();
  if(pc.getHours()===preH && pc.getMinutes()===preM && pc.getSeconds()>=preSec){
    _reSyncDone = true;
    console.log('[매크로] 직전 재보정 시작 ('+tH+':'+String(tM).padStart(2,'0')+' 10초 전)');
    doSyncTime('직전재보정');
  }
}, 1000);

// 페이지 감지: 100ms 간격 폴링
(function detectPage(n){
  var url='';try{url=window.location.href;}catch(e){}
  // 예약 가능 링크가 0개여도 URL로 시간표를 판별해야 10시 후 재시도가 살아난다.
  var isTimeTable = /serviceS01/i.test(url)||!!document.querySelector('a[href*="confirmPopup"]');
  var isCalendar = !isTimeTable&&(/serviceF02/i.test(url)||!!document.querySelector('img[alt*="일자 선택"]'));
  if(isTimeTable){ initTimeTable(); return; }
  if(isCalendar){ initCalendar(); return; }
  var hasJob = false;
  try{ hasJob = !!getJob().active; }catch(e){}
  var maxTries = hasJob ? 200 : 20; // 작업중이면 20초(느린 네트워크 대비), 아니면 2초
  if(n < maxTries){ setTimeout(function(){ detectPage(n+1); }, 100); }
})(0);

// ===== 공용 스토리지 =====
function load(){try{var v=JSON.parse(localStorage.getItem('plazacc-s'));return(v&&typeof v==='object')?v:{};}catch(e){return{};}}
function save(s){if(s&&typeof s==='object')try{
  var old={};try{old=JSON.parse(localStorage.getItem('plazacc-s'))||{};}catch(e){}
  if((s.targetDates||'').trim()){
    if(s.targetDates!==old.targetDates||!old.targetDatesSavedAt)s.targetDatesSavedAt=_now();
    else s.targetDatesSavedAt=old.targetDatesSavedAt;
  }else{
    delete s.targetDatesSavedAt;
  }
  localStorage.setItem('plazacc-s',JSON.stringify(s));
}catch(e){}}
function defaults(){return{timeFrom:'10',timeTo:'14',course:'T-OUT-first',targetDates:'',autoRefresh:true};}
function loadWithDefaults(){
  var d=defaults();var s=load();
  if((s.targetDates||'').trim()){
    var ts=parseInt(s.targetDatesSavedAt||'0',10);
    if(!ts||(_now()-ts)>7*24*60*60*1000){
      console.log('[매크로] 오래된 목표 날짜 자동 초기화: '+s.targetDates);
      s.targetDates='';
      delete s.targetDatesSavedAt;
      save(s);
    }
  }
  for(var k in d){if(s[k]===undefined)s[k]=d[k];}
  return s;
}

// 실행 상태/iframe 명령은 같은 탭 안에서만 공유한다. sessionStorage는 reload와
// 같은 탭의 booking iframe 사이에서는 유지되지만 다른 예약 탭과는 섞이지 않는다.
// 작업 상태
function getJob(){try{return JSON.parse(_runtimeStorage.getItem('plazacc-job'))||{};}catch(e){return{};}}
function setJob(o){try{var j=getJob();for(var k in o)j[k]=o[k];_runtimeStorage.setItem('plazacc-job',JSON.stringify(j));}catch(e){}}
function replaceJob(o){try{_runtimeStorage.setItem('plazacc-job',JSON.stringify(o||{}));}catch(e){}}
function clearJob(reason){
  var j=getJob();
  try{
    _runtimeStorage.removeItem('plazacc-job');_runtimeStorage.removeItem('plazacc-autoreload');_runtimeStorage.removeItem('plazacc-cmd');
    localStorage.removeItem('plazacc-job');localStorage.removeItem('plazacc-cmd');
  }catch(e){}
  if(j.runId)emitExtensionEvent('CANCEL_SCHEDULE',{runId:j.runId,reason:reason||'cleared'});
}

// 매크로 자동 리로드 표시 (수동 이탈과 구분용)
function macroReload(){try{_runtimeStorage.setItem('plazacc-autoreload',String(_now()));}catch(e){} window.location.reload();}
function macroNavigate(url){try{_runtimeStorage.setItem('plazacc-autoreload',String(_now()));}catch(e){} window.location.href=url;}
function isAutoReload(){try{var t=parseInt(_runtimeStorage.getItem('plazacc-autoreload')||'0');return(_now()-t)<10000;}catch(e){return false;}}

// 달력 통신
function getCmd(){try{return JSON.parse(_runtimeStorage.getItem('plazacc-cmd'))||{};}catch(e){return{};}}
function setCmd(o){try{_runtimeStorage.setItem('plazacc-cmd',JSON.stringify(o));}catch(e){}}

// ===== 달력 iframe =====
function initCalendar(){
  console.log('[매크로] 달력');

  function normalizeDay(v){
    var n=parseInt(String(v||'').trim(),10);
    return n>=1&&n<=31?String(n):'';
  }
  function dayOfElement(el){
    if(!el)return'';
    var text=(el.textContent||'').replace(/\s+/g,'').trim();
    if(/^\d{1,2}$/.test(text))return normalizeDay(text);
    var attrs=['data-day','data-date','title','alt','aria-label','onclick','href'];
    for(var i=0;i<attrs.length;i++){
      var v=el.getAttribute&&el.getAttribute(attrs[i]);
      if(!v)continue;
      var full=String(v).match(/20\d{2}(?:0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
      if(full)return normalizeDay(full[1]);
      var labeled=String(v).match(/(?:^|\D)(\d{1,2})\s*일(?:자)?\s*선택/);
      if(labeled)return normalizeDay(labeled[1]);
    }
    var img=el.querySelector&&el.querySelector('img[alt*="일자 선택"]');
    if(img){
      var alt=img.getAttribute('alt')||'';
      var m=alt.match(/(?:^|\D)(\d{1,2})\s*일(?:자)?\s*선택/);
      if(m)return normalizeDay(m[1]);
      var cell=el.closest&&el.closest('td');
      var cellText=cell?(cell.textContent||'').replace(/\s+/g,'').trim():'';
      if(/^\d{1,2}$/.test(cellText))return normalizeDay(cellText);
    }
    return'';
  }
  function fullDateOfElement(el){
    if(!el)return'';
    var attrs=['data-date','data-target-date','value','title','alt','aria-label','onclick','href'];
    var nodes=[el];
    try{
      var descendants=el.querySelectorAll('[data-date],[data-target-date],[onclick],[href]');
      for(var n=0;n<descendants.length;n++)nodes.push(descendants[n]);
    }catch(e){}
    for(var i=0;i<nodes.length;i++){
      for(var j=0;j<attrs.length;j++){
        var v=nodes[i].getAttribute&&nodes[i].getAttribute(attrs[j]);
        var m=String(v||'').match(/(20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))/);
        if(m)return m[1];
      }
    }
    return'';
  }
  function monthOfElement(el,fullDate){
    if(fullDate)return fullDate.substring(0,6);
    var table=el&&el.closest&&el.closest('table');
    var text=table?(table.textContent||'').replace(/\s+/g,' '):'';
    var months={},m;
    var fullRe=/(20\d{2})\D{0,5}(0?[1-9]|1[0-2])\s*월?/g;
    while((m=fullRe.exec(text)))months[m[1]+String(parseInt(m[2],10)).padStart(2,'0')]=true;
    var keys=Object.keys(months);
    if(keys.length===1)return keys[0];
    var targetYm=(getJob().targetYm||'');
    if(targetYm){
      var monthRe=/(?:^|\D)(0?[1-9]|1[0-2])\s*월/g,monthOnly={};
      while((m=monthRe.exec(text)))monthOnly[String(parseInt(m[1],10)).padStart(2,'0')]=true;
      var monthKeys=Object.keys(monthOnly);
      if(monthKeys.length===1)return targetYm.substring(0,4)+monthKeys[0];
    }
    return'';
  }
  function getDateElements(){
    // 실제 사이트는 배포 시점에 따라 #none, #none;, javascript:, onclick, 날짜 아이콘을 혼용한다.
    // 두 달 달력이 동시에 표시되므로 첫 번째 table로 범위를 제한하면 안 된다.
    var raw=document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="image"], img[alt*="일자 선택"]');
    var out=[];
    for(var i=0;i<raw.length;i++){
      var el=raw[i];
      var rawIsDateMarker=el.tagName==='IMG'&&((el.getAttribute&&el.getAttribute('alt'))||'').indexOf('일자 선택')>=0;
      if(el.tagName==='IMG')el=el.closest('a,button,[role="button"]')||el;
      var href=(el.getAttribute&&el.getAttribute('href'))||'';
      var onclick=(el.getAttribute&&el.getAttribute('onclick'))||'';
      var hasDateMarker=rawIsDateMarker||!!(el.matches&&el.matches('img[alt*="일자 선택"]'))||!!(el.querySelector&&el.querySelector('img[alt*="일자 선택"]'));
      if(!hasDateMarker&&!onclick&&!/^#none;?$/i.test(href)&&!/^javascript:/i.test(href)&&el.tagName!=='BUTTON')continue;
      var day=dayOfElement(el);
      if(!day)continue;
      var fullDate=fullDateOfElement(el);
      var ym=monthOfElement(el,fullDate);
      var duplicate=false;
      for(var j=0;j<out.length;j++){if(out[j].element===el){duplicate=true;break;}}
      if(!duplicate)out.push({day:day,fullDate:fullDate,ym:ym,element:el});
    }
    return out;
  }
  function getClickableDates(){
    var d=[],els=getDateElements();
    for(var i=0;i<els.length;i++){if(d.indexOf(els[i].day)<0)d.push(els[i].day);}
    return d;
  }
  function clickDate(d){
    var target=normalizeDay(d),els=getDateElements();
    var targetYm=(getJob().targetYm||'');
    if(targetYm){
      var sameMonth=els.filter(function(x){return x.ym===targetYm;});
      if(sameMonth.length)els=sameMonth;
      else{
        console.log('[매크로] 목표 월 '+targetYm+'을 DOM에서 식별 못함 - 다른 달 오클릭 방지');
        return false;
      }
    }
    for(var i=0;i<els.length;i++){
      if(els[i].day===target){
        els[i].element.click();
        console.log('[매크로] 날짜 '+target+' 클릭 (tag='+els[i].element.tagName+')');
        return true;
      }
    }
    return false;
  }
  function clickRefresh(){
    // v19: input[type=image] 포함, 자체 alt 속성 직접 검사, fallback은 location.reload()
    var cands=document.querySelectorAll('input[type="image"], a, button, img');
    for(var i=0;i<cands.length;i++){
      var el=cands[i];
      var selfAlt=el.getAttribute('alt')||'';
      if(selfAlt.indexOf('새로고침')>=0){
        var target=el.tagName==='IMG'?(el.closest('a,button')||el):el;
        target.click();
        console.log('[매크로] 새로고침 클릭 (tag='+target.tagName+', alt='+selfAlt+')');
        return true;
      }
      var childImg=el.querySelector&&el.querySelector('img');
      if(childImg&&(childImg.getAttribute('alt')||'').indexOf('새로고침')>=0){
        el.click();
        console.log('[매크로] 새로고침 클릭 (자식img alt)');
        return true;
      }
      var t=(el.textContent||'').trim();
      if(t==='새로고침'){
        el.click();
        console.log('[매크로] 새로고침 클릭 (텍스트)');
        return true;
      }
    }
    console.log('[매크로] 새로고침 버튼 못찾음 → location.reload() fallback');
    window.location.reload();
    return false;
  }

  // 100ms 간격으로 명령 체크 (빠른 반응)
  setInterval(function(){
    var cmd=getCmd();

    if(cmd.getDates){setCmd({dates:getClickableDates().join(',')});return;}

    if(cmd.click){
      var d=cmd.click;
      if(clickDate(d))setCmd({dateClicked:d,runId:cmd.runId||'',clickedAt:_now()});
      else setCmd({dateNotFound:d,runId:cmd.runId||'',availableDates:getClickableDates().join(','),failedAt:_now()});
      return;
    }

    if(cmd.refreshAndClick){
      // v19: 새로고침은 location.reload()라서 JS 컨텍스트가 죽음
      // → 클릭할 날짜를 clickAfterReload로 남기고, 리로드 후 폴링이 이어받음
      var d2=cmd.refreshAndClick;
      setCmd({clickAfterReload:d2,clickAfterReloadStart:_now(),runId:cmd.runId||'',attempt:0});
      clickRefresh();
      return;
    }

    if(cmd.clickAfterReload){
      // v19: 리로드 직후 대기중인 날짜 클릭 (DOM에 나타나면 즉시)
      var d3=cmd.clickAfterReload;
      var ts=cmd.clickAfterReloadStart||_now();
      if((_now()-ts) > 20000){
        var available=getClickableDates().join(',');
        console.log('[매크로:달력] 날짜 '+d3+' 못찾음 (보이는 날짜: '+(available||'없음')+')');
        setCmd({dateNotFound:d3,runId:cmd.runId||'',availableDates:available,failedAt:_now()});
        return;
      }
      if(clickDate(d3)){
        console.log('[매크로:달력] 리로드 후 날짜 '+d3+' 클릭 성공');
        setCmd({dateClicked:d3,runId:cmd.runId||'',clickedAt:_now()});
      }else if(!cmd.lastLoggedAt||(_now()-cmd.lastLoggedAt)>1000){
        setCmd({clickAfterReload:d3,clickAfterReloadStart:ts,runId:cmd.runId||'',attempt:(cmd.attempt||0)+1,lastLoggedAt:_now()});
        console.log('[매크로:달력] 날짜 '+d3+' 대기 중 (보이는 날짜: '+(getClickableDates().join(',')||'없음')+')');
      }
      return;
    }

    // auto10 트리거는 시간표 iframe의 카운트다운에서 전담 처리
    // (달력에서 중복 트리거하면 auto10started 플래그 경쟁 조건 발생)
  },100);
}

// ===== 시간표 iframe =====
function initTimeTable(){
  try{document.documentElement.setAttribute('data-plazacc-main-ready',MACRO_VERSION);}catch(e){}
  if(document.getElementById('plazacc-macro-panel'))return;
  console.log('[매크로] 시간표');

  // 현재 시간표의 날짜 (URL에서 추출)
  var currentDateFromUrl = '';
  var currentFullDateFromUrl = '';
  try{
    var dm = window.location.href.match(/targetDate=(\d{6,8})/);
    if(dm){
      currentFullDateFromUrl=dm[1].length>=8?dm[1].substring(0,8):'';
      currentDateFromUrl = dm[1].substring(6,8).replace(/^0/,''); // '20260408' → '8'
    }
  }catch(e){}

  function scanSlots(){
    var slots=[];var links=document.querySelectorAll('a[href*="confirmPopup"]');
    for(var i=0;i<links.length;i++){
      var href=links[i].getAttribute('href')||'';
      var m=href.match(/confirmPopup\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'(\d{4})'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/);
      if(m)slots.push({date:m[1],id:m[2],time:m[3].substring(0,2)+':'+m[3].substring(2,4),timeRaw:m[3],branch:m[4],course:m[5],element:links[i]});
    }
    return slots;
  }
  function timeToMin(t){if(!t||t.indexOf(':')<0)return 0;var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1]);}
  function cn(c){return{'T-OUT':'타이거OUT','T-IN':'타이거IN','L-OUT':'라이온OUT','L-IN':'라이온IN'}[c]||c||'?';}
  function fmtDate(d){
    if(!d||d.length!==8)return d;
    var dn=['일','월','화','수','목','금','토'];
    var dt=new Date(parseInt(d.substring(0,4)),parseInt(d.substring(4,6))-1,parseInt(d.substring(6,8)));
    return d.substring(4,6)+'/'+d.substring(6,8)+'('+dn[dt.getDay()]+')';
  }
  // auto10은 코스를 바깥쪽 루프로 돌고, 각 코스마다 목표 날짜를 처음부터 확인한다.
  var COURSE_ORDER=['T-OUT','T-IN','L-OUT','L-IN'];
  var courseOrder={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
  function filterAndSort(slots,s,onlyCourse){
    var from=parseInt(s.timeFrom)*60,to=parseInt(s.timeTo)*60;
    var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<to&&(!onlyCourse||x.course===onlyCourse);});
    f.sort(function(a,b){var ca=courseOrder[a.course]!=null?courseOrder[a.course]:9;var cb=courseOrder[b.course]!=null?courseOrder[b.course]:9;return ca!==cb?ca-cb:timeToMin(a.time)-timeToMin(b.time);});
    return f;
  }
  function beepSuccess(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.15,0.3,0.45,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=d<0.3?880:1100;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.1);});}catch(e){}}
  function beepWarn(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.18,0.36].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=330;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.12);});}catch(e){}}
  function timeOptions(sel){var h='';for(var i=6;i<=19;i++){var v=String(i);h+='<option value="'+v+'"'+(v===sel?' selected':'')+'>'+String(i).padStart(2,'0')+'시</option>';}return h;}
  function getPopupSignals(){
    var sels=[
      '.modal','.popup','.dialog','.layerPopup','.layer_popup','.pop_wrap','.popWrap',
      '[class*="modal"]','[class*="popup"]','[class*="Popup"]','[class*="dialog"]','[class*="Dialog"]',
      '[id*="popup"]','[id*="Popup"]','[id*="dialog"]','[role="dialog"]'
    ];
    var nodes=[];
    for(var i=0;i<sels.length;i++){
      var found=document.querySelectorAll(sels[i]);
      for(var j=0;j<found.length;j++)nodes.push(found[j]);
    }
    var visible=0;
    for(var k=0;k<nodes.length;k++){
      var el=nodes[k], r=null, cs=null;
      try{r=el.getBoundingClientRect();cs=getComputedStyle(el);}catch(e){}
      if(r&&cs&&r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'&&cs.opacity!=='0')visible++;
    }
    return {total:nodes.length, visible:visible};
  }
  function parseConfirmArgs(href){
    var m=(href||'').match(/confirmPopup\s*\(([\s\S]*)\)/);
    if(!m)return null;
    var s=m[1], args=[], cur='', q=null, esc=false;
    for(var i=0;i<s.length;i++){
      var ch=s.charAt(i);
      if(esc){cur+=ch;esc=false;continue;}
      if(ch==='\\'){esc=true;continue;}
      if(q){
        if(ch===q){args.push(cur);cur='';q=null;}
        else cur+=ch;
        continue;
      }
      if(ch==="'"||ch==='"'){q=ch;cur='';continue;}
      if(ch===')'||ch===';')break;
    }
    return args.length>=5?args:null;
  }
  function callConfirmPopupDirect(t){
    var args=parseConfirmArgs(t.element.getAttribute('href')||'');
    if(!args){
      console.log('[매크로] confirmPopup 인자 파싱 실패');
      return false;
    }
    if(typeof window.confirmPopup!=='function'){
      console.log('[매크로] window.confirmPopup 함수 없음');
      return false;
    }
    console.log('[매크로] confirmPopup 직접 호출 시도: '+t.time+' '+t.course+' id='+t.id+' args='+args.length);
    try{
      window.confirmPopup.apply(window,args);
      return true;
    }catch(e){
      console.log('[매크로] confirmPopup 직접 호출 오류: '+(e&&e.message?e.message:e));
      return false;
    }
  }
  function autoTargetAt(job,ref){
    var saved=parseInt(job.targetAt||'0',10);
    if(saved>0)return saved;
    ref=ref||syncedNow();
    var h=job.triggerH!=null?job.triggerH:10,m=job.triggerM!=null?job.triggerM:0;
    return new Date(ref.getFullYear(),ref.getMonth(),ref.getDate(),h,m,0,0).getTime();
  }
  function registerBackgroundSchedule(job){
    if(!job||!job.runId)return;
    var now=syncedNow(),targetAt=autoTargetAt(job,now);
    var browserTargetAt=_now()+Math.max(0,targetAt-now.getTime());
    emitExtensionEvent('SCHEDULE_AUTO10',{runId:job.runId,targetAt:browserTargetAt,serverTargetAt:targetAt,expiresAt:browserTargetAt+AUTO_RECOVERY_MS});
    setTimeout(function(){
      var latest=getJob();
      if(latest.active&&latest.runId===job.runId&&latest.backgroundAlarmOk===undefined){
        var health=document.getElementById('m-health');
        if(health)health.innerHTML='<span style="color:#e65100">● 페이지 복구 감시 작동 (확장 알람 확인 안 됨)</span>';
      }
    },1500);
  }
  function issueDateNavigation(day,source){
    var j=getJob();
    setCmd({refreshAndClick:String(day),runId:j.runId||'',requestedAt:_now(),source:source||'unknown'});
    setJob({phase:'navigating',navigationDay:String(day),navigationStartedAt:_now()});
  }
  function directNavigateToDay(day,source){
    var curUrl=window.location.href;
    var dm=curUrl.match(/targetDate=(\d{6})(\d{2})/);
    if(!dm){
      console.log('[매크로] 직접 이동 실패: URL에 targetDate 없음');
      macroReload();
      return false;
    }
    var j=getJob();
    var prefix=/^\d{6}$/.test(j.targetYm||'')?j.targetYm:dm[1];
    var newDate=prefix+String(day).padStart(2,'0');
    var newUrl=curUrl.replace(/targetDate=\d{8}/,'targetDate='+newDate);
    console.log('[매크로] 달력 응답 없음 → 시간표 직접 복구 ('+(source||'watchdog')+'): '+newDate);
    setJob({phase:'navigating',navigationFallbackAt:_now(),navigationDay:String(day)});
    if(newUrl===curUrl)macroReload();else macroNavigate(newUrl);
    return true;
  }
  function watchDateNavigation(day,delay){
    var runId=(getJob().runId||'');
    setTimeout(function(){
      var j=getJob();
      if(!j.active||j.runId!==runId||j.reserving)return;
      var cmd=getCmd();
      console.log('[매크로] 달력 핸드오프 watchdog: day='+day+' cmd='+JSON.stringify(cmd));
      directNavigateToDay(day,cmd.dateNotFound?'date-not-found':'no-navigation');
    },delay||450);
  }
  function triggerAuto10IfDue(source){
    var j=getJob();
    if(!j.active||j.mode!=='auto10'||j.auto10started||j.phase==='triggered'||j.phase==='navigating'||j.phase==='scanning'||j.phase==='reserving')return false;
    var now=syncedNow(),targetAt=autoTargetAt(j,now);
    // reload 직후 PC 시계만 보고 조기 발동하지 않도록 서버 보정을 아주 짧게 기다린다.
    if(!_tsSynced&&now.getTime()>=(targetAt-15000)){
      var syncWait=parseInt(j.syncWaitStartedAt||'0',10);
      if(!syncWait){setJob({syncWaitStartedAt:_now()});return false;}
      if((_now()-syncWait)<800)return false;
    }
    if(now.getTime()<targetAt)return false;
    var expiresAt=parseInt(j.expiresAt||'0',10)||targetAt+AUTO_RECOVERY_MS;
    if(now.getTime()>expiresAt){
      console.log('[매크로] 자동예약 만료: '+new Date(targetAt).toLocaleString());
      clearJob('expired');
      return false;
    }
    var dates=j.dates||[];
    if(!dates.length){clearJob('no-dates');return false;}
    setJob({auto10started:true,phase:'triggered',targetAt:targetAt,expiresAt:expiresAt,triggeredAt:now.getTime(),triggerSource:source||'timer',courseIdx:0,idx:0,retryCount:0});
    emitExtensionEvent('SCHEDULE_FIRED',{runId:j.runId||'',source:source||'timer'});
    console.log('[매크로:시간표] 목표 시각 도달 ('+(source||'timer')+'), '+dates[0]+'일 이동 시작');
    var statusEl=document.getElementById('m-status');
    if(statusEl)statusEl.innerHTML='<b style="color:#d32f2f;font-size:16px">목표 시각 도달! 달력 새로고침 중...</b>';
    issueDateNavigation(dates[0],source||'timer');
    watchDateNavigation(dates[0],450);
    return true;
  }
  function reserveSlot(t,st,dateLabel,lockRelease){
    var clickKey=(t.date||'')+'|'+t.id+'|'+t.timeRaw;
    if(!lockRelease&&typeof navigator!=='undefined'&&navigator.locks&&navigator.locks.request){
      // runId가 아닌 슬롯 키로 잠가야 서로 다른 탭의 별도 job도 동시에 클릭할 수 없다.
      navigator.locks.request('plazacc-reserve-'+clickKey,{ifAvailable:true},function(lock){
        if(!lock){
          buildUI(st);
          var lockedEl=document.getElementById('m-status');
          if(lockedEl)lockedEl.innerHTML='<b style="color:#e65100">다른 예약 탭에서 이미 실행 중입니다.</b><br>중복 클릭을 막아 이 탭은 대기합니다.';
          return;
        }
        return new Promise(function(resolve){reserveSlot(t,st,dateLabel,resolve);});
      }).catch(function(e){console.log('[매크로] 예약 잠금 오류: '+(e&&e.message||e));});
      return;
    }
    var released=false;
    function releaseAtomicLock(){if(!released&&typeof lockRelease==='function'){released=true;lockRelease();}}

    buildUI(st);
    ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){var button=document.getElementById(id);if(button)button.style.display='none';});
    var reserveStop=document.getElementById('m-stop');if(reserveStop)reserveStop.style.display='block';
    var el=document.getElementById('m-status');
    if(el)el.innerHTML='<b style="color:#2d6a4f;font-size:16px">예약 클릭 시도 중</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업이 뜨면 확인을 눌러주세요.';

    setCmd({});
    var j=getJob();
    if(j.reserving||j.phase==='reserving'){
      console.log('[매크로] 중복 예약 클릭 차단: '+(j.reserveId||''));
      releaseAtomicLock();
      return;
    }
    try{
      var recent=JSON.parse(localStorage.getItem('plazacc-last-click')||'{}');
      if(recent.clickKey===clickKey&&(_now()-(recent.at||0))<60000){
        console.log('[매크로] 최근 동일 슬롯 클릭 차단: '+clickKey);
        if(el)el.innerHTML='<b style="color:#e65100">동일 슬롯을 이미 클릭했습니다.</b><br>60초 동안 중복 예약 요청을 차단합니다.';
        releaseAtomicLock();
        return;
      }
      localStorage.setItem('plazacc-last-click',JSON.stringify({clickKey:clickKey,at:_now(),runId:j.runId||''}));
    }catch(e){}
    setJob({phase:'reserving',reserving:true,reserveStartedAt:_now(),reserveTime:t.time,reserveCourse:t.course,reserveId:t.id,clickKey:clickKey});
    var reserveRunId=j.runId||'';

    var before=getPopupSignals();
    var opened=false;
    var oldOpen=window.open;
    var openWrapper=null;
    try{
      openWrapper=function(){
        opened=true;
        console.log('[매크로] window.open 호출 감지');
        return oldOpen.apply(window,arguments);
      };
      window.open=openWrapper;
    }catch(e){}
    var oldConfirm=window.confirmPopup;
    var confirmCalled=false,confirmWrapper=null;
    try{
      if(typeof oldConfirm==='function'){
        confirmWrapper=function(){confirmCalled=true;return oldConfirm.apply(this,arguments);};
        window.confirmPopup=confirmWrapper;
      }
    }catch(e){}
    function restoreHooks(){
      try{if(window.open===openWrapper)window.open=oldOpen;}catch(e){}
      try{if(confirmWrapper&&window.confirmPopup===confirmWrapper)window.confirmPopup=oldConfirm;}catch(e){}
    }

    console.log('[매크로] 예약 클릭 시도: '+dateLabel+' '+t.time+' '+t.course+' id='+t.id+' popupBefore='+before.visible+'/'+before.total);
    try{
      t.element.click();
    }catch(e){
      console.log('[매크로] 예약 click 오류: '+(e&&e.message?e.message:e));
    }

    setTimeout(function(){
      var activeAttempt=getJob();
      if(!activeAttempt.active||activeAttempt.runId!==reserveRunId||activeAttempt.phase!=='reserving'){
        restoreHooks();releaseAtomicLock();
        console.log('[매크로] 중지된 예약 시도 - 후속 호출 취소');
        return;
      }
      var mid=getPopupSignals();
      if(opened||mid.visible>before.visible){
        restoreHooks();releaseAtomicLock();
        clearJob('popup-opened');setCmd({});
        console.log('[매크로] 예약 팝업 감지 성공 (1차 click)');
        if(el)el.innerHTML='<b style="color:#2d6a4f;font-size:16px">예약 팝업 감지됨</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!';
        beepSuccess();
        return;
      }

      if(confirmCalled){
        console.log('[매크로] confirmPopup 호출 확인됨 - 중복 fallback 호출 생략');
      }else{
        console.log('[매크로] 1차 click에서 confirmPopup 미호출 → 직접 호출 1회');
        callConfirmPopupDirect(t);
      }

      setTimeout(function(){
        var latestAttempt=getJob();
        if(!latestAttempt.active||latestAttempt.runId!==reserveRunId||latestAttempt.phase!=='reserving'){
          restoreHooks();releaseAtomicLock();
          return;
        }
        var after=getPopupSignals();
        restoreHooks();releaseAtomicLock();
        if(opened||after.visible>before.visible){
          clearJob('popup-opened-fallback');setCmd({});
          console.log('[매크로] 예약 팝업 감지 성공 (fallback)');
          if(el)el.innerHTML='<b style="color:#2d6a4f;font-size:16px">예약 팝업 감지됨</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!';
          beepSuccess();
          return;
        }

        console.log('[매크로] 예약 팝업 감지 실패 - 작업 유지, 수동 확인 필요');
        if(el)el.innerHTML='<b style="color:#d32f2f;font-size:16px">예약 클릭 확인 실패</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업이 안 떴으면 같은 슬롯을 직접 눌러주세요.<br><span style="font-size:11px;color:#777">콘솔 로그: 예약 팝업 감지 실패</span>';
        beepWarn();
      },1000);
    },250);
  }

  // === 페이지 로드 시: 진행중인 작업 확인 ===
  var job=getJob();
  if(job.active&&job.mode==='auto10'){
    var restoredTarget=autoTargetAt(job,syncedNow());
    var restoredExpiry=parseInt(job.expiresAt||'0',10)||restoredTarget+AUTO_RECOVERY_MS;
    if(syncedNow().getTime()>restoredExpiry){
      clearJob('expired-before-resume');
      job={};
      console.log('[매크로] 만료된 자동예약 작업을 실행 전에 제거');
    }else if(!job.targetAt||!job.expiresAt||!job.runId){
      setJob({targetAt:restoredTarget,expiresAt:restoredExpiry,runId:job.runId||('legacy-'+_now()+'-'+Math.floor(Math.random()*1000000))});job=getJob();
    }
  }
  if(job.active&&!job.runId){setJob({runId:'legacy-'+_now()+'-'+Math.floor(Math.random()*1000000)});job=getJob();}
  // v24 이전에 시작된 작업도 첫 우선 코스부터 안전하게 이어간다.
  if(job.active&&job.mode==='auto10'&&job.courseIdx===undefined){setJob({courseIdx:0});job=getJob();}
  if(job.active&&job.mode==='auto10'&&job.runId)registerBackgroundSchedule(job);
  var autoArmed=job.active&&job.mode==='auto10'&&!job.auto10started&&(job.phase===undefined||job.phase==='armed');
  if(autoArmed){
    // 새로고침/탭 복원은 대기 상태를 절대 실행 상태로 바꾸지 않는다.
    var migratedTarget=autoTargetAt(job,syncedNow());
    var migratedExpiry=parseInt(job.expiresAt||'0',10)||migratedTarget+AUTO_RECOVERY_MS;
    if(syncedNow().getTime()>migratedExpiry){
      clearJob('expired-on-restore');
      autoArmed=false;job={};
      console.log('[매크로] 만료된 대기 작업 삭제');
    }else{
      if(!job.targetAt)setJob({phase:'armed',targetAt:migratedTarget,expiresAt:migratedExpiry});
      console.log('[매크로] 대기 작업 복구: 목표 전이므로 슬롯 처리 안 함');
    }
  }else if(job.active){
    var st=job.settings||loadWithDefaults();
    if(job.reserving||job.phase==='reserving'){
      buildUI(st);
      var reservingEl=document.getElementById('m-status');
      if(reservingEl)reservingEl.innerHTML='<b style="color:#e65100">이미 예약 클릭을 시도했습니다.</b><br>'+String(job.reserveTime||'')+' '+cn(job.reserveCourse||'')+'<br>중복 클릭을 막기 위해 자동 재클릭하지 않습니다. 팝업을 확인하세요.';
      return;
    }
    // 슬롯은 detectPage에서 이미 확인됨 → 바로 스캔
    var slots=scanSlots();
    var dates=job.dates||[];
    var currentIdx=job.idx||0;
    var expectedDate=dates[currentIdx];
    var pageDate=currentDateFromUrl;
    var expectedFullDate=job.targetYm&&expectedDate?job.targetYm+String(expectedDate).padStart(2,'0'):'';
    var pageFullDate=currentFullDateFromUrl;
    if(!pageDate&&slots.length&&slots[0].date)pageDate=String(parseInt(slots[0].date.substring(6,8),10));
    if(!pageFullDate&&slots.length&&slots[0].date)pageFullDate=slots[0].date;

    // 달력 명령이 실패해 이전 날짜 시간표가 남아도 엉뚱한 날짜를 예약하지 않는다.
    if(expectedDate&&pageDate&&(String(expectedDate)!==String(pageDate)||(expectedFullDate&&pageFullDate&&expectedFullDate!==pageFullDate))){
      buildUI(st);
      var mismatchEl=document.getElementById('m-status');
      if(mismatchEl)mismatchEl.innerHTML='<b style="color:#e65100">날짜 이동 복구 중...</b><br>현재 '+pageDate+'일 → 목표 '+expectedDate+'일';
      console.log('[매크로] 목표 날짜 불일치 차단: current='+(pageFullDate||pageDate)+' expected='+(expectedFullDate||expectedDate));
      issueDateNavigation(expectedDate,'date-mismatch');
      watchDateNavigation(expectedDate,450);
      return;
    }

    setCmd({});
    setJob({phase:'scanning',lastScanAt:_now()});
    var targetCourse=job.mode==='auto10'?COURSE_ORDER[job.courseIdx||0]:'';
    var matched=filterAndSort(slots,st,targetCourse);
    console.log('[매크로] 작업처리: '+(targetCourse?cn(targetCourse)+' / ':'')+'슬롯 '+slots.length+'개, 매칭 '+matched.length+'개');
    var dateLabel='';
    if(slots.length>0&&slots[0].date)dateLabel=fmtDate(slots[0].date);

    // 매칭 발견 → 예약 클릭. 클릭 성공 전 clearJob 금지.
    if(job.autoClick&&matched.length>0){
      var t=matched[0];
      reserveSlot(t,st,dateLabel);
      return;
    }

    // auto10: 코스/날짜 조합별 총 3회(최초 1 + 재조회 2) 확인한다.
    if(job.mode==='auto10'){
      var retries=job.retryCount||0;
      if(retries<MAX_SCAN_RETRIES){
        setJob({phase:'scanning',retryCount:retries+1});
        console.log('[매크로] auto10 '+cn(targetCourse)+' 매칭없음 (슬롯:'+slots.length+'/매칭:'+matched.length+'), 재조회 '+(retries+1)+'/'+MAX_SCAN_RETRIES);
        buildUI(st);
        var elR=document.getElementById('m-status');
        if(elR)elR.innerHTML='<b style="color:#e65100">'+cn(targetCourse)+' 슬롯 확인 중...</b> '+(retries+2)+'/3회차<br>현재 슬롯 '+slots.length+'개, 매칭 '+matched.length+'개<br><span style="font-size:11px">코스/날짜 조합별 총 3회 확인</span>';
        document.getElementById('m-stop').style.display='block';
        ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
        setTimeout(function(){
          var latest=getJob();
          if(latest.active&&latest.mode==='auto10'&&!latest.reserving)macroReload();
        },SCAN_RETRY_MS);
        return;
      }
      console.log('[매크로] auto10 '+cn(targetCourse)+' 총 3회 확인 완료, 다음 조합으로');
      setJob({retryCount:0});
    }

    // 매칭 없음 → 다음 날짜. 현재 코스의 날짜를 다 보면 다음 코스의 첫 날짜로.
    var idx=(job.idx||0)+1;
    var courseIdx=job.courseIdx||0;

    // 취소표 감시: 끝까지 갔으면 처음으로
    if(job.mode==='cancel'&&idx>=dates.length){
      idx=0;
    }

    if(job.mode==='auto10'&&idx>=dates.length){
      idx=0;
      courseIdx++;
    }

    // 10시 자동: 모든 코스의 모든 날짜 소진
    if(job.mode==='auto10'&&courseIdx>=COURSE_ORDER.length){
      clearJob('no-matching-slots');setCmd({});
      buildUI(st);
      var el2=document.getElementById('m-status');
      if(el2)el2.innerHTML='<span style="color:red">모든 코스와 목표 날짜에서 매칭 슬롯을 찾지 못했습니다.</span><br>(각 코스/날짜 조합 총 3회 확인 완료)';
      return;
    }

    // 다음 날짜로 이동
    var nextDate=dates[idx];
    setJob({idx:idx,courseIdx:courseIdx});

    if(job.mode==='cancel'&&nextDate===currentDateFromUrl){
      // 취소표 감시: 같은 날짜 → 3초 후 시간표 자체 새로고침
      buildUI(st);
      var el3=document.getElementById('m-status');
      if(el3)el3.innerHTML='<b style="color:#6a1b9a">취소표 감시</b> '+nextDate+'일 매칭없음, 3초 후 재확인...';
      document.getElementById('m-stop').style.display='block';
      ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
      (function(runId){
        setTimeout(function(){
          var latest=getJob();
          if(latest.active&&latest.runId===runId&&latest.mode==='cancel')macroReload();
        },3000);
      })(job.runId);
    }else{
      // 다른 날짜 → 달력에 명령 (refreshAndClick: 새로고침 후 클릭, 재시도 내장)
      issueDateNavigation(nextDate,'next-date');
      buildUI(st);
      var modeLabel={'auto10':'10시 자동예약','cancel':'취소표 감시'}[job.mode]||job.mode;
      var color={'auto10':'#e65100','cancel':'#6a1b9a'}[job.mode]||'#333';
      var el4=document.getElementById('m-status');
      var courseProgress=job.mode==='auto10'?cn(COURSE_ORDER[courseIdx])+' / ':'';
      if(el4)el4.innerHTML='<b style="color:'+color+'">'+modeLabel+'</b> '+courseProgress+nextDate+'일 확인 중 ('+(idx+1)+'/'+dates.length+')';
      document.getElementById('m-stop').style.display='block';
      ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
      // 달력 DOM/onclick 변경에도 시간표 URL 직접 이동으로 복구한다.
      watchDateNavigation(nextDate,450);
    }
    return;
  }

  // === 자동: 시간표 iframe에서 카운트다운 (크롬 쓰로틀링 방지) ===
  var _countdownRunning=false;
  function startAuto10Countdown(){
    if(_countdownRunning) return; // 중복 방지
    var job=getJob();
    if(!job.active||job.mode!=='auto10'||job.auto10started) return;
    if(triggerAuto10IfDue('countdown-resume'))return;
    _countdownRunning=true;
    var tH=job.triggerH!=null?job.triggerH:10, tM=job.triggerM!=null?job.triggerM:0;
    var targetLabel=String(tH).padStart(2,'0')+':'+String(tM).padStart(2,'0');
    var ref=syncedNow();
    var targetMs=autoTargetAt(job,ref);
    console.log('[매크로:시간표] 카운트다운 시작 - target:'+targetLabel+' targetMs:'+targetMs+' now:'+ref.getTime()+' diff:'+(targetMs-ref.getTime())+'ms');
    var lastSec=-1;
    var interval=setInterval(function(){
      var j=getJob();
      if(!j.active||j.mode!=='auto10'){clearInterval(interval);_countdownRunning=false;return;}
      if(j.auto10started){clearInterval(interval);_countdownRunning=false;return;}
      var now=syncedNow();
      var nowMs=now.getTime();
      var remaining=targetMs-nowMs;

      // 1초마다 화면에 잔여시간 표시 (살아있음 확인용)
      var curSec=Math.floor(nowMs/1000);
      if(curSec!==lastSec){
        lastSec=curSec;
        var el=document.getElementById('m-status');
        if(el&&remaining>0){
          var rs=Math.ceil(remaining/1000); var rm=Math.floor(rs/60); rs=rs%60;
          el.innerHTML='<b style="color:#e65100">'+targetLabel+' 자동예약 대기</b><br>'+
            '<span style="font-size:20px;font-weight:bold;color:#d32f2f">'+rm+'분 '+String(rs).padStart(2,'0')+'초 남음</span><br>'+
            (j.dates||[]).join(',')+'일 / '+String((j.settings||{}).timeFrom||'10').padStart(2,'0')+'~'+String((j.settings||{}).timeTo||'14').padStart(2,'0')+'시<br>'+
            '<span style="color:#2d6a4f;font-size:11px">카운트다운 작동 중 (보정:'+(_tsOffset>0?'+':'')+(_tsOffset/1000).toFixed(1)+'초)</span>';
        }
      }

      // 목표 시각 도달! 큰 시간 점프(절전/쓰로틀링) 후에도 now>=target으로 복구한다.
      if(nowMs>=targetMs){
        var actualTime=now.getHours()+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0')+'.'+String(now.getMilliseconds()).padStart(3,'0');
        console.log('[매크로:시간표] '+targetLabel+' 도달! 실제:'+actualTime+' 오차:'+(nowMs-targetMs)+'ms');
        // 서버시간 sync wait가 false를 반환하면 interval을 유지해 다음 100ms에 재검사한다.
        if(triggerAuto10IfDue('countdown')){
          clearInterval(interval);_countdownRunning=false;
        }
      }
    },100);
  }
  startAuto10Countdown();

  function wakeCheck(source){
    if(triggerAuto10IfDue(source))return;
    startAuto10Countdown();
  }
  // 탭 포커스/절전 복귀 시 _countdownRunning 여부와 무관하게 즉시 due 판정.
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)wakeCheck('visibility');
  });
  window.addEventListener('pageshow',function(){wakeCheck('pageshow');});
  window.addEventListener('focus',function(){wakeCheck('focus');});
  window.addEventListener('online',function(){wakeCheck('online');});
  window.addEventListener('plazacc:background',function(ev){
    var msg={};try{msg=JSON.parse(ev.detail||'{}');}catch(e){}
    var j=getJob();
    if(msg.runId&&j.runId&&msg.runId!==j.runId)return;
    if(msg.type==='PREPARE_AUTO10'){
      _reSyncDone=true;
      doSyncTime('백그라운드 사전점검');
      wakeCheck('background-prepare');
    }else if(msg.type==='TRIGGER_AUTO10'){
      wakeCheck('background-alarm');
    }else if(msg.type==='RECOVER_AUTO10'){
      if(j.phase==='navigating'||j.phase==='triggered'){
        directNavigateToDay(j.navigationDay||(j.dates||[])[j.idx||0],'background-recovery');
      }else if(j.phase==='scanning'&&!j.reserving&&(_now()-(j.lastScanAt||0))>2000){
        macroReload();
      }else if(j.phase==='armed'){
        wakeCheck('background-recovery');
      }
    }else if(msg.type==='EXTENSION_STATUS'&&msg.action==='SCHEDULE_AUTO10'){
      setJob({backgroundAlarmOk:msg.ok===true,backgroundAlarmCheckedAt:_now(),backgroundAlarmError:msg.error||''});
      var health=document.getElementById('m-health');
      if(health)health.innerHTML=msg.ok?'<span style="color:#2d6a4f">● 확장 알람 이중 감시 정상</span>':'<span style="color:#d32f2f">● 확장 알람 등록 실패 - 페이지 타이머로 복구</span>';
    }
  });

  // === 작업 없음: 일반 UI ===
  var st=(job.active&&job.settings)||loadWithDefaults();
  buildUI(st);
  if(autoArmed){
    ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
    var stopEl=document.getElementById('m-stop');if(stopEl)stopEl.style.display='block';
  }

  function buildUI(s){
    if(document.getElementById('plazacc-macro-panel'))return;
    var p=document.createElement('div');
    p.id='plazacc-macro-panel';
    p.style.cssText='position:fixed;top:5px;right:5px;width:320px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;max-height:95vh;overflow-y:auto;';
    p.innerHTML=
      '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v'+MACRO_VERSION+'</div>'+
      '<div style="padding:12px">'+
      '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
      '<div style="text-align:center;font-size:11px;color:#999;margin-top:2px" id="m-sync">시간 보정 중...</div>'+
      '<div style="text-align:center;font-size:11px;color:#999;margin-top:2px" id="m-health">확장 알람 대기 중</div>'+
      '<div style="margin:8px 0;padding:8px;background:#fff3e0;border-radius:6px;border:1px solid #ffcc02">'+
      '<b>목표 날짜</b> <span style="color:#888;font-size:11px">(10시자동/취소감시용)</span><br>'+
      '<input type="text" id="m-dates" value="'+(s.targetDates||'')+'" placeholder="예: 13,14,15" style="padding:6px;font-size:15px;width:95%;margin-top:4px;border:1px solid #ccc;border-radius:4px">'+
      '<div id="m-date-preview" style="margin-top:4px;font-size:11px;color:#d32f2f;line-height:1.4"></div>'+
      '<div style="margin-top:4px;color:#2d6a4f"><label><input type="checkbox" id="m-autorefresh" checked disabled>10시 달력 자동 새로고침 (필수)</label></div>'+
      '</div>'+
      '<div style="margin:8px 0"><b>시간 범위</b><br>'+
      '<select id="m-from" style="padding:4px;font-size:14px">'+timeOptions(s.timeFrom)+'</select>'+
      ' ~ <select id="m-to" style="padding:4px;font-size:14px">'+timeOptions(s.timeTo)+'</select></div>'+
      '<div style="margin:8px 0;padding:6px;background:#e8f5e9;border-radius:4px;font-size:12px"><b>코스 우선순위</b> (고정): 타이거OUT → IN → 라이온OUT → IN</div>'+
      '<div style="display:flex;gap:6px;margin-top:10px">'+
      '<button id="m-scan" style="flex:1;padding:10px 4px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">스캔</button>'+
      '<button id="m-auto10" style="flex:1;padding:10px 4px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">10시자동</button>'+
      '<button id="m-cancel" style="flex:1;padding:10px 4px;background:#6a1b9a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">취소감시</button>'+
      '<button id="m-test" style="flex:1;padding:10px 4px;background:#ff6f00;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;white-space:nowrap">1분후<br>테스트</button></div>'+
      '<button id="m-stop" style="width:100%;padding:12px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none;margin-top:6px">중지</button>'+
      '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5;max-height:300px;overflow-y:auto">설정 후 버튼을 누르세요.</div>'+
      '</div>';
    document.body.appendChild(p);

    setInterval(function(){
      var n=syncedNow();
      var el=document.getElementById('m-clock');
      if(el)el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');
      var syncEl=document.getElementById('m-sync');
      if(syncEl){
        if(_tsSynced){
          var sec=(_tsOffset/1000).toFixed(1);
          syncEl.innerHTML='<span style="color:#2d6a4f">서버 시간 보정됨 ('+(_tsOffset>0?'+':'')+sec+'초)</span>';
        }else{
          syncEl.textContent='시간 보정 중...';
        }
      }
    },200);
    var hdr=document.getElementById('m-header');var dragging=false,dx,dy;
    hdr.onmousedown=function(e){dragging=true;dx=e.clientX-p.getBoundingClientRect().left;dy=e.clientY-p.getBoundingClientRect().top;};
    document.onmousemove=function(e){if(!dragging)return;p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';};
    document.onmouseup=function(){dragging=false;};

    function gs(){return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,targetDates:document.getElementById('m-dates').value.trim(),autoRefresh:true};}
    function ss(html){document.getElementById('m-status').innerHTML=html;}
    function showBtns(show){
      ['m-auto10','m-cancel','m-scan','m-test'].forEach(function(id){document.getElementById(id).style.display=show?'':'none';});
      document.getElementById('m-stop').style.display=show?'none':'block';
    }
    function dateLabelList(dates){return dates.map(function(d){return d+'일';}).join(', ');}
    function refreshDatePreview(){
      var st=gs(), dates=parseDates(st), el=document.getElementById('m-date-preview');
      if(!el)return;
      if(dates.length===0){el.textContent='매주 월요일마다 이번 예약 날짜를 새로 입력하세요.';return;}
      el.textContent='이번 실행 목표: '+dateLabelList(dates)+' - 맞는지 확인 후 실행하세요.';
    }
    function confirmTargetDates(mode,dates){
      var modeLabel={'auto10':'10시자동','cancel':'취소감시'}[mode]||mode;
      var monthLabel=currentFullDateFromUrl?currentFullDateFromUrl.substring(0,4)+'년 '+parseInt(currentFullDateFromUrl.substring(4,6),10)+'월':'현재 달력 월';
      return window.confirm(modeLabel+' 실행 전 확인\n\n예약 월: '+monthLabel+'\n목표 날짜: '+dateLabelList(dates)+'\n\n이번 주 예약할 날짜가 맞습니까?\n월이나 날짜가 다르면 취소하고 예약할 달의 시간표를 먼저 여세요.');
    }

    function startJob(mode,dates,st,triggerH,triggerM,explicitTargetAt){
      save(st);
      var tH=triggerH!=null?triggerH:10, tM=triggerM!=null?triggerM:0;
      var now=syncedNow();
      var targetAt=explicitTargetAt||new Date(now.getFullYear(),now.getMonth(),now.getDate(),tH,tM,0,0).getTime();
      if(mode==='auto10'&&now.getTime()>targetAt+AUTO_RECOVERY_MS){
        ss('<span style="color:#d32f2f"><b>오늘 '+String(tH).padStart(2,'0')+':'+String(tM).padStart(2,'0')+' 자동예약 시간이 지났습니다.</b></span><br>30분이 지난 작업은 잘못된 날짜 클릭을 막기 위해 시작하지 않습니다.');
        return;
      }
      var runId='run-'+_now()+'-'+Math.floor(Math.random()*1000000);
      var targetYm=currentFullDateFromUrl?currentFullDateFromUrl.substring(0,6):'';
      var newJob={active:true,runId:runId,mode:mode,phase:mode==='auto10'?'armed':'scanning',dates:dates,targetYm:targetYm,idx:0,courseIdx:0,results:[],autoClick:true,settings:st,autoRefresh:true,auto10started:false,triggerH:tH,triggerM:tM,targetAt:targetAt,expiresAt:targetAt+AUTO_RECOVERY_MS,armedAt:now.getTime(),retryCount:0};
      replaceJob(newJob);
      if(mode==='auto10'){
        var targetLabel=String(tH).padStart(2,'0')+':'+String(tM).padStart(2,'0');
        var pastTarget=now.getTime()>=targetAt;
        // service worker 알람은 PC 시계 epoch로 예약하고, 페이지 타이머는 서버 보정 시각을 사용한다.
        registerBackgroundSchedule(newJob);
        ss('<b style="color:#e65100">'+targetLabel+' 자동예약'+(pastTarget?' (즉시 시작)':' 대기 중')+'</b><br>'+
           dates.join(',')+'일 / '+String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시<br>'+
           (pastTarget?'놓친 시각을 자동 복구합니다.':'<b>'+targetLabel+'</b>에 자동으로 시작됩니다.<br><span style="color:#2d6a4f">확장 알람 등록 확인 중</span>'));
        if(pastTarget)triggerAuto10IfDue('manual-catchup');
      }else{
        // 취소감시: 현재 페이지가 목표 날짜면 바로 reload, 아니면 달력에 명령
        if(dates[0]===currentDateFromUrl){
          ss('<b style="color:#6a1b9a">취소표 감시 시작</b><br>'+dates[0]+'일 확인 중...<br><span style="color:#888;font-size:11px">페이지 이탈 시 자동 중지</span>');
          setTimeout(function(){
            var latest=getJob();
            if(latest.active&&latest.runId===runId&&latest.mode==='cancel')macroReload();
          },500);
        }else{
          issueDateNavigation(dates[0],'cancel-start');
          ss('<b style="color:#6a1b9a">취소표 감시 시작</b><br>'+dates[0]+'일 확인 중 (1/'+dates.length+')<br><span style="color:#888;font-size:11px">페이지 이탈 시 자동 중지</span>');
          watchDateNavigation(dates[0],450);
        }
      }
      showBtns(false);
      p.style.borderColor=mode==='auto10'?'#e65100':'#6a1b9a';
      if(mode==='auto10') startAuto10Countdown();
    }

    // 스캔 (수동 테스트)
    document.getElementById('m-scan').onclick=function(){
      var st=gs();
      if(!validateSettings(st))return;
      save(st);
      var slots=scanSlots();
      var matched=filterAndSort(slots,st);
      var html='<b>전체: '+slots.length+'개</b>, 매칭: <b style="color:#d32f2f">'+matched.length+'개</b><br>';
      if(slots.length===0){html+='<span style="color:red">예약가능 슬롯 없음</span>';}
      matched.forEach(function(x){
        html+='<span style="color:'+(x.course.indexOf('T-')===0?'#2d6a4f':'#1565c0')+'">'+x.time+' '+cn(x.course)+'</span><br>';
      });
      if(matched.length===0&&slots.length>0)html+='<span style="color:orange">조건에 맞는 슬롯 없음</span>';
      ss(html);
    };

    // 날짜 입력 파싱: "09"→"9", "13"→"13" (달력 텍스트와 일치시키기 위해 leading zero 제거)
    function targetMonthMaxDay(){
      var maxDay=31;
      if(/^\d{6}$/.test(currentFullDateFromUrl.substring(0,6))){
        var y=parseInt(currentFullDateFromUrl.substring(0,4),10);
        var m=parseInt(currentFullDateFromUrl.substring(4,6),10);
        maxDay=new Date(y,m,0).getDate();
      }
      return maxDay;
    }
    function parseDates(st){
      var seen={},maxDay=targetMonthMaxDay();
      return(st.targetDates||'').split(',').map(function(x){
        x=x.trim();if(!/^\d{1,2}$/.test(x))return'';
        var n=parseInt(x,10);return n>=1&&n<=maxDay?String(n):'';
      }).filter(function(x){if(!x||seen[x])return false;seen[x]=true;return true;});
    }
    function validateSettings(st){
      var from=parseInt(st.timeFrom,10),to=parseInt(st.timeTo,10);
      if(isNaN(from)||isNaN(to)||from>=to){
        ss('<span style="color:red">시간 범위를 확인하세요. 시작 시간은 종료 시간보다 빨라야 합니다.</span>');
        return false;
      }
      return true;
    }
    function validateTargets(st,targets){
      var raw=(st.targetDates||'').split(',').map(function(x){return x.trim();}).filter(function(x){return x!=='';});
      var maxDay=targetMonthMaxDay();
      var invalid=raw.some(function(x){
        if(!/^\d{1,2}$/.test(x))return true;
        var n=parseInt(x,10);return n<1||n>maxDay;
      });
      if(invalid){
        var month=currentFullDateFromUrl?parseInt(currentFullDateFromUrl.substring(4,6),10)+'월':'현재 월';
        ss('<span style="color:red">'+month+'에 존재하는 날짜만 입력하세요. (1~'+maxDay+'일)</span>');
        return false;
      }
      if(targets.length===0){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return false;}
      return true;
    }
    document.getElementById('m-dates').oninput=refreshDatePreview;
    refreshDatePreview();

    document.getElementById('m-auto10').onclick=function(){
      var st=gs();
      if(!validateSettings(st))return;
      var targets=parseDates(st);
      if(!validateTargets(st,targets))return;
      if(!confirmTargetDates('auto10',targets))return;
      startJob('auto10',targets,st);
    };

    document.getElementById('m-test').onclick=function(){
      var st=gs();
      if(!validateSettings(st))return;
      var targets=parseDates(st);
      if(!validateTargets(st,targets))return;
      if(!confirmTargetDates('auto10',targets))return;
      var now=syncedNow();
      var testM=now.getMinutes()+1;
      var testH=now.getHours();
      if(testM>=60){testM=0;testH=(testH+1)%24;}
      var testTarget=new Date(now.getFullYear(),now.getMonth(),now.getDate(),now.getHours(),now.getMinutes()+1,0,0).getTime();
      startJob('auto10',targets,st,testH,testM,testTarget);
    };

    document.getElementById('m-cancel').onclick=function(){
      var st=gs();
      if(!validateSettings(st))return;
      var targets=parseDates(st);
      if(!validateTargets(st,targets))return;
      if(!confirmTargetDates('cancel',targets))return;
      startJob('cancel',targets,st);
    };

    document.getElementById('m-stop').onclick=function(){
      clearJob('user-stop');
      showBtns(true);
      p.style.borderColor='#2d6a4f';
      ss('중지됨');
    };

  }

  console.log('[매크로 v'+MACRO_VERSION+'] 시간표 초기화 완료, 슬롯 '+scanSlots().length+'개');
}
})();
