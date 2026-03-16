// 로더: iframe 안에 매크로 스크립트를 주입
(function(){
  var targets=[document];
  // iframeTopContents 찾기
  try{
    var f=document.getElementById('iframeTopContents');
    if(f&&f.contentDocument&&f.contentDocument.body)targets.unshift(f.contentDocument);
  }catch(e){}
  // 각 타겟에서 confirmPopup이 있는지 확인
  var bestDoc=null;
  for(var i=0;i<targets.length;i++){
    try{
      // 직접 확인
      if(targets[i].querySelector('a[href*="confirmPopup"]')){bestDoc=targets[i];break;}
      // 하위 iframe도 확인
      var subs=targets[i].querySelectorAll('iframe');
      for(var j=0;j<subs.length;j++){
        try{
          var sd=subs[j].contentDocument||subs[j].contentWindow.document;
          if(sd&&sd.querySelector&&sd.querySelector('a[href*="confirmPopup"]')){bestDoc=sd;break;}
        }catch(e2){}
        try{
          var sw=subs[j].contentWindow;
          if(sw&&sw.document&&sw.document.querySelector&&sw.document.querySelector('a[href*="confirmPopup"]')){bestDoc=sw.document;break;}
        }catch(e3){}
      }
      if(bestDoc)break;
    }catch(e){}
  }
  // bestDoc에 매크로 주입, 패널은 메인 페이지에 표시
  if(bestDoc&&bestDoc!==document){
    window.__plazacc_scanDoc=bestDoc;
  }
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/gh/pakjilly-cpu/plazacc-macro@master/plazacc-bookmarklet.js?v='+Date.now();
  document.body.appendChild(s);
})();
