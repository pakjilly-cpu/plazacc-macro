(function(){
'use strict';

// MAIN world의 예약 코드에는 chrome.runtime API가 없으므로 DOM 이벤트로 연결한다.
window.addEventListener('plazacc:extension',function(ev){
  var msg={};
  try{msg=JSON.parse(ev.detail||'{}');}catch(e){return;}
  if(!msg.type)return;
  try{
    chrome.runtime.sendMessage({source:'plazacc-main',type:msg.type,data:msg.data||{}},function(response){
      var error=chrome.runtime.lastError;
      window.dispatchEvent(new CustomEvent('plazacc:background',{detail:JSON.stringify({
        type:'EXTENSION_STATUS',action:msg.type,runId:(msg.data||{}).runId||'',ok:!error&&!!(response&&response.ok),error:error?error.message:((response&&response.error)||'')
      })}));
    });
  }catch(e){}
});

chrome.runtime.onMessage.addListener(function(msg,sender,sendResponse){
  if(!msg||msg.source!=='plazacc-background')return;
  if(!document.documentElement||!document.documentElement.getAttribute('data-plazacc-main-ready')){
    sendResponse({ok:false,error:'MAIN scheduler not ready'});
    return;
  }
  try{
    window.dispatchEvent(new CustomEvent('plazacc:background',{detail:JSON.stringify({type:msg.type,runId:msg.runId||''})}));
    sendResponse({ok:true});
  }catch(e){
    sendResponse({ok:false,error:String(e&&e.message||e)});
  }
});
})();
