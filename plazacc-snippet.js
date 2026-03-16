// 플라자CC 예약 매크로 v2 (Console에서 ifrmStep3 컨텍스트로 실행)
// 사용법: F12 → Console → 컨텍스트를 "ifrmStep3"로 변경 → 붙여넣기 → Enter

(function(){
var old=document.getElementById('plazacc-macro-panel');if(old)old.remove();

// 설정
var SETTINGS_KEY='plazacc_v2';
var defaults={timeFrom:'10:00',timeTo:'13:00',course:'T-OUT-first'};
function load(){try{return Object.assign({},defaults,JSON.parse(localStorage.getItem(SETTINGS_KEY)))}catch(e){return Object.assign({},defaults)}}
function save(s){localStorage.setItem(SETTINGS_KEY,JSON.stringify(s))}

// 예약 슬롯 스캔
function scanSlots(){
  var slots=[];
  var links=document.querySelectorAll('a');
  for(var i=0;i<links.length;i++){
    var a=links[i];
    if(a.textContent.trim()!=='예약')continue;
    var m=a.href.match(/confirmPopup\('([^']+)','([^']+)','(\d{4})','([^']+)','([^']+)'/);
    if(!m)continue;
    var timeStr=m[3].substring(0,2)+':'+m[3].substring(2,4);
    slots.push({date:m[1],id:m[2],time:timeStr,timeRaw:m[3],branch:m[4],course:m[5],element:a,href:a.href});
  }
  return slots;
}

function timeToMin(t){var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1])}

function filterAndSort(slots,s){
  var from=timeToMin(s.timeFrom),to=timeToMin(s.timeTo);
  var filtered=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<=to});
  // 코스 우선순위 정렬
  var pri=s.course;
  if(pri==='T-OUT-first'){
    filtered.sort(function(a,b){
      var order={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
      return (order[a.course]||9)-(order[b.course]||9);
    });
  }else if(pri==='T-IN-first'){
    filtered.sort(function(a,b){
      var order={'T-IN':0,'T-OUT':1,'L-IN':2,'L-OUT':3};
      return (order[a.course]||9)-(order[b.course]||9);
    });
  }else if(pri==='T-OUT-only'){
    filtered=filtered.filter(function(x){return x.course==='T-OUT'});
  }else if(pri==='T-IN-only'){
    filtered=filtered.filter(function(x){return x.course==='T-IN'});
  }
  return filtered;
}

// UI
var s=load();
var panel=document.createElement('div');
panel.id='plazacc-macro-panel';
panel.style.cssText='position:fixed;top:10px;right:10px;width:280px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
panel.innerHTML=''+
'<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v2</div>'+
'<div style="padding:12px" id="m-body">'+
'<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
'<div style="margin:8px 0"><b>시간 범위</b><br>'+
'<input type="time" id="m-from" value="'+s.timeFrom+'" style="padding:4px;font-size:14px;width:100px"> ~ '+
'<input type="time" id="m-to" value="'+s.timeTo+'" style="padding:4px;font-size:14px;width:100px"></div>'+
'<div style="margin:8px 0"><b>코스 우선순위</b><br>'+
'<select id="m-course" style="padding:4px;font-size:13px;width:100%">'+
'<option value="T-OUT-first"'+(s.course==='T-OUT-first'?' selected':'')+'>타이거OUT 우선 (전체)</option>'+
'<option value="T-IN-first"'+(s.course==='T-IN-first'?' selected':'')+'>타이거IN 우선 (전체)</option>'+
'<option value="T-OUT-only"'+(s.course==='T-OUT-only'?' selected':'')+'>타이거OUT만</option>'+
'<option value="T-IN-only"'+(s.course==='T-IN-only'?' selected':'')+'>타이거IN만</option>'+
'</select></div>'+
'<div style="display:flex;gap:6px;margin-top:10px">'+
'<button id="m-scan" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">스캔</button>'+
'<button id="m-go" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">바로 클릭!</button>'+
'</div>'+
'<div style="display:flex;gap:6px;margin-top:6px">'+
'<button id="m-wait" style="flex:1;padding:10px;background:#2d6a4f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">10시 대기</button>'+
'<button id="m-stop" style="flex:1;padding:10px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none">중지</button>'+
'</div>'+
'<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5">대기 중. 스캔 또는 10시 대기를 누르세요.</div>'+
'</div>';
document.body.appendChild(panel);

// 시계
setInterval(function(){
  var n=new Date();
  var el=document.getElementById('m-clock');
  if(el)el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');
},200);

// 드래그
var hdr=document.getElementById('m-header');
var dragging=false,dx,dy;
hdr.onmousedown=function(e){dragging=true;dx=e.clientX-panel.getBoundingClientRect().left;dy=e.clientY-panel.getBoundingClientRect().top};
document.onmousemove=function(e){if(!dragging)return;panel.style.left=(e.clientX-dx)+'px';panel.style.top=(e.clientY-dy)+'px';panel.style.right='auto'};
document.onmouseup=function(){dragging=false};

function getSettings(){
  return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,course:document.getElementById('m-course').value};
}
function setStatus(html){document.getElementById('m-status').innerHTML=html}

// 스캔 버튼
document.getElementById('m-scan').onclick=function(){
  var s=getSettings();save(s);
  var slots=scanSlots();
  var matched=filterAndSort(slots,s);
  var html='<b>전체 '+slots.length+'개 슬롯</b>, 조건 매칭 <b>'+matched.length+'개</b><br>';
  matched.slice(0,8).forEach(function(x){
    html+='<span style="color:'+(x.course.indexOf('T-')===0?'#2d6a4f':'#666')+'">'+x.time+' '+x.course+'</span><br>';
  });
  if(matched.length>8)html+='... 외 '+(matched.length-8)+'개';
  if(matched.length===0)html+='<span style="color:red">조건에 맞는 슬롯 없음</span>';
  setStatus(html);
};

// 바로 클릭 버튼
document.getElementById('m-go').onclick=function(){
  var s=getSettings();save(s);
  var slots=scanSlots();
  var matched=filterAndSort(slots,s);
  if(matched.length===0){
    setStatus('<span style="color:red">조건에 맞는 슬롯 없음! (전체 '+slots.length+'개)</span>');
    return;
  }
  var target=matched[0];
  setStatus('<b style="color:#2d6a4f">클릭! '+target.time+' '+target.course+'</b><br>팝업을 확인하세요!');
  target.element.click();
  try{var ac=window.AudioContext||window.webkitAudioContext;var c=new ac();var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start();o.stop(c.currentTime+0.3)}catch(e){}
};

// 10시 대기 버튼
var waitTimer=null;
document.getElementById('m-wait').onclick=function(){
  var s=getSettings();save(s);
  document.getElementById('m-wait').style.display='none';
  document.getElementById('m-stop').style.display='block';
  setStatus('<b style="color:#e65100">10:00 대기 중...</b><br>'+s.timeFrom+'~'+s.timeTo+' / '+s.course+'<br>10시에 자동으로 클릭합니다');
  waitTimer=setInterval(function(){
    var now=new Date();
    var h=now.getHours(),m=now.getMinutes(),sec=now.getSeconds();
    if(h===10&&m===0&&sec<=3){
      clearInterval(waitTimer);waitTimer=null;
      // 자동 클릭 시도
      var attempt=function(count){
        var slots=scanSlots();
        var matched=filterAndSort(slots,getSettings());
        if(matched.length>0){
          var target=matched[0];
          setStatus('<b style="color:#2d6a4f">성공! '+target.time+' '+target.course+'</b><br>팝업을 확인하세요!');
          target.element.click();
          try{var ac=window.AudioContext||window.webkitAudioContext;var c=new ac();[0,0.3,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.15)})}catch(e){}
          document.getElementById('m-wait').style.display='block';
          document.getElementById('m-stop').style.display='none';
        }else if(count<20){
          setStatus('<b style="color:#1565c0">스캔 #'+count+'</b> - 매칭 없음 (전체 '+slots.length+'개)<br>200ms 후 재시도...');
          setTimeout(function(){attempt(count+1)},200);
        }else{
          setStatus('<span style="color:red">20회 시도 후 매칭 실패</span>');
          document.getElementById('m-wait').style.display='block';
          document.getElementById('m-stop').style.display='none';
        }
      };
      attempt(1);
    }
  },100);
};

// 중지 버튼
document.getElementById('m-stop').onclick=function(){
  if(waitTimer){clearInterval(waitTimer);waitTimer=null}
  document.getElementById('m-wait').style.display='block';
  document.getElementById('m-stop').style.display='none';
  setStatus('중지됨');
};

console.log('[플라자CC 매크로 v2] 로딩 완료!');
})();
