// 플라자CC 매크로 - 크롬 확장 v4 (감시 모드)
(function(){
// confirmPopup 링크가 있는 시간표 iframe에서만 실행
if(!document.querySelector('a[href*="confirmPopup"]')){
  setTimeout(function(){
    if(!document.querySelector('a[href*="confirmPopup"]'))return;
    init();
  },1500);
  return;
}
init();
function init(){
if(document.getElementById('plazacc-macro-panel'))return;

function load(){
  try{var d=JSON.parse(localStorage.getItem('plazacc-macro-settings'));if(d)return d;}catch(e){}
  return{timeFrom:'10:00',timeTo:'14:00',course:'T-OUT-first'};
}
function save(s){
  try{localStorage.setItem('plazacc-macro-settings',JSON.stringify(s));}catch(e){}
}

function scanSlots(){
  var slots=[];
  var links=document.querySelectorAll('a[href*="confirmPopup"]');
  for(var i=0;i<links.length;i++){
    var href=links[i].getAttribute('href')||'';
    var m=href.match(/confirmPopup\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'(\d{4})'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/);
    if(m){
      slots.push({
        date:m[1],
        id:m[2],
        time:m[3].substring(0,2)+':'+m[3].substring(2,4),
        timeRaw:m[3],
        branch:m[4],
        course:m[5],
        element:links[i]
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

var s=load();
var p=document.createElement('div');
p.id='plazacc-macro-panel';
p.style.cssText='position:fixed;top:10px;right:10px;width:300px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
p.innerHTML=
  '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v4</div>'+
  '<div style="padding:12px" id="m-body">'+
  '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
  '<div style="margin:8px 0"><b>시간 범위</b><br><input type="time" id="m-from" value="'+s.timeFrom+'" style="padding:4px;font-size:14px;width:100px"> ~ <input type="time" id="m-to" value="'+s.timeTo+'" style="padding:4px;font-size:14px;width:100px"></div>'+
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
  '<button id="m-scan" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">스캔</button>'+
  '<button id="m-go" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">바로 클릭!</button></div>'+
  '<div style="display:flex;gap:6px;margin-top:6px">'+
  '<button id="m-watch" style="flex:1;padding:12px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:bold;cursor:pointer">감시 시작</button>'+
  '<button id="m-stop" style="flex:1;padding:12px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:bold;cursor:pointer;display:none">중지</button></div>'+
  '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5;max-height:200px;overflow-y:auto">설정 후 [감시 시작]을 누르세요.<br>날짜를 클릭하면 자동으로 예약합니다.</div>'+
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

function gs(){return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,course:document.getElementById('m-course').value};}
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
  if(matched.length===0&&slots.length>0)html+='<span style="color:orange">조건 변경 필요</span>';
  ss(html);
};

// 바로 클릭 버튼
document.getElementById('m-go').onclick=function(){
  var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
  if(matched.length===0){ss('<span style="color:red">매칭 슬롯 없음!</span>');return;}
  var t=matched[0];ss('<b style="color:#2d6a4f">클릭! '+t.time+' '+cn(t.course)+'</b><br>팝업을 확인하세요!');
  t.element.click();beep();
};

// ===== 감시 모드 (핵심) =====
// 날짜 클릭 → 시간표 변경 감지 → 자동 스캔+클릭
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
    // 성공 후에도 감시 유지 (팝업에서 취소할 수 있으니까)
  }else{
    var now=new Date();
    var timeStr=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')+':'+String(now.getSeconds()).padStart(2,'0');
    ss('<b style="color:#e65100">감시 중... ('+timeStr+')</b><br>'+
       st.timeFrom+'~'+st.timeTo+' / '+cn(st.course)+'<br>'+
       '예약가능 '+slots.length+'개, 조건매칭 0개<br>'+
       '<span style="color:#666">날짜를 클릭하면 자동 스캔합니다</span>');
  }
}

document.getElementById('m-watch').onclick=function(){
  var st=gs();save(st);
  watchActive=true;
  document.getElementById('m-watch').style.display='none';
  document.getElementById('m-stop').style.display='block';
  // 패널 테두리 색 변경 (감시 중 표시)
  p.style.borderColor='#e65100';

  // 방법1: DOM 변경 감지 (시간표가 바뀌면 즉시 스캔)
  watchObserver=new MutationObserver(function(){
    setTimeout(watchScan,100); // DOM 변경 후 약간 대기
  });
  watchObserver.observe(document.body,{childList:true,subtree:true});

  // 방법2: 주기적 스캔 (500ms마다, 백업용)
  watchInterval=setInterval(watchScan,500);

  // 즉시 한번 스캔
  watchScan();
};

document.getElementById('m-stop').onclick=function(){
  watchActive=false;
  if(watchObserver){watchObserver.disconnect();watchObserver=null;}
  if(watchInterval){clearInterval(watchInterval);watchInterval=null;}
  document.getElementById('m-watch').style.display='block';
  document.getElementById('m-stop').style.display='none';
  p.style.borderColor='#2d6a4f';
  ss('감시 중지됨');
};

console.log('[플라자CC 매크로 v4] 시간표 감지, 슬롯 '+scanSlots().length+'개');
} // end init()
})();
