// 플라자CC 매크로 v8 - 스캔 상태 localStorage 기반
(function(){
'use strict';

var isTimeTable = !!document.querySelector('a[href*="confirmPopup"]');
var isCalendar = !isTimeTable && !!document.querySelector('img[alt*="일자 선택"]');

if(!isTimeTable && !isCalendar){
  setTimeout(function(){
    if(document.querySelector('a[href*="confirmPopup"]')) initTimeTable();
    else if(document.querySelector('img[alt*="일자 선택"]')) initCalendar();
  },1500);
  return;
}
if(isTimeTable) initTimeTable();
if(isCalendar) initCalendar();

// ===== 공용 =====
function load(){try{var d=JSON.parse(localStorage.getItem('plazacc-s'));if(d)return d;}catch(e){}return{timeFrom:'10',timeTo:'14',course:'T-OUT-first',targetDates:'',autoRefresh:true};}
function save(s){try{localStorage.setItem('plazacc-s',JSON.stringify(s));}catch(e){}}
function gw(){try{return JSON.parse(localStorage.getItem('plazacc-w'))||{};}catch(e){return{};}}
function sw(o){try{var w=gw();for(var k in o)w[k]=o[k];localStorage.setItem('plazacc-w',JSON.stringify(w));}catch(e){}}
// 스캔 상태 (iframe 리로드 후에도 유지)
function getScan(){try{return JSON.parse(localStorage.getItem('plazacc-scan'))||{};}catch(e){return{};}}
function setScan(o){try{var s=getScan();for(var k in o)s[k]=o[k];localStorage.setItem('plazacc-scan',JSON.stringify(s));}catch(e){}}
function clearScan(){try{localStorage.removeItem('plazacc-scan');}catch(e){}}

// ===== 달력 iframe =====
function initCalendar(){
  console.log('[매크로] 달력 감지');

  // 클릭 가능한 날짜 목록
  function getClickableDates(){
    var dates=[];
    var links=document.querySelectorAll('a[href="#none"]');
    for(var i=0;i<links.length;i++){
      var t=links[i].textContent.trim();
      if(t.match(/^\d{1,2}$/))dates.push(t);
    }
    return dates;
  }

  function clickDate(d){
    var links=document.querySelectorAll('a[href="#none"]');
    for(var i=0;i<links.length;i++){
      if(links[i].textContent.trim()===d){links[i].click();console.log('[매크로] 날짜 '+d+' 클릭');return true;}
    }
    return false;
  }

  function clickRefresh(){
    var btns=document.querySelectorAll('a, button');
    for(var i=0;i<btns.length;i++){
      var t=btns[i].textContent.trim();
      var img=btns[i].querySelector('img');
      var alt=img?img.getAttribute('alt')||'':'';
      if(t==='새로고침'||alt==='새로고침'){btns[i].click();console.log('[매크로] 새로고침');return;}
    }
  }

  setInterval(function(){
    var w=gw();

    // 클릭가능 날짜 요청 응답
    if(w.requestDates){
      sw({requestDates:false,clickableDates:getClickableDates().join(',')});
    }

    // 날짜 클릭 요청
    if(w.clickDate&&!w.dateClicking){
      sw({dateClicking:true});
      clickDate(w.clickDate);
      setTimeout(function(){sw({dateClicking:false,clickDate:''});},500);
    }

    // 10시 자동예약: 새로고침+날짜클릭
    if(w.active&&w.mode==='auto10'){
      var now=new Date();
      var h=now.getHours(),m=now.getMinutes(),s=now.getSeconds();
      if(w.autoRefresh&&h===10&&m===0&&s<=2&&!w.refreshed){
        sw({refreshed:true});
        clickRefresh();
        setTimeout(function(){
          var targets=(w.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
          if(targets.length>0)clickDate(targets[0]);
          sw({dateClicked:true,clickedDate:targets[0]||''});
        },1000);
      }
    }

    // 취소표 감시: 날짜 순환
    if(w.active&&w.mode==='cancel'&&w.nextCancelDate&&!w.dateClicking){
      sw({dateClicking:true,nextCancelDate:''});
      clickRefresh();
      setTimeout(function(){
        clickDate(w.nextCancelDate_val||'');
        sw({dateClicking:false});
      },800);
    }
  },200);
}

// ===== 시간표 iframe =====
function initTimeTable(){
  if(document.getElementById('plazacc-macro-panel'))return;
  console.log('[매크로] 시간표 감지');

  function scanSlots(){
    var slots=[];
    var links=document.querySelectorAll('a[href*="confirmPopup"]');
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

  function filterAndSort(slots,s){
    var from=parseInt(s.timeFrom)*60,to=parseInt(s.timeTo)*60;
    var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<to;});
    if(s.course==='T-OUT-only')f=f.filter(function(x){return x.course==='T-OUT';});
    else if(s.course==='T-IN-only')f=f.filter(function(x){return x.course==='T-IN';});
    else if(s.course==='L-OUT-only')f=f.filter(function(x){return x.course==='L-OUT';});
    else if(s.course==='L-IN-only')f=f.filter(function(x){return x.course==='L-IN';});
    var om;
    if(s.course==='T-IN-first')om={'T-IN':0,'T-OUT':1,'L-IN':2,'L-OUT':3};
    else if(s.course==='L-OUT-first')om={'L-OUT':0,'L-IN':1,'T-OUT':2,'T-IN':3};
    else if(s.course==='L-IN-first')om={'L-IN':0,'L-OUT':1,'T-OUT':2,'T-IN':3};
    else om={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
    f.sort(function(a,b){var ca=om[a.course]!=null?om[a.course]:9;var cb=om[b.course]!=null?om[b.course]:9;return ca!==cb?ca-cb:timeToMin(a.time)-timeToMin(b.time);});
    return f;
  }

  function beepSuccess(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.15,0.3,0.45,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=d<0.3?880:1100;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.1);});}catch(e){}}

  function timeOptions(sel){
    var h='';for(var i=6;i<=19;i++){var v=String(i);h+='<option value="'+v+'"'+(v===sel?' selected':'')+'>'+String(i).padStart(2,'0')+'시</option>';}return h;
  }

  // UI
  var s=load();
  var p=document.createElement('div');
  p.id='plazacc-macro-panel';
  p.style.cssText='position:fixed;top:5px;right:5px;width:320px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;max-height:95vh;overflow-y:auto;';
  p.innerHTML=
    '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v8</div>'+
    '<div style="padding:12px" id="m-body">'+
    '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
    '<div style="margin:8px 0;padding:8px;background:#fff3e0;border-radius:6px;border:1px solid #ffcc02">'+
    '<b>목표 날짜</b> <span style="color:#888;font-size:11px">(10시자동/취소감시용)</span><br>'+
    '<input type="text" id="m-dates" value="'+(s.targetDates||'')+'" placeholder="예: 13,14,15" style="padding:6px;font-size:15px;width:95%;margin-top:4px;border:1px solid #ccc;border-radius:4px">'+
    '<div style="margin-top:4px"><label><input type="checkbox" id="m-autorefresh"'+(s.autoRefresh!==false?' checked':'')+'>10시 달력 자동 새로고침</label></div>'+
    '</div>'+
    '<div style="margin:8px 0"><b>시간 범위</b><br>'+
    '<select id="m-from" style="padding:4px;font-size:14px">'+timeOptions(s.timeFrom)+'</select>'+
    ' ~ <select id="m-to" style="padding:4px;font-size:14px">'+timeOptions(s.timeTo)+'</select></div>'+
    '<div style="margin:8px 0"><b>코스 우선순위</b><br><select id="m-course" style="padding:4px;font-size:13px;width:100%">'+
    '<option value="T-OUT-first"'+(s.course==='T-OUT-first'?' selected':'')+'>타이거OUT 우선 (전체)</option>'+
    '<option value="T-IN-first"'+(s.course==='T-IN-first'?' selected':'')+'>타이거IN 우선 (전체)</option>'+
    '<option value="L-OUT-first"'+(s.course==='L-OUT-first'?' selected':'')+'>라이온OUT 우선 (전체)</option>'+
    '<option value="L-IN-first"'+(s.course==='L-IN-first'?' selected':'')+'>라이온IN 우선 (전체)</option>'+
    '<option value="T-OUT-only"'+(s.course==='T-OUT-only'?' selected':'')+'>타이거OUT만</option>'+
    '<option value="T-IN-only"'+(s.course==='T-IN-only'?' selected':'')+'>타이거IN만</option>'+
    '<option value="L-OUT-only"'+(s.course==='L-OUT-only'?' selected':'')+'>라이온OUT만</option>'+
    '<option value="L-IN-only"'+(s.course==='L-IN-only'?' selected':'')+'>라이온IN만</option>'+
    '</select></div>'+
    '<div style="display:flex;gap:6px;margin-top:10px">'+
    '<button id="m-scan" style="flex:1;padding:8px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer">스캔 (전체날짜)</button>'+
    '<button id="m-go" style="flex:1;padding:8px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer">바로 클릭!</button></div>'+
    '<div style="display:flex;gap:6px;margin-top:6px">'+
    '<button id="m-auto10" style="flex:1;padding:12px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">10시 자동예약</button>'+
    '<button id="m-cancel" style="flex:1;padding:12px;background:#6a1b9a;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">취소표 감시</button></div>'+
    '<button id="m-stop" style="width:100%;padding:12px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none;margin-top:6px">중지</button>'+
    '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5;max-height:300px;overflow-y:auto">설정 후 버튼을 누르세요.</div>'+
    '</div>';
  document.body.appendChild(p);

  setInterval(function(){var n=new Date();var el=document.getElementById('m-clock');if(el)el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');},200);

  var hdr=document.getElementById('m-header');var dragging=false,dx,dy;
  hdr.onmousedown=function(e){dragging=true;dx=e.clientX-p.getBoundingClientRect().left;dy=e.clientY-p.getBoundingClientRect().top;};
  document.onmousemove=function(e){if(!dragging)return;p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';};
  document.onmouseup=function(){dragging=false;};

  function gs(){return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,course:document.getElementById('m-course').value,targetDates:document.getElementById('m-dates').value,autoRefresh:document.getElementById('m-autorefresh').checked};}
  function ss(html){document.getElementById('m-status').innerHTML=html;}

  function showBtns(show){
    ['m-scan','m-go','m-auto10','m-cancel'].forEach(function(id){document.getElementById(id).style.display=show?'':'none';});
    document.getElementById('m-stop').style.display=show?'none':'block';
  }

  // ===== 스캔/바로클릭 (localStorage 기반, iframe 리로드 대응) =====

  // 페이지 로드 시: 진행 중인 스캔이 있으면 이어서 처리
  var sc=getScan();
  if(sc.active){
    // 현재 시간표 스캔
    var st=sc.settings||load();
    var slots=scanSlots();
    var matched=filterAndSort(slots,st);
    var dateLabel='';
    if(slots.length>0&&slots[0].date)dateLabel=fmtDate(slots[0].date);

    // 바로클릭 모드: 매칭 발견 → 즉시 클릭
    if(sc.autoClick&&matched.length>0){
      var t=matched[0];
      clearScan();
      setTimeout(function(){
        ss('<b style="color:#2d6a4f;font-size:16px">예약 클릭!</b><br>'+dateLabel+' '+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!');
        t.element.click();
        beepSuccess();
        showBtns(true);
      },300);
    }else{
      // 결과 저장
      var results=sc.results||[];
      if(matched.length>0){
        var items=[];
        matched.slice(0,5).forEach(function(x){items.push({time:x.time,course:x.course,date:x.date});});
        results.push({dateLabel:dateLabel,slots:items});
      }

      var dates=sc.dates||[];
      var idx=(sc.idx||0)+1;

      if(idx>=dates.length){
        // 스캔 완료
        clearScan();
        setTimeout(function(){
          var html='<b style="color:#1565c0">스캔 완료</b> ('+dates.length+'개 날짜)<br>';
          var total=0;
          results.forEach(function(r){
            html+='<div style="margin:4px 0;padding:4px;background:#e8f5e9;border-radius:4px">';
            html+='<b>'+r.dateLabel+'</b> - '+r.slots.length+'개<br>';
            r.slots.forEach(function(s2){html+='<span style="color:'+(s2.course.indexOf('T-')===0?'#2d6a4f':'#1565c0')+'">  '+s2.time+' '+cn(s2.course)+'</span><br>';});
            html+='</div>';
            total+=r.slots.length;
          });
          if(total===0)html+='<span style="color:red">조건에 맞는 슬롯이 없습니다.</span>';
          else html+='<b>총 '+total+'개 슬롯 발견</b>';
          ss(html);
          showBtns(true);
        },300);
      }else{
        // 다음 날짜 클릭 요청
        setScan({idx:idx,results:results});
        sw({clickDate:dates[idx]});
        setTimeout(function(){
          ss('<b style="color:#1565c0">스캔 중...</b> '+dates[idx]+'일 ('+(idx+1)+'/'+dates.length+')');
          showBtns(false);
        },300);
      }
    }
    return; // 스캔 진행 중이면 UI 이벤트 바인딩 스킵 (리로드될 것)
  }

  // ===== 버튼 이벤트 =====

  // 스캔 버튼
  document.getElementById('m-scan').onclick=function(){
    var st=gs();save(st);
    ss('<b style="color:#1565c0">날짜 목록 확인 중...</b>');
    sw({requestDates:true});
    setTimeout(function(){
      var w=gw();
      var dates=(w.clickableDates||'').split(',').filter(function(x){return x!==''});
      if(dates.length===0){ss('<span style="color:red">클릭 가능한 날짜를 찾을 수 없습니다.</span>');return;}
      // 스캔 시작
      setScan({active:true,autoClick:false,dates:dates,idx:0,results:[],settings:st});
      sw({clickDate:dates[0]});
      ss('<b style="color:#1565c0">스캔 시작!</b> '+dates.length+'개 날짜<br>'+dates[0]+'일 확인 중 (1/'+dates.length+')');
      showBtns(false);
    },600);
  };

  // 바로 클릭 버튼
  document.getElementById('m-go').onclick=function(){
    var st=gs();save(st);
    ss('<b style="color:#d32f2f">날짜 목록 확인 중...</b>');
    sw({requestDates:true});
    setTimeout(function(){
      var w=gw();
      var dates=(w.clickableDates||'').split(',').filter(function(x){return x!==''});
      if(dates.length===0){ss('<span style="color:red">클릭 가능한 날짜를 찾을 수 없습니다.</span>');return;}
      setScan({active:true,autoClick:true,dates:dates,idx:0,results:[],settings:st});
      sw({clickDate:dates[0]});
      ss('<b style="color:#d32f2f">바로 클릭!</b> '+dates.length+'개 날짜 탐색<br>'+dates[0]+'일 확인 중...');
      showBtns(false);
    },600);
  };

  // ===== 10시 자동예약 =====
  document.getElementById('m-auto10').onclick=function(){
    var st=gs();save(st);
    if(!st.targetDates){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return;}
    sw({active:true,mode:'auto10',targetDates:st.targetDates,autoRefresh:st.autoRefresh,refreshed:false,dateClicked:false});
    showBtns(false);
    p.style.borderColor='#e65100';
    startWatch('auto10',st);
  };

  // ===== 취소표 감시 =====
  var cancelIdx=0;
  document.getElementById('m-cancel').onclick=function(){
    var st=gs();save(st);
    var targets=(st.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
    if(targets.length===0){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return;}
    cancelIdx=0;
    sw({active:true,mode:'cancel',targetDates:st.targetDates,clickDate:targets[0],nextCancelDate:'',nextCancelDate_val:''});
    showBtns(false);
    p.style.borderColor='#6a1b9a';
    startWatch('cancel',st);

    // 날짜 순환
    setInterval(function(){
      var w=gw();
      if(!w.active||w.mode!=='cancel')return;
      cancelIdx=(cancelIdx+1)%targets.length;
      sw({clickDate:targets[cancelIdx]});
    },5000);
  };

  function startWatch(mode,st){
    var label=mode==='auto10'?'10시 자동예약':'취소표 감시';
    var color=mode==='auto10'?'#e65100':'#6a1b9a';

    function doScan(){
      var slots=scanSlots();
      var matched=filterAndSort(slots,gs());
      if(matched.length>0){
        var t=matched[0];
        var dl=t.date?fmtDate(t.date):'';
        ss('<b style="color:#2d6a4f;font-size:16px">예약 클릭!</b><br>'+dl+' '+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!');
        t.element.click();
        beepSuccess();
      }else{
        var now=new Date();
        var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
        var w=gw();
        ss('<b style="color:'+color+'">'+label+' ('+ts+')</b><br>'+
           String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시 / '+cn(st.course)+'<br>'+
           '날짜: '+(st.targetDates||'미설정')+(w.clickedDate?' → '+w.clickedDate+'일':'')+'<br>'+
           '매칭 0개 - 감시 중...');
      }
    }

    // DOM 변경 감지 + 주기적 스캔
    var obs=new MutationObserver(function(){setTimeout(doScan,100);});
    obs.observe(document.body,{childList:true,subtree:true});
    setInterval(doScan,500);

    if(mode==='auto10'){
      var now=new Date();
      ss('<b style="color:'+color+'">'+label+(now.getHours()>=10?' (10시 이후)':' 대기 중')+'</b><br>'+
         String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시 / '+cn(st.course)+'<br>'+
         '날짜: '+st.targetDates);
    }else{
      ss('<b style="color:'+color+'">'+label+' 시작</b><br>'+st.targetDates+' 순환 중<br>'+
         String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시 / '+cn(st.course));
    }
  }

  // 중지
  document.getElementById('m-stop').onclick=function(){
    sw({active:false,mode:'',clickDate:'',refreshed:false,dateClicked:false});
    clearScan();
    showBtns(true);
    p.style.borderColor='#2d6a4f';
    ss('중지됨');
  };

  console.log('[매크로 v8] 슬롯 '+scanSlots().length+'개');
}
})();
