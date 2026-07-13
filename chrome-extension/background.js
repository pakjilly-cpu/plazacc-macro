'use strict';

var STORE_KEY='plazacc-auto-schedules';
var PREFIX='plazacc-auto:';
var storageMutation=Promise.resolve();

function alarmName(kind,runId){return PREFIX+kind+':'+runId;}

function getSchedules(cb){
  chrome.storage.local.get(STORE_KEY,function(data){cb((data&&data[STORE_KEY])||{});});
}

function putSchedules(schedules,cb){
  var data={};data[STORE_KEY]=schedules;
  chrome.storage.local.set(data,cb||function(){});
}

// runtime 메시지 두 개(schedule/fired/cancel)가 거의 동시에 와도 저장 순서를 보장한다.
function updateSchedules(mutator,done){
  storageMutation=storageMutation.then(function(){
    return new Promise(function(resolve){
      getSchedules(function(schedules){
        try{mutator(schedules);}catch(e){console.log('[플라자CC background] 저장 변경 오류: '+e);}
        putSchedules(schedules,function(){
          try{if(done)done(schedules);}finally{resolve();}
        });
      });
    });
  });
  return storageMutation;
}

function clearRun(runId,reason,done){
  if(!runId){if(done)done();return;}
  ['prep','trigger','recovery'].forEach(function(kind){chrome.alarms.clear(alarmName(kind,runId));});
  updateSchedules(function(schedules){
    if(schedules[runId]){
      delete schedules[runId];
    }
  },function(){
    ['prep','trigger','recovery'].forEach(function(kind){chrome.alarms.clear(alarmName(kind,runId));});
    console.log('[플라자CC background] 일정 해제: '+runId+' ('+(reason||'')+')');
    if(done)done();
  });
}

function removeOldTabSchedules(schedules,tabId,exceptRunId){
  Object.keys(schedules).forEach(function(runId){
    if(runId!==exceptRunId&&schedules[runId].tabId===tabId){
      ['prep','trigger','recovery'].forEach(function(kind){chrome.alarms.clear(alarmName(kind,runId));});
      delete schedules[runId];
    }
  });
}

function scheduleRun(data,sender,sendResponse){
  if(!sender.tab||!data.runId||!Number(data.targetAt)){
    sendResponse({ok:false,error:'invalid schedule'});return;
  }
  var now=Date.now();
  var schedule={runId:data.runId,tabId:sender.tab.id,frameId:sender.frameId,targetAt:Number(data.targetAt),expiresAt:Number(data.expiresAt)||Number(data.targetAt)+30*60*1000,createdAt:now};
  updateSchedules(function(schedules){
    var previous=schedules[schedule.runId]||{};
    if(previous.firedAt)schedule.firedAt=previous.firedAt;
    removeOldTabSchedules(schedules,schedule.tabId,schedule.runId);
    schedules[schedule.runId]=schedule;
  },function(){
    if(schedule.firedAt){
      chrome.alarms.create(alarmName('recovery',schedule.runId),{when:now+8000});
    }else{
      chrome.alarms.create(alarmName('prep',schedule.runId),{when:Math.max(now+1000,schedule.targetAt-20000)});
      chrome.alarms.create(alarmName('trigger',schedule.runId),{when:Math.max(now+1000,schedule.targetAt+750)});
    }
    console.log('[플라자CC background] 이중 감시 등록: '+schedule.runId+' target='+new Date(schedule.targetAt).toISOString());
    sendResponse({ok:true});
  });
}

function wakeSchedule(schedule,type,cb){
  var options={};if(schedule.frameId!==undefined)options.frameId=schedule.frameId;
  chrome.tabs.sendMessage(schedule.tabId,{source:'plazacc-background',type:type,runId:schedule.runId},options,function(response){
    var failed=!!chrome.runtime.lastError||!response||response.ok!==true;
    if(!failed){if(cb)cb(true);return;}
    console.log('[플라자CC background] 프레임 응답 없음, 탭 reload: '+type);
    chrome.tabs.reload(schedule.tabId,function(){
      void chrome.runtime.lastError;
      if(cb)cb(false);
    });
  });
}

function markFired(data,sender,sendResponse){
  var runId=data.runId;
  if(!runId){sendResponse({ok:false,error:'missing runId'});return;}
  var now=Date.now();
  updateSchedules(function(schedules){
    var schedule=schedules[runId]||{runId:runId,tabId:sender.tab&&sender.tab.id,frameId:sender.frameId,targetAt:now,expiresAt:now+30*60*1000,createdAt:now};
    schedule.firedAt=now;
    if(sender.tab)schedule.tabId=sender.tab.id;
    schedule.frameId=sender.frameId;
    schedules[runId]=schedule;
  },function(){
    chrome.alarms.clear(alarmName('prep',runId));
    chrome.alarms.clear(alarmName('trigger',runId));
    chrome.alarms.create(alarmName('recovery',runId),{when:now+8000});
    sendResponse({ok:true});
  });
}

function restoreSchedules(){
  var now=Date.now();
  chrome.tabs.query({url:['*://plazacc.co.kr/*','*://*.plazacc.co.kr/*','*://booking.hanwharesort.co.kr/*']},function(tabs){
    updateSchedules(function(schedules){
      Object.keys(schedules).forEach(function(runId){
        var schedule=schedules[runId];
        if(!schedule||now>schedule.expiresAt){
          delete schedules[runId];return;
        }
      });
    },function(schedules){
      Object.keys(schedules).forEach(function(runId){
        var schedule=schedules[runId];
        if(schedule.firedAt){
          chrome.alarms.create(alarmName('recovery',runId),{when:now+3000});
        }else{
          chrome.alarms.create(alarmName('prep',runId),{when:Math.max(now+1000,schedule.targetAt-20000)});
          chrome.alarms.create(alarmName('trigger',runId),{when:Math.max(now+1500,schedule.targetAt+750)});
        }
      });
      // 어느 탭이 runId를 가진 sessionStorage 소유자인지 background는 알 수 없다.
      // 후보를 모두 깨우고, 각 content의 SCHEDULE_AUTO10 재등록으로 정확한 tab/frame을 확정한다.
      if(tabs&&tabs.length&&Object.keys(schedules).length){
        tabs.forEach(function(tab){
          chrome.tabs.reload(tab.id,function(){void chrome.runtime.lastError;});
        });
      }
    });
  });
}

chrome.runtime.onStartup.addListener(restoreSchedules);
chrome.runtime.onInstalled.addListener(restoreSchedules);

chrome.runtime.onMessage.addListener(function(msg,sender,sendResponse){
  if(!msg||msg.source!=='plazacc-main')return;
  var data=msg.data||{};
  if(msg.type==='SCHEDULE_AUTO10'){
    scheduleRun(data,sender,sendResponse);
    return true;
  }
  if(msg.type==='SCHEDULE_FIRED'){
    markFired(data,sender,sendResponse);
    return true;
  }
  if(msg.type==='CANCEL_SCHEDULE'){
    clearRun(data.runId,data.reason||'cancel',function(){sendResponse({ok:true});});
    return true;
  }
});

chrome.alarms.onAlarm.addListener(function(alarm){
  if(!alarm.name.startsWith(PREFIX))return;
  var rest=alarm.name.substring(PREFIX.length);
  var split=rest.indexOf(':');
  if(split<0)return;
  var kind=rest.substring(0,split),runId=rest.substring(split+1);
  getSchedules(function(schedules){
    var schedule=schedules[runId];
    if(!schedule)return;
    if(Date.now()>schedule.expiresAt){clearRun(runId,'expired');return;}
    if(kind==='prep'){
      wakeSchedule(schedule,'PREPARE_AUTO10');
    }else if(kind==='trigger'){
      wakeSchedule(schedule,'TRIGGER_AUTO10',function(){
        // 페이지가 fired 확인을 보내지 못한 경우 한 번 더 복구한다.
        chrome.alarms.create(alarmName('recovery',runId),{when:Date.now()+5000});
      });
    }else if(kind==='recovery'){
      console.log('[플라자CC background] 진행 상태 복구 확인: '+runId);
      wakeSchedule(schedule,'RECOVER_AUTO10',function(){
        getSchedules(function(latest){
          if(latest[runId])chrome.alarms.create(alarmName('recovery',runId),{when:Date.now()+10000});
        });
      });
    }
  });
});
