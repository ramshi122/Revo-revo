// 🔥 FIREBASE MODULE
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbaFKRqrD976syNij_fSSuIBSPRtR9vbo",
  authDomain: "revofixer-81a1c.firebaseapp.com",
  databaseURL: "https://revofixer-81a1c-default-rtdb.firebaseio.com",
  projectId: "revofixer-81a1c",
  storageBucket: "revofixer-81a1c.appspot.com",
  messagingSenderId: "1049094387124",
  appId: "1:1049094387124:web:864be9cd7ed7c2455caee1"
};

const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);


// ================= ORIGINAL CODE =================

'use strict';

const SM={
'1':{icon:'1️⃣',label:'1'},
'2':{icon:'2️⃣',label:'2'},
'5':{icon:'5️⃣',label:'5'},
'10':{icon:'🔟',label:'10'},
'pachinko':{icon:'🎰',label:'Pachinko'},
'cashunt':{icon:'🎯',label:'Cash Hunt'},
'coinflip':{icon:'🪙',label:'Coin Flip'},
'crazytime':{icon:'🎪',label:'Crazy Time'}
};

function nk(r){
r=(r||'').toLowerCase();
if(r.includes('cash'))return'cashunt';
if(r.includes('coin'))return'coinflip';
if(r.includes('pach'))return'pachinko';
if(r.includes('crazy'))return'crazytime';
if(r.includes('10'))return'10';
if(r.includes('5'))return'5';
if(r.includes('2'))return'2';
return'1';
}

let liveData=[];


// ================= FIREBASE LIVE DATA =================

async function fetchLiveData(){

return new Promise((resolve)=>{

const spinsRef=ref(db,"crazy_results");

onValue(spinsRef,(snapshot)=>{

const val=snapshot.val();
if(!val)return;

const arr=Object.values(val).reverse().slice(0,50);

const data=arr.map(v=>({
result:v.result||v,
time:v.time||Date.now()
}));

liveData=data;

const t=new Date().toLocaleTimeString();
document.getElementById('linfo').textContent=
`🔥 ${t} · ${data.length} Firebase spins`;

renderTiles(data);
renderFreq(data);

resolve({items:data,isNew:true});

});

});

}


// ================= UI =================

function renderTiles(items){

const row=document.getElementById('resRow');
row.innerHTML='';

items.forEach(it=>{

const k=nk(it.result);
const s=SM[k];

const d=document.createElement('div');
d.innerHTML=`${s.icon} ${s.label}`;
d.style.padding="6px";

row.appendChild(d);

});

}

function renderFreq(items){

const f=document.getElementById('fGrid');
f.innerHTML="Firebase LIVE ACTIVE";

}


// ================= AUTO =================

async function predict(){
await fetchLiveData();
}

document.getElementById('btnPred').onclick=predict;
document.getElementById('btnRef').onclick=predict;

predict();