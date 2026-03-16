// ==UserScript==
// @name         플라자CC 예약 매크로 v2
// @namespace    plazacc-macro
// @version      2.2
// @description  플라자CC 골프장 예약 자동화
// @match        *://www.plazacc.co.kr/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function(){
'use strict';

// localStorage 기반 설정 저장/로드
function load(){
  try{
    var d=JSON.parse(localStorage.getItem('plazacc-macro-settings'));
    if(d)return d;
  }catch(e){}
  return{timeFrom:'06:00',timeTo:'10:00',course:'T-OUT-first'};
}
function save(s){
  try{localStorage.setItem('plazacc-macro-settings',JSON.stringify(s))}catch(e){}
}

// 예약 슬롯 스캔 - 다양한 패턴 시도
function scanSlots(){
  var slots=[];
  // 방법1: 예약 버튼/링크 찾기
  var links=document.querySelectorAll('a, button, input[type="button"], span[onclick], td[onclick]');
  for(var i=0;i<links.length;i++){
    var el=links[i];
    var text=(el.textContent||el.value||'').trim();
    var onclick=el.getAttribute('onclick')||el.getAttribute('href')||'';
    // confirmPopup 패턴
    var m=onclick.match(/confirmPopup\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'(\d{4})'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/);
    if(m){
      var timeStr=m[3].substring(0,2)+':'+m[3].substring(2,4);
      slots.push({date:m[1],id:m[2],time:timeStr,timeRaw:m[3],branch:m[4],course:m[5],element:el,onclick:onclick});
      continue;
    }
    // fnReserve 패턴 (플라자CC에서 흔한 패턴)
    var m2=onclick.match(/fnReserve\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/);
    if(m2){
      slots.push({date:m2[1],id:m2[2],time:m2[3]||'',timeRaw:m2[3]||'',branch:'',course:m2[4]||'',element:el,onclick:onclick});
      continue;
    }
    // 시간 패턴이 있는 예약 관련 요소
    var timeMatch=onclick.match(/(\d{2}):?(\d{2})/);
    if(timeMatch && (text==='예약'||text==='신청'||onclick.indexOf('reserv')>=0||onclick.indexOf('Reserv')>=0||onclick.indexOf('booking')>=0)){
      var t=timeMatch[1]+':'+timeMatch[2];
      // 코스명 추출 시도
      var courseMatch=onclick.match(/(T-?OUT|T-?IN|L-?OUT|L-?IN|타이거|라이온|tiger|lion)/i);
      var courseName2=courseMatch?courseMatch[1].toUpperCase().replace(/타이거/,'T-').replace(/라이온/,'L-'):'';
      slots.push({date:'',id:'',time:t,timeRaw:timeMatch[1]+timeMatch[2],branch:'',course:courseName2,element:el,onclick:onclick});
    }
  }

  // 방법2: 테이블 기반 예약 스캔 (골프장 예약은 보통 테이블)
  if(slots.length===0){
    var tables=document.querySelectorAll('table');
    for(var t=0;t<tables.length;t++){
      var rows=tables[t].querySelectorAll('tr');
      for(var r=0;r<rows.length;r++){
        var cells=rows[r].querySelectorAll('td');
        var rowText=rows[r].textContent;
        var timeMatch2=rowText.match(/(\d{2}):(\d{2})/);
        if(!timeMatch2)continue;
        var timeVal=timeMatch2[1]+':'+timeMatch2[2];
        // 코스 추출
        var courseMatch2=rowText.match(/(T[\-_]?OUT|T[\-_]?IN|L[\-_]?OUT|L[\-_]?IN|타이거\s*OUT|타이거\s*IN|라이온\s*OUT|라이온\s*IN)/i);
        var courseVal=courseMatch2?courseMatch2[1].replace(/\s/g,'').replace(/타이거/,'T-').replace(/라이온/,'L-').toUpperCase():'';
        // 클릭 가능한 요소 찾기
        var clickEl=rows[r].querySelector('a[href], button, input[type="button"], [onclick]');
        if(clickEl){
          slots.push({date:'',id:'',time:timeVal,timeRaw:timeMatch2[1]+timeMatch2[2],branch:'',course:courseVal,element:clickEl,onclick:clickEl.getAttribute('onclick')||''});
        }
      }
    }
  }
  return slots;
}

function timeToMin(t){
  if(!t||t.indexOf(':')<0)return 0;
  var p=t.split(':');return parseInt(p[0])*60+parseInt(p[1]);
}
function courseName(c){
  return{'T-OUT':'타이거OUT','T-IN':'타이거IN','L-OUT':'라이온OUT','L-IN':'라이온IN'}[c]||c||'(미확인)';
}

function filterAndSort(slots,s){
  var from=timeToMin(s.timeFrom),to=timeToMin(s.timeTo);
  var filtered=slots.filter(function(x){
    var t=timeToMin(x.time);
    if(from>0||to>0){return t>=from&&t<=to}
    return true;
  });
  var pri=s.course;
  if(pri==='T-OUT-only'){
    filtered=filtered.filter(function(x){return x.course==='T-OUT'});
  }else if(pri==='T-IN-only'){
    filtered=filtered.filter(function(x){return x.course==='T-IN'});
  }
  var orderMap;
  if(pri==='T-IN-first'){
    orderMap={'T-IN':0,'T-OUT':1,'L-IN':2,'L-OUT':3};
  }else{
    orderMap={'T-OUT':0,'T-IN':1,'L-OUT':2,'L-IN':3};
  }
  filtered.sort(function(a,b){
    var ca=(orderMap[a.course]!=null?orderMap[a.course]:9);
    var cb=(orderMap[b.course]!=null?orderMap[b.course]:9);
    if(ca!==cb)return ca-cb;
    return timeToMin(a.time)-timeToMin(b.time);
  });
  return filtered;
}

// UI
var s=load();
var panel=document.createElement('div');
panel.id='plazacc-macro-panel';
panel.style.cssText='position:fixed;top:10px;right:10px;width:280px;background:#fff;border:3px solid #2d6a4f;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483647;font-family:sans-serif;font-size:13px;padding:0;';
panel.innerHTML=''+
'<div style="background:#2d6a4f;color:#fff;padding:10px 14px;border-radius:9px 9px 0 0;font-size:15px;font-weight:bold;cursor:move" id="m-header">\uD50C\uB77C\uC790CC \uB9E4\uD06C\uB85C v2</div>'+
'<div style="padding:12px" id="m-body">'+
'<div style="text-align:center;font-size:22px;font-weight:bold;color:#2d6a4f;font-family:monospace" id="m-clock">--:--:--</div>'+
'<div style="margin:8px 0"><b>\uC2DC\uAC04 \uBC94\uC704</b><br>'+
'<input type="time" id="m-from" value="'+s.timeFrom+'" style="padding:4px;font-size:14px;width:100px"> ~ '+
'<input type="time" id="m-to" value="'+s.timeTo+'" style="padding:4px;font-size:14px;width:100px"></div>'+
'<div style="margin:8px 0"><b>\uCF54\uC2A4 \uC6B0\uC120\uC21C\uC704</b><br>'+
'<select id="m-course" style="padding:4px;font-size:13px;width:100%">'+
'<option value="T-OUT-first"'+(s.course==='T-OUT-first'?' selected':'')+'>타이거OUT 우선 (전체)</option>'+
'<option value="T-IN-first"'+(s.course==='T-IN-first'?' selected':'')+'>타이거IN 우선 (전체)</option>'+
'<option value="T-OUT-only"'+(s.course==='T-OUT-only'?' selected':'')+'>타이거OUT만</option>'+
'<option value="T-IN-only"'+(s.course==='T-IN-only'?' selected':'')+'>타이거IN만</option>'+
'</select></div>'+
'<div style="display:flex;gap:6px;margin-top:10px">'+
'<button id="m-scan" style="flex:1;padding:10px;background:#1565c0;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">\uC2A4\uCE94</button>'+
'<button id="m-go" style="flex:1;padding:10px;background:#d32f2f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">\uBC14\uB85C \uD074\uB9AD!</button>'+
'</div>'+
'<div style="display:flex;gap:6px;margin-top:6px">'+
'<button id="m-wait" style="flex:1;padding:10px;background:#2d6a4f;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer">10\uC2DC \uB300\uAE30</button>'+
'<button id="m-stop" style="flex:1;padding:10px;background:#757575;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:bold;cursor:pointer;display:none">\uC911\uC9C0</button>'+
'</div>'+
'<div id="m-status" style="margin-top:8px;padding:8px;background:#f5f5f5;border-radius:6px;font-size:12px;min-height:40px;line-height:1.5">\uB300\uAE30 \uC911. \uC2A4\uCE94 \uB610\uB294 10\uC2DC \uB300\uAE30\uB97C \uB204\uB974\uC138\uC694.</div>'+
'<div style="margin-top:6px;text-align:center;font-size:10px;color:#999">\uD398\uC774\uC9C0 URL: <span id="m-url" style="word-break:break-all"></span></div>'+
'</div>';
document.body.appendChild(panel);

// 현재 URL 표시 (디버깅용)
var urlEl=document.getElementById('m-url');
if(urlEl)urlEl.textContent=window.location.href;

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
  var html='<b>\uC804\uCCB4 '+slots.length+'\uAC1C \uC2AC\uB86F</b>, \uC870\uAC74 \uB9E4\uCE6D <b>'+matched.length+'\uAC1C</b><br>';
  matched.slice(0,8).forEach(function(x){
    html+='<span style="color:'+(x.course==='T-IN'||x.course==='T-OUT'?'#2d6a4f':'#666')+'">'+x.time+' '+courseName(x.course)+'</span><br>';
  });
  if(matched.length>8)html+='... \uC678 '+(matched.length-8)+'\uAC1C';
  if(matched.length===0)html+='<span style="color:red">\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC2AC\uB86F \uC5C6\uC74C</span>';
  setStatus(html);
};

// 바로 클릭 버튼
document.getElementById('m-go').onclick=function(){
  var s=getSettings();save(s);
  var slots=scanSlots();
  var matched=filterAndSort(slots,s);
  if(matched.length===0){
    setStatus('<span style="color:red">\uC870\uAC74\uC5D0 \uB9DE\uB294 \uC2AC\uB86F \uC5C6\uC74C! (\uC804\uCCB4 '+slots.length+'\uAC1C)</span>');
    return;
  }
  var target=matched[0];
  setStatus('<b style="color:#2d6a4f">\uD074\uB9AD! '+target.time+' '+courseName(target.course)+'</b><br>\uD31D\uC5C5\uC744 \uD655\uC778\uD558\uC138\uC694!');
  target.element.click();
  try{var ac=window.AudioContext||window.webkitAudioContext;var c=new ac();var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start();o.stop(c.currentTime+0.3)}catch(e){}
};

// 10시 대기 버튼
var waitTimer=null;
document.getElementById('m-wait').onclick=function(){
  var s=getSettings();save(s);
  document.getElementById('m-wait').style.display='none';
  document.getElementById('m-stop').style.display='block';
  setStatus('<b style="color:#e65100">10:00 \uB300\uAE30 \uC911...</b><br>'+s.timeFrom+'~'+s.timeTo+' / '+s.course+'<br>10\uC2DC\uC5D0 \uC790\uB3D9\uC73C\uB85C \uD074\uB9AD\uD569\uB2C8\uB2E4');
  waitTimer=setInterval(function(){
    var now=new Date();
    var h=now.getHours(),m=now.getMinutes(),sec=now.getSeconds();
    if(h===10&&m===0&&sec<=3){
      clearInterval(waitTimer);waitTimer=null;
      var attempt=function(count){
        var slots=scanSlots();
        var matched=filterAndSort(slots,getSettings());
        if(matched.length>0){
          var target=matched[0];
          setStatus('<b style="color:#2d6a4f">\uC131\uACF5! '+target.time+' '+courseName(target.course)+'</b><br>\uD31D\uC5C5\uC744 \uD655\uC778\uD558\uC138\uC694!');
          target.element.click();
          try{var ac=window.AudioContext||window.webkitAudioContext;var c=new ac();[0,0.3,0.6].forEach(function(d){var o=c.createOscillator();o.connect(c.destination);o.frequency.value=880;o.start(c.currentTime+d);o.stop(c.currentTime+d+0.15)})}catch(e){}
          document.getElementById('m-wait').style.display='block';
          document.getElementById('m-stop').style.display='none';
        }else if(count<20){
          setStatus('<b style="color:#1565c0">\uC2A4\uCE94 #'+count+'</b> - \uB9E4\uCE6D \uC5C6\uC74C (\uC804\uCCB4 '+slots.length+'\uAC1C)<br>200ms \uD6C4 \uC7AC\uC2DC\uB3C4...');
          setTimeout(function(){attempt(count+1)},200);
        }else{
          setStatus('<span style="color:red">20\uD68C \uC2DC\uB3C4 \uD6C4 \uB9E4\uCE6D \uC2E4\uD328</span>');
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
  setStatus('\uC911\uC9C0\uB428');
};

console.log('[플라자CC 매크로 v2.2] 로딩 완료! URL: '+window.location.href);
})();
