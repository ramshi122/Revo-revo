/* REVO FIXER: CasinoScores live results list + updates the existing prediction box only. */
(function () {
  'use strict';
  var lastRoundKey = '';
  var busy = false;
  var timer = null;
  var counts = {'1':21,'2':13,'5':7,'10':4,'Coin Flip':4,'Pachinko':2,'Cash Hunt':2,'Crazy Time':1};
  var labels = ['1','2','5','10','Coin Flip','Pachinko','Cash Hunt','Crazy Time'];
  function el(id){ return document.getElementById(id); }
  function normalize(value){
    var s=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(s==='1'||s==='1x')return '1';
    if(s==='2'||s==='2x')return '2';
    if(s==='5'||s==='5x')return '5';
    if(s==='10'||s==='10x')return '10';
    if(s.indexOf('coinflip')>=0)return 'Coin Flip';
    if(s.indexOf('pachinko')>=0)return 'Pachinko';
    if(s.indexOf('cashhunt')>=0)return 'Cash Hunt';
    if(s.indexOf('crazytime')>=0||s.indexOf('crazybonus')>=0)return 'Crazy Time';
    return null;
  }
  function ensureList(){
    if(el('ctLiveResultsList'))return;
    var box=document.createElement('section');
    box.id='ctLiveResults';
    box.style.cssText='margin:10px 16px 16px;background:rgba(0,0,0,.86);border:1px solid rgba(255,215,0,.25);border-radius:12px;padding:10px;color:#fff;';
    box.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="font-size:12px;color:#FFD700">LIVE RESULTS</strong><span id="ctLiveStatus" style="font-size:9px;color:#aaa">Loading</span></div><div id="ctLiveResultsList" style="max-height:260px;overflow:auto"></div>';
    var target=el('csqHotStrip');
    if(target&&target.parentNode)target.parentNode.insertBefore(box,target);
    else {
      var page=el('page2');
      if(page)page.appendChild(box);
    }
  }
  function updatePrediction(outcomes){
    if(!outcomes.length)return;
    var sample=outcomes.slice(0,30);
    var score=Object.assign({},counts);
    sample.forEach(function(v){if(score[v]!==undefined)score[v]+=1;});
    var pick=labels[0];
    labels.forEach(function(v){if(score[v]>score[pick])pick=v;});
    var icon=el('csqSignalIcon'), num=el('csqSignalNum'), pickText=el('csqPickText');
    var fill=el('csqConfFill'), pct=el('csqConfPct'), src=el('csqSrcText');
    var classes={'1':'signal-1','2':'signal-2','5':'signal-5','10':'signal-10','Coin Flip':'signal-coinflip','Pachinko':'signal-pachinko','Cash Hunt':'signal-cashunt','Crazy Time':'signal-crazytime'};
    if(num)num.textContent=pick;
    if(pickText)pickText.textContent=pick;
    if(icon){
      icon.className='cpb-signal';
      icon.style.background=({'1':'#c44569','2':'#3742fa','5':'#2ed573','10':'#ff6348','Coin Flip':'#2ed573','Pachinko':'#ffa502','Cash Hunt':'#5352ed','Crazy Time':'#7d3cff'})[pick]||'#333';
    }
    if(fill)fill.style.width='0%';
    if(pct)pct.textContent='—';
    if(src)src.textContent='CasinoScores live feed';
  }
  function render(data){
    ensureList();
    var list=el('ctLiveResultsList');
    if(!data||!Array.isArray(data.results)||!data.results.length){
      if(el('ctLiveStatus'))el('ctLiveStatus').textContent='No live results';
      if(list)list.innerHTML='';
      return;
    }
    var rows=data.results.map(function(r){
      return {outcome:normalize(r.outcome),roundId:r.roundId||'',timestamp:r.timestamp||null,label:r.label||''};
    }).filter(function(r){return !!r.outcome;});
    if(!rows.length){
      if(el('ctLiveStatus'))el('ctLiveStatus').textContent='No live results';
      if(list)list.innerHTML='';
      return;
    }
    if(el('ctLiveStatus'))el('ctLiveStatus').textContent='LIVE · '+rows.length;
    if(list){
      list.innerHTML=rows.map(function(r,i){
        var time=r.timestamp?new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
        return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 2px;border-bottom:1px solid rgba(255,255,255,.07)"><span style="font-size:10px;color:#aaa;width:22px">'+(i+1)+'</span><strong style="flex:1;font-size:12px;color:#fff">'+r.outcome+'</strong><span style="font-size:9px;color:#aaa">'+time+'</span></div>';
      }).join('');
    }
    var latest=rows[0];
    var key=String(latest.roundId||latest.timestamp||latest.outcome);
    if(key!==lastRoundKey){
      lastRoundKey=key;
      updatePrediction(rows.map(function(r){return r.outcome;}));
    }
  }
  function poll(){
    if(busy||document.hidden)return;
    busy=true;
    fetch('/api/crazy-time/results',{cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error('feed unavailable');return r.json();})
      .then(render)
      .catch(function(){ensureList();if(el('ctLiveStatus'))el('ctLiveStatus').textContent='Feed unavailable';})
      .finally(function(){busy=false;});
  }
  function start(){ensureList();poll();if(timer)clearInterval(timer);timer=setInterval(poll,15000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  document.addEventListener('visibilitychange',function(){if(!document.hidden)poll();});
})();