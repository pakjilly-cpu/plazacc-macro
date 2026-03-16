// 플라자CC 매크로 - 크롬 확장 v6 (10시자동예약 + 취소표감시)
(function(){
'use strict';

// ===== 어떤 iframe인지 판별 =====
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

// ===== 공용 함수 =====
function load(){
  try{var d=JSON.parse(localStorage.getItem('plazacc-macro-settings'));if(d)return d;}catch(e){}
  return{timeFrom:'10',timeTo:'14',course:'T-OUT-first',targetDates:'',autoRefresh:true};
}
function save(s){
  try{localStorage.setItem('plazacc-macro-settings',JSON.stringify(s));}catch(e){}
}
function getWatch(){
  try{return JSON.parse(localStorage.getItem('plazacc-macro-watch'))||{};}catch(e){return{};}
}
function setWatch(obj){
  try{var w=getWatch();for(var k in obj)w[k]=obj[k];localStorage.setItem('plazacc-macro-watch',JSON.stringify(w));}catch(e){}
}

// ===== 달력 iframe 로직 =====
function initCalendar(){
  console.log('[플라자CC 매크로] 달력 iframe 감지');

  setInterval(function(){
    var w=getWatch();
    if(!w.active)return;

    var now=new Date();
    var h=now.getHours(),m=now.getMinutes(),s=now.getSeconds();

    // 모드1: 10시 자동예약 - 10시에 새로고침+날짜클릭
    if(w.mode==='auto10'){
      if(w.autoRefresh&&h===10&&m===0&&s<=2&&!w.refreshed){
        setWatch({refreshed:true});
        clickRefresh();
        setTimeout(function(){clickTargetDate(w);},1000);
        return;
      }
      if(h===10&&m===0&&s>2&&s<=10&&w.refreshed&&!w.dateClicked){
        clickTargetDate(w);
      }
    }

    // 모드2: 취소표 감시 - 요청받은 날짜 클릭
    if(w.mode==='cancel'&&w.clickDate&&!w.dateClicking){
      setWatch({dateClicking:true});
      // 새로고침 먼저
      clickRefresh();
      setTimeout(function(){
        clickTargetDateSingle(w.clickDate);
        setWatch({dateClicking:false,clickDate:''});
      },800);
    }
  },200);

  function clickRefresh(){
    var allBtns=document.querySelectorAll('a, button');
    for(var i=0;i<allBtns.length;i++){
      var txt=allBtns[i].textContent.trim();
      var img=allBtns[i].querySelector('img');
      var alt=img?img.getAttribute('alt')||'':'';
      if(txt==='새로고침'||alt==='새로고침'){
        allBtns[i].click();
        console.log('[플라자CC 매크로] 달력 새로고침');
        return;
      }
    }
  }

  function clickTargetDate(w){
    var targets=(w.targetDates||'').split(',').map(function(x){return x.trim()});
    if(targets.length===0||targets[0]==='')return;
    var dateLinks=document.querySelectorAll('a[href="#none"]');
    for(var t=0;t<targets.length;t++){
      for(var i=0;i<dateLinks.length;i++){
        if(dateLinks[i].textContent.trim()===targets[t]){
          dateLinks[i].click();
          setWatch({dateClicked:true,clickedDate:targets[t]});
          console.log('[플라자CC 매크로] 날짜 '+targets[t]+' 클릭');
          return;
        }
      }
    }
  }

  function clickTargetDateSingle(dateStr){
    var dateLinks=document.querySelectorAll('a[href="#none"]');
    for(var i=0;i<dateLinks.length;i++){
      if(dateLinks[i].textContent.trim()===dateStr){
        dateLinks[i].click();
        console.log('[플라자CC 매크로] 취소감시 날짜 '+dateStr+' 클릭');
        return;
      }
    }
  }
}

// ===== 시간표 iframe 로직 =====
function initTimeTable(){
  if(document.getElementById('plazacc-macro-panel'))return;
  console.log('[플라자CC 매크로] 시간표 iframe 감지');

  function scanSlots(){
    var slots=[];
    var links=document.querySelectorAll('a[href*="confirmPopup"]');
    for(var i=0;i<links.length;i++){
      var href=links[i].getAttribute('href')||'';
      var m=href.match(/confirmPopup\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'(\d{4})'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/);
      if(m){
        slots.push({
          date:m[1],id:m[2],
          time:m[3].substring(0,2)+':'+m[3].substring(2,4),
          timeRaw:m[3],branch:m[4],course:m[5],element:links[i]
        });
      }
    }
    return slots;
  }

  function timeToMin(t){if(!t||t.indexOf(':')<0)return 0;var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1]);}
  function cn(c){return{'T-OUT':'타이거OUT','T-IN':'타이거IN','L-OUT':'라이온OUT','L-IN':'라이온IN'}[c]||c||'?';}

  function filterAndSort(slots,s){
    var from=parseInt(s.timeFrom)*60;
    var to=parseInt(s.timeTo)*60;
    var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<to;});
    if(s.course==='T-OUT-only')f=f.filter(function(x){return x.course==='T-OUT';});
    else if(s.course==='T-IN-only')f=f.filter(function(x){return x.course==='T-IN';});
    else if(s.course==='L-OUT-only')f=f.filter(function(x){return x.course==='L-OUT';});
    else if(s.course==='L-IN-only')f=f.filter(function(x){return x.course==='L-IN';});
    var om;
    if(s.course==='T-IN-first') om={'T-IN':0,'T-OUT':1,'L-IN':2,'L-OUT':3};
    else if(s.course==='L-OUT-first') om={'L-OUT':0,'L-IN':1,'T-OUT':2,'T-IN':3};
    else if(s.course==='L-IN-first') om={'L-IN':0,'L-OUT':1,'T-OUT':2,'T-IN':3};
    else om={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
    f.sort(function(a,b){var ca=om[a.course]!=null?om[a.course]:9;var cb=om[b.course]!=null?om[b.course]:9;return ca!==cb?ca-cb:timeToMin(a.time)-timeToMin(b.time);});
    return f;
  }

  function beep(){try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start();o.stop(c.currentTime+0.3);}catch(e){}}
  function beepSuccess(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.15,0.3,0.45,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=d<0.3?880:1100;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.1);});}catch(e){}}

  // 시간 드롭다운 옵션 생성 (06~19시)
  function timeOptions(selected){
    var html='';
    for(var h=6;h<=19;h++){
      var val=String(h);
      var label=String(h).padStart(2,'0')+'시';
      html+='<option value="'+val+'"'+(val===selected?' selected':'')+'>'+label+'</option>';
    }
    return html;
  }

  // UI
  var s=load();
  var p=document.createElement('div');
  p.id='plazacc-macro-panel';
  p.style.cssText='position:fixed;top:10px;right:10px;width:320px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
  p.innerHTML=
    '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v6</div>'+
    '<div style="padding:12px" id="m-body">'+
    '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
    // 날짜 설정
    '<div style="margin:8px 0;padding:8px;background:#fff3e0;border-radius:6px;border:1px solid #ffcc02">'+
    '<b>목표 날짜</b> <span style="color:#888;font-size:11px">(달력 숫자, 콤마 구분)</span><br>'+
    '<input type="text" id="m-dates" value="'+(s.targetDates||'')+'" placeholder="예: 13,14,15" style="padding:6px;font-size:15px;width:95%;margin-top:4px;border:1px solid #ccc;border-radius:4px">'+
    '<div style="margin-top:4px"><label><input type="checkbox" id="m-autorefresh"'+(s.autoRefresh!==false?' checked':'')+' style="margin-right:4px">10시에 달력 자동 새로고침</label></div>'+
    '</div>'+
    // 시간 설정
    '<div style="margin:8px 0"><b>시간 범위</b><br>'+
    '<select id="m-from" style="padding:4px;font-size:14px">'+timeOptions(s.timeFrom)+'</select>'+
    ' ~ '+
    '<select id="m-to" style="padding:4px;font-size:14px">'+timeOptions(s.timeTo)+'</select>'+
    '</div>'+
    // 코스 설정
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
    // 버튼
    '<div style="display:flex;gap:6px;margin-top:10px">'+
    '<button id="m-scan" style="flex:1;padding:8px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer">스캔</button>'+
    '<button id="m-go" style="flex:1;padding:8px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer">바로 클릭!</button></div>'+
    '<div style="display:flex;gap:6px;margin-top:6px">'+
    '<button id="m-auto10" style="flex:1;padding:12px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">10시 자동예약</button>'+
    '<button id="m-cancel" style="flex:1;padding:12px;background:#6a1b9a;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">취소표 감시</button></div>'+
    '<button id="m-stop" style="width:100%;padding:12px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none;margin-top:6px">중지</button>'+
    '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5;max-height:200px;overflow-y:auto">설정 후 버튼을 누르세요.</div>'+
    '</div>';
  document.body.appendChild(p);

  // 시계
  setInterval(function(){var n=new Date();var el=document.getElementById('m-clock');if(el)el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');},200);

  // 드래그
  var hdr=document.getElementById('m-header');
  var dragging=false,dx,dy;
  hdr.onmousedown=function(e){dragging=true;dx=e.clientX-p.getBoundingClientRect().left;dy=e.clientY-p.getBoundingClientRect().top;};
  document.onmousemove=function(e){if(!dragging)return;p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';};
  document.onmouseup=function(){dragging=false;};

  function gs(){
    return{
      timeFrom:document.getElementById('m-from').value,
      timeTo:document.getElementById('m-to').value,
      course:document.getElementById('m-course').value,
      targetDates:document.getElementById('m-dates').value,
      autoRefresh:document.getElementById('m-autorefresh').checked
    };
  }
  function ss(html){document.getElementById('m-status').innerHTML=html;}

  // 스캔 버튼 (필터 적용)
  document.getElementById('m-scan').onclick=function(){
    var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
    var html='<b>조건 매칭 '+matched.length+'개</b> <span style="color:#888">(전체 '+slots.length+'개 중)</span><br>';
    matched.slice(0,10).forEach(function(x){
      html+='<span style="color:'+(x.course.indexOf('T-')===0?'#2d6a4f':'#1565c0')+'">'+x.time+' '+cn(x.course)+'</span><br>';
    });
    if(matched.length>10)html+='... 외 '+(matched.length-10)+'개';
    if(matched.length===0)html+='<span style="color:red">조건에 맞는 슬롯 없음</span>';
    ss(html);
  };

  // 바로 클릭 버튼 (필터 적용)
  document.getElementById('m-go').onclick=function(){
    var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
    if(matched.length===0){ss('<span style="color:red">조건에 맞는 슬롯 없음!</span>');return;}
    var t=matched[0];ss('<b style="color:#2d6a4f">클릭! '+t.time+' '+cn(t.course)+'</b><br>팝업을 확인하세요!');
    t.element.click();beep();
  };

  // ===== 감시 공통 =====
  var watchActive=false;
  var watchMode=''; // 'auto10' or 'cancel'
  var watchObserver=null;
  var watchInterval=null;
  var cancelDateIdx=0;
  var cancelCycleTimer=null;

  function showButtons(show){
    document.getElementById('m-auto10').style.display=show?'block':'none';
    document.getElementById('m-cancel').style.display=show?'block':'none';
    document.getElementById('m-stop').style.display=show?'none':'block';
  }

  function stopWatch(){
    watchActive=false;
    watchMode='';
    if(watchObserver){watchObserver.disconnect();watchObserver=null;}
    if(watchInterval){clearInterval(watchInterval);watchInterval=null;}
    if(cancelCycleTimer){clearInterval(cancelCycleTimer);cancelCycleTimer=null;}
    cancelDateIdx=0;
    setWatch({active:false,mode:'',refreshed:false,dateClicked:false,clickDate:'',dateClicking:false});
    showButtons(true);
    p.style.borderColor='#2d6a4f';
    ss('중지됨');
  }

  // 감시 스캔 (공통)
  function watchScan(){
    if(!watchActive)return;
    var st=gs();
    var slots=scanSlots();
    var matched=filterAndSort(slots,st);
    if(matched.length>0){
      var t=matched[0];
      ss('<b style="color:#2d6a4f;font-size:16px">예약 클릭!</b><br>'+t.time+' '+cn(t.course)+'<br>팝업에서 확인을 눌러주세요!');
      t.element.click();
      beepSuccess();
      // 성공해도 감시 유지 (팝업 취소 대비)
    }else{
      var now=new Date();
      var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
      var modeLabel=watchMode==='auto10'?'10시 자동예약':'취소표 감시';
      var w=getWatch();
      ss('<b style="color:'+(watchMode==='auto10'?'#e65100':'#6a1b9a')+'">'+modeLabel+' ('+ts+')</b><br>'+
         String(st.timeFrom).padStart(2,'0')+'시~'+String(st.timeTo).padStart(2,'0')+'시 / '+cn(st.course)+'<br>'+
         '날짜: '+(st.targetDates||'미설정')+(w.clickedDate?' (현재:'+w.clickedDate+'일)':'')+'<br>'+
         '매칭 0개 - 계속 감시 중...');
    }
  }

  // ===== 10시 자동예약 =====
  document.getElementById('m-auto10').onclick=function(){
    var st=gs();save(st);
    watchActive=true;
    watchMode='auto10';
    showButtons(false);
    p.style.borderColor='#e65100';

    setWatch({
      active:true,mode:'auto10',
      targetDates:st.targetDates,autoRefresh:st.autoRefresh,
      refreshed:false,dateClicked:false
    });

    watchObserver=new MutationObserver(function(){setTimeout(watchScan,100);});
    watchObserver.observe(document.body,{childList:true,subtree:true});
    watchInterval=setInterval(watchScan,500);

    var now=new Date();
    if(now.getHours()>=10){
      ss('<b style="color:#e65100">10시 자동예약 대기 중</b><br>이미 10시가 지났습니다.<br>날짜를 직접 클릭하면 자동 스캔합니다.');
    }else{
      ss('<b style="color:#e65100">10시 자동예약 대기 중</b><br>'+st.timeFrom+'시~'+st.timeTo+'시 / '+cn(st.course)+'<br>날짜: '+(st.targetDates||'미설정')+'<br>10시에 자동으로 실행됩니다.');
    }
  };

  // ===== 취소표 감시 =====
  document.getElementById('m-cancel').onclick=function(){
    var st=gs();save(st);
    var targets=(st.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
    if(targets.length===0){ss('<span style="color:red">목표 날짜를 입력하세요!</span>');return;}

    watchActive=true;
    watchMode='cancel';
    cancelDateIdx=0;
    showButtons(false);
    p.style.borderColor='#6a1b9a';

    setWatch({active:true,mode:'cancel',targetDates:st.targetDates,clickDate:'',dateClicking:false});

    // DOM 변경 감지
    watchObserver=new MutationObserver(function(){setTimeout(watchScan,200);});
    watchObserver.observe(document.body,{childList:true,subtree:true});
    watchInterval=setInterval(watchScan,500);

    // 날짜 순환: 5초마다 다음 날짜 클릭 요청
    cancelCycleTimer=setInterval(function(){
      if(!watchActive)return;
      var st2=gs();
      var t2=(st2.targetDates||'').split(',').map(function(x){return x.trim()}).filter(function(x){return x!==''});
      if(t2.length===0)return;
      cancelDateIdx=(cancelDateIdx+1)%t2.length;
      setWatch({clickDate:t2[cancelDateIdx]});
    },5000);

    // 첫 번째 날짜 즉시 클릭
    setWatch({clickDate:targets[0]});
    ss('<b style="color:#6a1b9a">취소표 감시 시작</b><br>'+targets.join(', ')+'일 순환 중<br>'+st.timeFrom+'시~'+st.timeTo+'시 / '+cn(st.course));
  };

  // 중지 버튼
  document.getElementById('m-stop').onclick=stopWatch;

  console.log('[플라자CC 매크로 v6] 시간표 감지, 슬롯 '+scanSlots().length+'개');
} // end initTimeTable

})();
