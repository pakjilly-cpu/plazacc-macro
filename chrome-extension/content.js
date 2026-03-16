// 플라자CC 매크로 - 크롬 확장 v5 (자동 새로고침 + 날짜 클릭 + 감시)
(function(){
'use strict';

// ===== 어떤 iframe인지 판별 =====
var isTimeTable = !!document.querySelector('a[href*="confirmPopup"]');
var isCalendar = !isTimeTable && !!document.querySelector('img[alt*="일자 선택"]');

// 둘 다 아니면 1.5초 후 재확인
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
  return{timeFrom:'10:00',timeTo:'14:00',course:'T-OUT-first',targetDates:'',autoRefresh:true,watchActive:false};
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

  // 감시 모드가 활성화되면 자동으로 새로고침+날짜 클릭
  var calTimer=setInterval(function(){
    var w=getWatch();
    if(!w.active)return;

    // 10시 자동 새로고침
    if(w.autoRefresh){
      var now=new Date();
      var h=now.getHours(),m=now.getMinutes(),s=now.getSeconds();
      if(h===10&&m===0&&s<=2&&!w.refreshed){
        setWatch({refreshed:true});
        // 새로고침 버튼 클릭
        var refreshBtn=document.querySelector('button');
        var allBtns=document.querySelectorAll('a, button');
        for(var i=0;i<allBtns.length;i++){
          var txt=allBtns[i].textContent.trim();
          var alt=allBtns[i].querySelector('img') ? allBtns[i].querySelector('img').getAttribute('alt')||'' : '';
          if(txt==='새로고침'||alt==='새로고침'){
            allBtns[i].click();
            console.log('[플라자CC 매크로] 달력 새로고침 클릭!');
            // 새로고침 후 1초 대기 → 날짜 클릭
            setTimeout(function(){clickTargetDate(w);},1000);
            return;
          }
        }
      }
      // 10시 이후에도 날짜 자동 클릭 (새로고침 후)
      if(h===10&&m===0&&s>2&&s<=10&&w.refreshed&&!w.dateClicked){
        clickTargetDate(w);
      }
    }
  },200);

  function clickTargetDate(w){
    var targets=(w.targetDates||'').split(',').map(function(x){return x.trim()});
    if(targets.length===0||targets[0]==='')return;

    // 현재 클릭 안 된 첫번째 날짜 찾기
    var dateLinks=document.querySelectorAll('a[href="#none"]');
    for(var t=0;t<targets.length;t++){
      for(var i=0;i<dateLinks.length;i++){
        if(dateLinks[i].textContent.trim()===targets[t]){
          dateLinks[i].click();
          setWatch({dateClicked:true,clickedDate:targets[t]});
          console.log('[플라자CC 매크로] 날짜 '+targets[t]+' 클릭!');
          return;
        }
      }
    }
    console.log('[플라자CC 매크로] 날짜 못 찾음: '+targets.join(','));
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
    var from=timeToMin(s.timeFrom),to=timeToMin(s.timeTo);
    var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<=to;});
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
  function beepSuccess(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[0,0.2,0.4].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.1);});}catch(e){}}

  // UI
  var s=load();
  var p=document.createElement('div');
  p.id='plazacc-macro-panel';
  p.style.cssText='position:fixed;top:10px;right:10px;width:320px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
  p.innerHTML=
    '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v5</div>'+
    '<div style="padding:12px" id="m-body">'+
    '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
    // 날짜 설정
    '<div style="margin:8px 0;padding:8px;background:#fff3e0;border-radius:6px;border:1px solid #ffcc02">'+
    '<b>목표 날짜</b> (달력에 보이는 숫자, 콤마로 구분)<br>'+
    '<input type="text" id="m-dates" value="'+(s.targetDates||'')+'" placeholder="예: 7,8,9,10,11" style="padding:6px;font-size:14px;width:95%;margin-top:4px;border:1px solid #ccc;border-radius:4px">'+
    '<div style="margin-top:4px"><label><input type="checkbox" id="m-autorefresh"'+(s.autoRefresh!==false?' checked':'')+' style="margin-right:4px">10시에 달력 자동 새로고침</label></div>'+
    '</div>'+
    // 시간 설정
    '<div style="margin:8px 0"><b>시간 범위</b><br><input type="time" id="m-from" value="'+s.timeFrom+'" style="padding:4px;font-size:14px;width:100px"> ~ <input type="time" id="m-to" value="'+s.timeTo+'" style="padding:4px;font-size:14px;width:100px"></div>'+
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
    '<div style="margin-top:6px">'+
    '<button id="m-watch" style="width:100%;padding:14px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer">감시 시작 (10시 자동예약)</button>'+
    '<button id="m-stop" style="width:100%;padding:14px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer;display:none">중지</button></div>'+
    '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5;max-height:200px;overflow-y:auto">설정 후 [감시 시작]을 누르세요.</div>'+
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

  // 스캔 버튼
  document.getElementById('m-scan').onclick=function(){
    var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
    var html='<b>예약가능 '+slots.length+'개</b>, 조건매칭 <b style="color:#d32f2f">'+matched.length+'개</b><br>';
    matched.slice(0,10).forEach(function(x){
      html+='<span style="color:'+(x.course.indexOf('T-')===0?'#2d6a4f':'#1565c0')+'">'+x.time+' '+cn(x.course)+'</span><br>';
    });
    if(matched.length>10)html+='... 외 '+(matched.length-10)+'개';
    if(slots.length===0)html+='<span style="color:red">예약가능 슬롯 없음</span>';
    ss(html);
  };

  // 바로 클릭 버튼
  document.getElementById('m-go').onclick=function(){
    var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
    if(matched.length===0){ss('<span style="color:red">매칭 슬롯 없음!</span>');return;}
    var t=matched[0];ss('<b style="color:#2d6a4f">클릭! '+t.time+' '+cn(t.course)+'</b><br>팝업을 확인하세요!');
    t.element.click();beep();
  };

  // ===== 감시 모드 =====
  var watchActive=false;
  var watchObserver=null;
  var watchInterval=null;

  function watchScan(){
    if(!watchActive)return;
    var st=gs();
    var slots=scanSlots();
    var matched=filterAndSort(slots,st);
    if(matched.length>0){
      var t=matched[0];
      ss('<b style="color:#2d6a4f;font-size:16px">예약 클릭!</b><br>'+t.time+' '+cn(t.course)+'<br>팝업을 확인하세요!');
      t.element.click();
      beepSuccess();
    }else{
      var now=new Date();
      var ts=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
      ss('<b style="color:#e65100">감시 중... ('+ts+')</b><br>'+
         st.timeFrom+'~'+st.timeTo+' / '+cn(st.course)+'<br>'+
         '목표날짜: '+(st.targetDates||'미설정')+'<br>'+
         '예약가능 '+slots.length+'개, 조건매칭 0개<br>'+
         '<span style="color:#666">날짜 클릭 시 자동 스캔합니다</span>');
    }
  }

  document.getElementById('m-watch').onclick=function(){
    var st=gs();save(st);
    watchActive=true;
    document.getElementById('m-watch').style.display='none';
    document.getElementById('m-stop').style.display='block';
    p.style.borderColor='#e65100';

    // localStorage로 달력 iframe에 신호 보내기
    setWatch({
      active:true,
      targetDates:st.targetDates,
      autoRefresh:st.autoRefresh,
      refreshed:false,
      dateClicked:false
    });

    // DOM 변경 감지
    watchObserver=new MutationObserver(function(){
      setTimeout(watchScan,100);
    });
    watchObserver.observe(document.body,{childList:true,subtree:true});

    // 주기적 백업 스캔
    watchInterval=setInterval(watchScan,500);

    watchScan();
  };

  document.getElementById('m-stop').onclick=function(){
    watchActive=false;
    if(watchObserver){watchObserver.disconnect();watchObserver=null;}
    if(watchInterval){clearInterval(watchInterval);watchInterval=null;}
    document.getElementById('m-watch').style.display='block';
    document.getElementById('m-stop').style.display='none';
    p.style.borderColor='#2d6a4f';
    setWatch({active:false,refreshed:false,dateClicked:false});
    ss('감시 중지됨');
  };

  console.log('[플라자CC 매크로 v5] 시간표 감지, 슬롯 '+scanSlots().length+'개');
} // end initTimeTable

})();
