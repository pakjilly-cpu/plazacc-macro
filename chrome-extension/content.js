// 플라자CC 매크로 v14 - 서버/PC 시간 비교 표시 + Date.now 오버라이드 방어
(function(){
'use strict';

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
    var handled = false;
    xhr.onreadystatechange = function(){
      if(handled) return;
      if(xhr.readyState < 2) return; // HEADERS_RECEIVED 이상
      var dateStr = null;
      try{ dateStr = xhr.getResponseHeader('Date'); }catch(e){}
      if(!dateStr) return;
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
    xhr.onerror = function(){
      done++;
      if(done < total){ setTimeout(sample, 150); }
      else if(best){
        _tsOffset = best.offset;
        _tsSynced = true;
        console.log('[매크로] '+(label||'시간보정')+' 완료(일부): ' + (_tsOffset>0?'+':'') + (_tsOffset/1000).toFixed(1) + '초');
      } else {
        console.log('[매크로] '+(label||'시간보정')+' 실패, PC 시간 사용');
      }
    };
    xhr.send();
  }
  sample();
}
// 페이지 로드 시 1차 측정
doSyncTime('초기보정');

// 9:59:50에 자동 재측정 (10시 정각 직전 최신 오프셋 확보)
var _reSyncDone = false;
setInterval(function(){
  if(_reSyncDone) return;
  var pc = new Date();
  if(pc.getHours()===9 && pc.getMinutes()===59 && pc.getSeconds()>=50){
    _reSyncDone = true;
    console.log('[매크로] 9:59:50 직전 재보정 시작');
    doSyncTime('직전재보정');
  }
}, 1000);

// 페이지 감지: 100ms 간격 폴링
(function detectPage(n){
  var isTimeTable = !!document.querySelector('a[href*="confirmPopup"]');
  var isCalendar = !isTimeTable && !!document.querySelector('img[alt*="일자 선택"]');
  if(isTimeTable){ initTimeTable(); return; }
  if(isCalendar){ initCalendar(); return; }
  var hasJob = false;
  try{ hasJob = !!(JSON.parse(localStorage.getItem('plazacc-job'))||{}).active; }catch(e){}
  var maxTries = hasJob ? 100 : 20; // 작업중이면 10초, 아니면 2초
  if(n < maxTries){ setTimeout(function(){ detectPage(n+1); }, 100); }
})(0);

// ===== 공용 스토리지 =====
function load(){try{var v=JSON.parse(localStorage.getItem('plazacc-s'));return(v&&typeof v==='object')?v:{};}catch(e){return{};}}
function save(s){if(s&&typeof s==='object')try{localStorage.setItem('plazacc-s',JSON.stringify(s));}catch(e){}}
function defaults(){return{timeFrom:'10',timeTo:'14',course:'T-OUT-first',targetDates:'',autoRefresh:true};}
function loadWithDefaults(){var d=defaults();var s=load();for(var k in d){if(s[k]===undefined)s[k]=d[k];}return s;}

// 작업 상태
function getJob(){try{return JSON.parse(localStorage.getItem('plazacc-job'))||{};}catch(e){return{};}}
function setJob(o){try{var j=getJob();for(var k in o)j[k]=o[k];localStorage.setItem('plazacc-job',JSON.stringify(j));}catch(e){}}
function clearJob(){try{localStorage.removeItem('plazacc-job');}catch(e){}}

// 달력 통신
function getCmd(){try{return JSON.parse(localStorage.getItem('plazacc-cmd'))||{};}catch(e){return{};}}
function setCmd(o){try{localStorage.setItem('plazacc-cmd',JSON.stringify(o));}catch(e){}}

// ===== 달력 iframe =====
function initCalendar(){
  console.log('[매크로] 달력');

  function getClickableDates(){
    var d=[];var links=document.querySelectorAll('a[href="#none"]');
    for(var i=0;i<links.length;i++){var t=links[i].textContent.trim();if(t.match(/^\d{1,2}$/))d.push(t);}
    return d;
  }
  function clickDate(d){
    var links=document.querySelectorAll('a[href="#none"]');
    for(var i=0;i<links.length;i++){if(links[i].textContent.trim()===d){links[i].click();console.log('[매크로] 날짜 '+d);return true;}}
    return false;
  }
  function clickRefresh(){
    var btns=document.querySelectorAll('a, button');
    for(var i=0;i<btns.length;i++){
      var t=btns[i].textContent.trim();var img=btns[i].querySelector('img');var alt=img?img.getAttribute('alt')||'':'';
      if(t==='새로고침'||alt==='새로고침'){btns[i].click();console.log('[매크로] 새로고침');return;}
    }
  }

  // 100ms 간격으로 명령 체크 (빠른 반응)
  setInterval(function(){
    var cmd=getCmd();

    if(cmd.getDates){setCmd({dates:getClickableDates().join(',')});return;}

    if(cmd.click){
      var d=cmd.click;
      setCmd({clicking:true});
      clickDate(d);
      setTimeout(function(){setCmd({});},200);
      return;
    }

    if(cmd.refreshAndClick){
      var d2=cmd.refreshAndClick;
      setCmd({clicking:true});
      clickRefresh();
      (function waitClick(n){
        if(clickDate(d2)){setCmd({});return;}
        if(n<50)setTimeout(function(){waitClick(n+1);},100);
        else setCmd({});
      })(0);
      return;
    }

    // 10시 자동 새로고침
    var job=getJob();
    if(job.active&&job.mode==='auto10'){
      var now=syncedNow();
      if(now.getSeconds()%10===0)console.log('[매크로:달력] 10시대기 체크(보정됨) - offset:'+_tsOffset+'ms autoRefresh:'+job.autoRefresh+' auto10started:'+job.auto10started+' 시각:'+now.getHours()+':'+now.getMinutes()+':'+now.getSeconds());
      if(job.autoRefresh&&!job.auto10started&&now.getHours()===10&&now.getMinutes()===0&&now.getSeconds()<=5){
        setJob({auto10started:true});
        clickRefresh();
        var dates=job.dates||[];
        if(dates.length>0){
          (function waitClick(n){
            if(clickDate(dates[0]))return;
            if(n<100)setTimeout(function(){waitClick(n+1);},100);
          })(0);
        }
      }
    }
  },100);
}

// ===== 시간표 iframe =====
function initTimeTable(){
  if(document.getElementById('plazacc-macro-panel'))return;
  console.log('[매크로] 시간표');

  // 현재 시간표의 날짜 (URL에서 추출)
  var currentDateFromUrl = '';
  try{
    var dm = window.location.href.match(/targetDate=(\d{6,8})/);
    if(dm) currentDateFromUrl = dm[1].substring(6,8).replace(/^0/,''); // '20260408' → '8'
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
  // 코스 우선순위 고정: T-OUT → T-IN → L-OUT → L-IN
  var courseOrder={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
  function filterAndSort(slots,s){
    var from=parseInt(s.timeFrom)*60,to=parseInt(s.timeTo)*60;
    var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<to;});
    f.sort(function(a,b){var ca=courseOrder[a.course]!=null?courseOrder[a.course]:9;var cb=courseOrder[b.course]!=null?courseOrder[b.course]:9;return ca!==cb?ca-cb:timeToMin(a.time)-timeToMin(b.time);});
    return f;
  }
  function beepSuccess(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.15,0.3,0.45,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=d<0.3?880:1100;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.1);});}catch(e){}}
  function timeOptions(sel){var h='';for(var i=6;i<=19;i++){var v=String(i);h+='<option value="'+v+'"'+(v===sel?' selected':'')+'>'+String(i).padStart(2,'0')+'시</option>';}return h;}

  // === 페이지 로드 시: 진행중인 작업 확인 ===
  var job=getJob();
  if(job.active){
    var st=job.settings||loadWithDefaults();
    // 슬롯은 detectPage에서 이미 확인됨 → 바로 스캔
    var slots=scanSlots();
    var matched=filterAndSort(slots,st);
    console.log('[매크로] 작업처리: 슬롯 '+slots.length+'개, 매칭 '+matched.length+'개');
    var dateLabel='';
    if(slots.length>0&&slots[0].date)dateLabel=fmtDate(slots[0].date);

    // 매칭 발견 → 즉시 클릭 (지연 없음!)
    if(job.autoClick&&matched.length>0){
      var t=matched[0];
      clearJob();
      setCmd({});
      buildUI(st);
      var el=document.getElementById('m-status');
      if(el)el.innerHTML='<b style="color:#2d6a4f;font-size:16px">예약 클릭!</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!';
      t.element.click();
      beepSuccess();
      return;
    }

    // 매칭 없음 → 다음 단계
    var dates=job.dates||[];
    var idx=(job.idx||0)+1;

    // 취소표 감시: 끝까지 갔으면 처음으로
    if(job.mode==='cancel'&&idx>=dates.length){
      idx=0;
    }

    // 10시 자동: 모든 날짜 소진
    if(job.mode==='auto10'&&idx>=dates.length){
      clearJob();setCmd({});
      buildUI(st);
      var el2=document.getElementById('m-status');
      if(el2)el2.innerHTML='<span style="color:red">모든 목표 날짜에서 매칭 슬롯을 찾지 못했습니다.</span>';
      return;
    }

    // 다음 날짜로 이동
    var nextDate=dates[idx];
    setJob({idx:idx});

    if(job.mode==='cancel'&&nextDate===currentDateFromUrl){
      // 취소표 감시: 같은 날짜 → 3초 후 시간표 자체 새로고침
      buildUI(st);
      var el3=document.getElementById('m-status');
      if(el3)el3.innerHTML='<b style="color:#6a1b9a">취소표 감시</b> '+nextDate+'일 매칭없음, 3초 후 재확인...';
      document.getElementById('m-stop').style.display='block';
      ['m-auto10','m-cancel','m-scan'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
      setTimeout(function(){ window.location.reload(); },3000);
    }else{
      // 다른 날짜 → 달력에 명령
      setCmd({click:nextDate});
      buildUI(st);
      var modeLabel={'auto10':'10시 자동예약','cancel':'취소표 감시'}[job.mode]||job.mode;
      var color={'auto10':'#e65100','cancel':'#6a1b9a'}[job.mode]||'#333';
      var el4=document.getElementById('m-status');
      if(el4)el4.innerHTML='<b style="color:'+color+'">'+modeLabel+'</b> '+nextDate+'일 확인 중 ('+(idx+1)+'/'+dates.length+')';
      document.getElementById('m-stop').style.display='block';
      ['m-auto10','m-cancel','m-scan'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
    }
    return;
  }

  // === 10시 자동: 시간표 iframe에서 카운트다운 (크롬 쓰로틀링 방지) ===
  (function auto10countdown(){
    var job=getJob();
    if(!job.active||job.mode!=='auto10'||job.auto10started) return;
    var interval=setInterval(function(){
      var j=getJob();
      if(!j.active||j.mode!=='auto10'){clearInterval(interval);return;}
      if(j.auto10started){clearInterval(interval);return;}
      var now=syncedNow();
      if(now.getHours()===10&&now.getMinutes()===0&&now.getSeconds()<=5){
        clearInterval(interval);
        setJob({auto10started:true});
        console.log('[매크로:시간표] 10시 도달! 목표날짜로 이동');
        // 현재 시간표 URL의 targetDate를 목표 날짜로 교체하여 직접 이동
        var dates=j.dates||[];
        if(dates.length>0){
          var curUrl=window.location.href;
          var dm=curUrl.match(/targetDate=(\d{6})\d{2}/);
          if(dm){
            var prefix=dm[1]; // YYYYMM
            var newDate=prefix+String(dates[0]).padStart(2,'0');
            var newUrl=curUrl.replace(/targetDate=\d{6,8}/,'targetDate='+newDate);
            window.location.href=newUrl;
          }else{
            // URL에 targetDate 없으면 페이지 새로고침으로 폴백
            window.location.reload();
          }
        }
      }
    },100);
  })();

  // === 작업 없음: 일반 UI ===
  var st=loadWithDefaults();
  buildUI(st);

  function buildUI(s){
    if(document.getElementById('plazacc-macro-panel'))return;
    var p=document.createElement('div');
    p.id='plazacc-macro-panel';
    p.style.cssText='position:fixed;top:5px;right:5px;width:320px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;max-height:95vh;overflow-y:auto;';
    p.innerHTML=
      '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v14</div>'+
      '<div style="padding:12px">'+
      '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
      '<div style="text-align:center;font-size:11px;color:#999;margin-top:2px" id="m-sync">시간 보정 중...</div>'+
      '<div style="margin:8px 0;padding:8px;background:#fff3e0;border-radius:6px;border:1px solid #ffcc02">'+
      '<b>목표 날짜</b> <span style="color:#888;font-size:11px">(10시자동/취소감시용)</span><br>'+
      '<input type="text" id="m-dates" value="'+(s.targetDates||'')+'" placeholder="예: 13,14,15" style="padding:6px;font-size:15px;width:95%;margin-top:4px;border:1px solid #ccc;border-radius:4px">'+
      '<div style="margin-top:4px"><label><input type="checkbox" id="m-autorefresh"'+(s.autoRefresh!==false?' checked':'')+'>10시 달력 자동 새로고침</label></div>'+
      '</div>'+
      '<div style="margin:8px 0"><b>시간 범위</b><br>'+
      '<select id="m-from" style="padding:4px;font-size:14px">'+timeOptions(s.timeFrom)+'</select>'+
      ' ~ <select id="m-to" style="padding:4px;font-size:14px">'+timeOptions(s.timeTo)+'</select></div>'+
      '<div style="margin:8px 0;padding:6px;background:#e8f5e9;border-radius:4px;font-size:12px"><b>코스 우선순위</b> (고정): 타이거OUT → IN → 라이온OUT → IN</div>'+
      '<div style="display:flex;gap:6px;margin-top:10px">'+
      '<button id="m-scan" style="flex:1;padding:10px 4px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">스캔</button>'+
      '<button id="m-auto10" style="flex:1;padding:10px 4px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">10시자동</button>'+
      '<button id="m-cancel" style="flex:1;padding:10px 4px;background:#6a1b9a;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;white-space:nowrap">취소감시</button></div>'+
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

    function gs(){return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,targetDates:document.getElementById('m-dates').value,autoRefresh:document.getElementById('m-autorefresh').checked};}
    function ss(html){document.getElementById('m-status').innerHTML=html;}
    function showBtns(show){
      ['m-auto10','m-cancel','m-scan'].forEach(function(id){document.getElementById(id).style.display=show?'':'none';});
      document.getElementById('m-stop').style.display=show?'none':'block';
    }

    function startJob(mode,dates,st){
      save(st);
      setJob({active:true,mode:mode,dates:dates,idx:0,results:[],autoClick:true,settings:st,autoRefresh:st.autoRefresh,auto10started:false});
      if(mode==='auto10'){
        var now=syncedNow();
        if(now.getHours()>=10){
          setCmd({click:dates[0]});
          setTimeout(function(){ window.location.reload(); }, 300);
        }
        ss('<b style="color:#e65100">10시 자동예약'+(now.getHours()>=10?' (즉시 시작)':' 대기 중')+'</b><br>'+
           dates.join(',')+'일 / '+String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시 / '+cn(st.course)+'<br>'+
           (now.getHours()<10?'10시에 자동으로 시작됩니다.':''));
      }else{
        // 취소감시: 현재 페이지가 목표 날짜면 바로 reload, 아니면 달력에 명령
        if(dates[0]===currentDateFromUrl){
          ss('<b style="color:#6a1b9a">취소표 감시 시작</b><br>'+dates[0]+'일 확인 중...');
          setTimeout(function(){ window.location.reload(); },500);
        }else{
          setCmd({click:dates[0]});
          ss('<b style="color:#6a1b9a">취소표 감시 시작</b><br>'+dates[0]+'일 확인 중 (1/'+dates.length+')');
        }
      }
      showBtns(false);
      p.style.borderColor=mode==='auto10'?'#e65100':'#6a1b9a';
    }

    // 스캔 (수동 테스트)
    document.getElementById('m-scan').onclick=function(){
      var st=gs();save(st);
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

    document.getElementById('m-auto10').onclick=function(){
      var st=gs();
      var targets=(st.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
      if(targets.length===0){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return;}
      startJob('auto10',targets,st);
    };

    document.getElementById('m-cancel').onclick=function(){
      var st=gs();
      var targets=(st.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
      if(targets.length===0){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return;}
      startJob('cancel',targets,st);
    };

    document.getElementById('m-stop').onclick=function(){
      clearJob();setCmd({});
      showBtns(true);
      p.style.borderColor='#2d6a4f';
      ss('중지됨');
    };
  }

  console.log('[매크로 v13] 슬롯 '+scanSlots().length+'개');
}
})();
