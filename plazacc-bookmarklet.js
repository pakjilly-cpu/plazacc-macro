// 플라자CC 매크로 - 북마클릿 버전 (Tampermonkey 불필요)
(function(){
if(document.getElementById('plazacc-macro-panel')){alert('매크로가 이미 실행 중입니다!');return;}

function load(){
  try{var d=JSON.parse(localStorage.getItem('plazacc-macro-settings'));if(d)return d;}catch(e){}
  return{timeFrom:'06:00',timeTo:'10:00',course:'T-OUT-first'};
}
function save(s){
  try{localStorage.setItem('plazacc-macro-settings',JSON.stringify(s));}catch(e){}
}

function scanSlots(){
  var slots=[];
  var els=document.querySelectorAll('a, button, input[type="button"], span[onclick], td[onclick], div[onclick]');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    var text=(el.textContent||el.value||'').trim();
    var oc=el.getAttribute('onclick')||el.getAttribute('href')||'';
    var m=oc.match(/confirmPopup\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'(\d{4})'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/);
    if(m){slots.push({time:m[3].substring(0,2)+':'+m[3].substring(2,4),course:m[5],element:el});continue;}
    var timeMatch=oc.match(/(\d{2}):?(\d{2})/);
    if(timeMatch&&(text==='예약'||text==='신청'||oc.indexOf('eserv')>=0||oc.indexOf('ooking')>=0)){
      var courseMatch=oc.match(/(T-?OUT|T-?IN|L-?OUT|L-?IN)/i);
      slots.push({time:timeMatch[1]+':'+timeMatch[2],course:courseMatch?courseMatch[1].toUpperCase():'',element:el});
    }
  }
  if(slots.length===0){
    var rows=document.querySelectorAll('table tr');
    for(var r=0;r<rows.length;r++){
      var rt=rows[r].textContent;
      var tm=rt.match(/(\d{2}):(\d{2})/);
      if(!tm)continue;
      var cm=rt.match(/(T[\-_]?OUT|T[\-_]?IN|L[\-_]?OUT|L[\-_]?IN)/i);
      var ce=rows[r].querySelector('a[href],button,[onclick]');
      if(ce)slots.push({time:tm[1]+':'+tm[2],course:cm?cm[1].toUpperCase():'',element:ce});
    }
  }
  return slots;
}

function timeToMin(t){if(!t||t.indexOf(':')<0)return 0;var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1]);}
function cn(c){return{'T-OUT':'타이거OUT','T-IN':'타이거IN','L-OUT':'라이온OUT','L-IN':'라이온IN'}[c]||c||'(미확인)';}

function filterAndSort(slots,s){
  var from=timeToMin(s.timeFrom),to=timeToMin(s.timeTo);
  var f=slots.filter(function(x){var t=timeToMin(x.time);return t>=from&&t<=to;});
  if(s.course==='T-OUT-only')f=f.filter(function(x){return x.course==='T-OUT';});
  else if(s.course==='T-IN-only')f=f.filter(function(x){return x.course==='T-IN';});
  var om=s.course==='T-IN-first'?{'T-IN':0,'T-OUT':1,'L-IN':2,'L-OUT':3}:{'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
  f.sort(function(a,b){var ca=om[a.course]!=null?om[a.course]:9;var cb=om[b.course]!=null?om[b.course]:9;return ca!==cb?ca-cb:timeToMin(a.time)-timeToMin(b.time);});
  return f;
}

function beep(){try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start();o.stop(c.currentTime+0.3);}catch(e){}}

var s=load();
var p=document.createElement('div');
p.id='plazacc-macro-panel';
p.style.cssText='position:fixed;top:10px;right:10px;width:280px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
p.innerHTML=
  '<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">플라자CC 매크로 v2</div>'+
  '<div style="padding:12px" id="m-body">'+
  '<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
  '<div style="margin:8px 0"><b>시간 범위</b><br><input type="time" id="m-from" value="'+s.timeFrom+'" style="padding:4px;font-size:14px;width:100px"> ~ <input type="time" id="m-to" value="'+s.timeTo+'" style="padding:4px;font-size:14px;width:100px"></div>'+
  '<div style="margin:8px 0"><b>코스 우선순위</b><br><select id="m-course" style="padding:4px;font-size:13px;width:100%">'+
  '<option value="T-OUT-first"'+(s.course==='T-OUT-first'?' selected':'')+'>타이거OUT 우선 (전체)</option>'+
  '<option value="T-IN-first"'+(s.course==='T-IN-first'?' selected':'')+'>타이거IN 우선 (전체)</option>'+
  '<option value="T-OUT-only"'+(s.course==='T-OUT-only'?' selected':'')+'>타이거OUT만</option>'+
  '<option value="T-IN-only"'+(s.course==='T-IN-only'?' selected':'')+'>타이거IN만</option>'+
  '</select></div>'+
  '<div style="display:flex;gap:6px;margin-top:10px">'+
  '<button id="m-scan" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">스캔</button>'+
  '<button id="m-go" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">바로 클릭!</button></div>'+
  '<div style="display:flex;gap:6px;margin-top:6px">'+
  '<button id="m-wait" style="flex:1;padding:10px;background:#2d6a4f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">10시 대기</button>'+
  '<button id="m-stop" style="flex:1;padding:10px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none">중지</button></div>'+
  '<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5">대기 중. 스캔 또는 10시 대기를 누르세요.</div>'+
  '</div>';
document.body.appendChild(p);

setInterval(function(){var n=new Date();var el=document.getElementById('m-clock');if(el)el.textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0');},200);

var hdr=document.getElementById('m-header');
var dragging=false,dx,dy;
hdr.onmousedown=function(e){dragging=true;dx=e.clientX-p.getBoundingClientRect().left;dy=e.clientY-p.getBoundingClientRect().top;};
document.onmousemove=function(e){if(!dragging)return;p.style.left=(e.clientX-dx)+'px';p.style.top=(e.clientY-dy)+'px';p.style.right='auto';};
document.onmouseup=function(){dragging=false;};

function gs(){return{timeFrom:document.getElementById('m-from').value,timeTo:document.getElementById('m-to').value,course:document.getElementById('m-course').value};}
function ss(html){document.getElementById('m-status').innerHTML=html;}

document.getElementById('m-scan').onclick=function(){
  var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
  var html='<b>전체 '+slots.length+'개 슬롯</b>, 조건 매칭 <b>'+matched.length+'개</b><br>';
  matched.slice(0,8).forEach(function(x){html+='<span style="color:#2d6a4f">'+x.time+' '+cn(x.course)+'</span><br>';});
  if(matched.length===0)html+='<span style="color:red">조건에 맞는 슬롯 없음</span>';
  ss(html);
};

document.getElementById('m-go').onclick=function(){
  var st=gs();save(st);var slots=scanSlots();var matched=filterAndSort(slots,st);
  if(matched.length===0){ss('<span style="color:red">매칭 슬롯 없음! (전체 '+slots.length+'개)</span>');return;}
  var t=matched[0];ss('<b style="color:#2d6a4f">클릭! '+t.time+' '+cn(t.course)+'</b><br>팝업을 확인하세요!');
  t.element.click();beep();
};

var waitTimer=null;
document.getElementById('m-wait').onclick=function(){
  var st=gs();save(st);
  document.getElementById('m-wait').style.display='none';
  document.getElementById('m-stop').style.display='block';
  ss('<b style="color:#e65100">10:00 대기 중...</b><br>'+st.timeFrom+'~'+st.timeTo+' / '+st.course);
  waitTimer=setInterval(function(){
    var now=new Date();
    if(now.getHours()===10&&now.getMinutes()===0&&now.getSeconds()<=3){
      clearInterval(waitTimer);waitTimer=null;
      (function attempt(c){
        var slots=scanSlots();var matched=filterAndSort(slots,gs());
        if(matched.length>0){
          var t=matched[0];ss('<b style="color:#2d6a4f">성공! '+t.time+' '+cn(t.course)+'</b>');t.element.click();beep();
          document.getElementById('m-wait').style.display='block';document.getElementById('m-stop').style.display='none';
        }else if(c<20){ss('<b style="color:#1565c0">스캔 #'+c+'</b> 재시도...');setTimeout(function(){attempt(c+1);},200);
        }else{ss('<span style="color:red">20회 시도 실패</span>');document.getElementById('m-wait').style.display='block';document.getElementById('m-stop').style.display='none';}
      })(1);
    }
  },100);
};

document.getElementById('m-stop').onclick=function(){
  if(waitTimer){clearInterval(waitTimer);waitTimer=null;}
  document.getElementById('m-wait').style.display='block';document.getElementById('m-stop').style.display='none';ss('중지됨');
};

})();
