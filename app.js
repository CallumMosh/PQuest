/* ══════════════════════════════════════════════════════════════
   QUEST — application logic
   ══════════════════════════════════════════════════════════════ */

const CFG = window.QUEST_CONFIG;
const sb = supabase.createClient(CFG.url, CFG.key);

/* ---- the six stats (definition) ---- */
const STAT_DEFS = [
  { key:'vigor',      label:'Vigor',      flavor:'Body · gym · running · sleep',   color:'var(--vigor)' },
  { key:'discipline', label:'Discipline', flavor:'Habits · consistency · showing up', color:'var(--discipline)' },
  { key:'charm',      label:'Charm',      flavor:'Friends · social · connection',  color:'var(--charm)' },
  { key:'intellect',  label:'Intellect',  flavor:'Reading · learning · the mind',  color:'var(--intellect)' },
  { key:'craft',      label:'Craft',      flavor:'Making · music · art · building', color:'var(--craft)' },
  { key:'fortune',    label:'Fortune',    flavor:'Money · career · adulting',      color:'var(--fortune)' },
];
const STAT_COLOR = Object.fromEntries(STAT_DEFS.map(s => [s.key, s.color]));
const STAT_LABEL = Object.fromEntries(STAT_DEFS.map(s => [s.key, s.label]));

const DAYS = [
  {k:'mon',l:'Mon'},{k:'tue',l:'Tue'},{k:'wed',l:'Wed'},{k:'thu',l:'Thu'},
  {k:'fri',l:'Fri'},{k:'sat',l:'Sat'},{k:'sun',l:'Sun'}
];
const DAY_INDEX = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6}; // JS getDay()

/* ---- XP / rank tuning ---- */
const XP_PER_DIFFICULTY = 12;                 // a diff-3 tick = 36 xp
// steeper curve: each rank costs much more than the last (Rank V is a real feat)
const STAT_RANK_THRESHOLDS = [0,200,600,1400,2800,5000,8500,13500]; // rank I,II,III...
const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
// gentle diminishing returns: 1st tick of a stat/day full, then tapering
const DR_FACTORS = [1, 0.6, 0.4, 0.25];
function drFactor(i){ return DR_FACTORS[Math.min(i, DR_FACTORS.length-1)]; }

/* ---- bonds tuning ---- */
const HANGOUT_CHARM_XP = 24;                   // charm gained per logged hangout
const BOND_XP_PER_HANGOUT = 100;
const BOND_RANK_THRESHOLDS = [0,100,250,450,700,1000,1350,1750,2200,2700,3300]; // ranks 1..10+
const STALE_DAYS = 10;                          // flag a bond if unseen this long
const REL = {
  friend:  {label:'Friend',  color:'var(--crimson)'},
  family:  {label:'Family',  color:'var(--intellect)'},
  partner: {label:'Partner', color:'var(--charm)'},
};

/* ---- themes (reskin the accent) ---- */
const THEMES = {
  crimson: {label:'Crimson', c:'#e4002b', b:'#a0001c'},
  azure:   {label:'Azure',   c:'#2f9bff', b:'#1c5fa0'},
  gold:    {label:'Gold',    c:'#f0a500', b:'#a87400'},
  violet:  {label:'Violet',  c:'#8b5cf6', b:'#5b3aa8'},
  rose:    {label:'Rose',    c:'#ff5c8a', b:'#b03a5f'},
  mono:    {label:'Mono',    c:'#e8e8e8', b:'#9a9a9a'},
};

/* ---- achievements catalogue ----
   each: key, name, desc, cat, glyph, cond(); optional title / theme reward */
const ACHIEVEMENTS = [
  // streak
  {key:'spark',      cat:'streak', glyph:'▲', name:'Spark',      desc:'3-day streak',           cond:()=>computeStreak()>=3},
  {key:'kindling',   cat:'streak', glyph:'▲', name:'Kindling',   desc:'7-day streak',           cond:()=>computeStreak()>=7,   title:'The Steady'},
  {key:'ablaze',     cat:'streak', glyph:'▲', name:'Ablaze',     desc:'30-day streak',          cond:()=>computeStreak()>=30,  title:'The Relentless', theme:'azure'},
  {key:'inferno',    cat:'streak', glyph:'▲', name:'Inferno',    desc:'100-day streak',         cond:()=>computeStreak()>=100, title:'The Unbroken',   theme:'gold'},
  // stats
  {key:'adept',      cat:'stat',   glyph:'✦', name:'Adept',      desc:'Reach Rank III in a stat',   cond:()=>maxStatRank()>=3},
  {key:'master',     cat:'stat',   glyph:'✦', name:'Master',     desc:'Reach Rank V in a stat',     cond:()=>maxStatRank()>=5,  title:'The Master',      theme:'violet'},
  {key:'rounded',    cat:'stat',   glyph:'✦', name:'Well-Rounded', desc:'Rank III in every stat',   cond:()=>minStatRank()>=3,  title:'Well-Rounded'},
  {key:'renaissance',cat:'stat',   glyph:'✦', name:'Renaissance',desc:'Rank V in every stat',       cond:()=>minStatRank()>=5,  title:'The Renaissance', theme:'mono'},
  // bonds
  {key:'reachout',   cat:'bond',   glyph:'◆', name:'Reach Out',  desc:'Add your first bond',        cond:()=>BONDS.length>=1},
  {key:'companion',  cat:'bond',   glyph:'◆', name:'Companion',  desc:'Reach Rank III with someone',cond:()=>maxBondRank()>=3},
  {key:'confidant',  cat:'bond',   glyph:'◆', name:'Confidant',  desc:'Reach Rank V with someone',  cond:()=>maxBondRank()>=5,  title:'The Confidant',   theme:'rose'},
  {key:'soulmate',   cat:'bond',   glyph:'◆', name:'Soulmate',   desc:'Reach Rank X with someone',  cond:()=>maxBondRank()>=10, title:'Soulmate'},
  {key:'circle',     cat:'bond',   glyph:'◆', name:'Social Circle', desc:'Hold 5 bonds at once',    cond:()=>BONDS.length>=5},
];

/* ---- in-memory state ---- */
let USER = null;
let PROFILE = null;
let STATS = {};        // key -> {id, xp}
let GOALS = [];        // active goals
let COMPLETIONS = [];  // recent completions ({goal_id, done_on})
let BONDS = [];        // people ({id,name,relationship,xp,last_seen})
let BOND_LOGS = [];    // hangouts ({bond_id, logged_on})
let EARNED = new Set();     // achievement keys earned
let EARNED_DATES = {};      // key -> earned_on
let POPUP_QUEUE = [];       // achievements waiting to celebrate
let POPUP_SHOWING = false;
let DECAY_APPLIED = [];     // stats that slipped on this load: {key, amount}
let CURRENT_SCREEN = 'home';

/* ══════════════════════════════════════════════
   DATE HELPERS
   ══════════════════════════════════════════════ */
function todayStr(){ const d=new Date(); return ymd(d); }
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); x.setHours(0,0,0,0); return x; }
function daysAgo(dateStr){ const a=new Date(dateStr+'T00:00:00'); const b=new Date(todayStr()+'T00:00:00'); return Math.round((b-a)/86400000); }

/* ══════════════════════════════════════════════
   STAT / LEVEL MATHS
   ══════════════════════════════════════════════ */
function rankFromXp(xp){
  let r=0;
  for(let i=0;i<STAT_RANK_THRESHOLDS.length;i++){ if(xp>=STAT_RANK_THRESHOLDS[i]) r=i+1; }
  return Math.max(1,r);
}
function rankProgress(xp){
  const r=rankFromXp(xp);
  const lo=STAT_RANK_THRESHOLDS[r-1] ?? 0;
  const hi=STAT_RANK_THRESHOLDS[r] ?? (lo+1200);
  return Math.max(0,Math.min(1,(xp-lo)/(hi-lo)));
}
function totalXp(){ return STAT_DEFS.reduce((s,d)=>s+(STATS[d.key]?.xp||0),0); }
function maxStatRank(){ return Math.max(...STAT_DEFS.map(d=>rankFromXp(STATS[d.key]?.xp||0))); }
function minStatRank(){ return Math.min(...STAT_DEFS.map(d=>rankFromXp(STATS[d.key]?.xp||0))); }
function maxBondRank(){ return BONDS.length?Math.max(...BONDS.map(b=>bondRank(b.xp||0))):0; }
function levelInfo(){
  // level curve: cumulative xp needed rises steeply each level
  const total=totalXp();
  let lvl=1, need=300, spent=0;
  while(total-spent>=need){ spent+=need; lvl++; need=Math.round(need*1.25); }
  const into=total-spent;
  return { level:lvl, pct:Math.round(into/need*100), intoNext:into, need };
}

/* xp gained this ISO week, per stat — applies diminishing returns per day */
function weeklyDeltaByStat(){
  const wk=startOfWeek(new Date());
  const out={};
  STAT_DEFS.forEach(d=>out[d.key]=0);
  const goalById=Object.fromEntries(GOALS.map(g=>[g.id,g]));
  const byDayStat={}; // "day|stat" -> [base,base,...]
  COMPLETIONS.forEach(c=>{
    if(new Date(c.done_on+'T00:00:00')<wk) return;
    const g=goalById[c.goal_id]; if(!g) return;
    const k=c.done_on+'|'+g.stat_key;
    (byDayStat[k]=byDayStat[k]||[]).push(g.difficulty*XP_PER_DIFFICULTY);
  });
  Object.entries(byDayStat).forEach(([k,bases])=>{
    const stat=k.split('|')[1];
    bases.sort((a,b)=>b-a);
    bases.forEach((b,i)=>out[stat]+=Math.round(b*drFactor(i)));
  });
  BOND_LOGS.forEach(b=>{ if(new Date(b.logged_on+'T00:00:00')>=wk) out.charm+=HANGOUT_CHARM_XP; });
  return out;
}

/* DR-adjusted XP earned toward a stat from goal-ticks TODAY */
function todayStatEarned(statKey){
  const t=todayStr();
  const goalById=Object.fromEntries(GOALS.map(g=>[g.id,g]));
  const bases=COMPLETIONS
    .filter(c=>c.done_on===t && goalById[c.goal_id] && goalById[c.goal_id].stat_key===statKey)
    .map(c=>goalById[c.goal_id].difficulty*XP_PER_DIFFICULTY)
    .sort((a,b)=>b-a);
  let sum=0; bases.forEach((b,i)=>sum+=Math.round(b*drFactor(i)));
  return sum;
}

/* bond rank helpers */
function bondRank(xp){ let r=0; for(let i=0;i<BOND_RANK_THRESHOLDS.length;i++){ if(xp>=BOND_RANK_THRESHOLDS[i]) r=i+1; } return Math.max(1,r); }
function bondProgress(xp){
  const r=bondRank(xp);
  const lo=BOND_RANK_THRESHOLDS[r-1] ?? 0;
  const hi=BOND_RANK_THRESHOLDS[r] ?? (lo+600);
  return Math.max(0,Math.min(1,(xp-lo)/(hi-lo)));
}

/* consecutive-day streak up to today — hangouts count too */
function computeStreak(){
  const set=new Set(COMPLETIONS.map(c=>c.done_on));
  BOND_LOGS.forEach(b=>set.add(b.logged_on));
  let streak=0; const d=new Date();
  // allow today to be incomplete without breaking streak
  if(!set.has(ymd(d))) d.setDate(d.getDate()-1);
  while(set.has(ymd(d))){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}

/* is a goal scheduled today? */
function scheduledToday(g){
  if(g.days && g.days.length){ const jd=new Date().getDay(); return g.days.some(k=>DAY_INDEX[k]===jd); }
  return true; // anytime goals appear daily
}
function doneToday(goalId){ const t=todayStr(); return COMPLETIONS.some(c=>c.goal_id===goalId && c.done_on===t); }

/* weekly goal completion %, across all active goals */
function weeklyPct(){
  if(!GOALS.length) return 0;
  const wk=startOfWeek(new Date());
  let hit=0, target=0;
  GOALS.forEach(g=>{
    const want = (g.days&&g.days.length) ? g.days.length : (g.times_per_week||1);
    const got = COMPLETIONS.filter(c=>c.goal_id===g.id && new Date(c.done_on+'T00:00:00')>=wk).length;
    target+=want; hit+=Math.min(got,want);
  });
  return target? Math.round(hit/target*100):0;
}

/* auto-levelup suggestion: consistent 3 weeks, not snoozed */
function levelUpSuggestion(){
  const t=todayStr();
  for(const g of GOALS){
    if(!g.auto_levelup) continue;
    if(g.snooze_until && g.snooze_until>=t) continue;
    const recent=COMPLETIONS.filter(c=>c.goal_id===g.id && daysAgo(c.done_on)<=21).length;
    if(recent>=9) return g;
  }
  return null;
}

/* ── history / momentum ── */
function activityByDay(){
  const m={};
  COMPLETIONS.forEach(c=>m[c.done_on]=(m[c.done_on]||0)+1);
  BOND_LOGS.forEach(b=>m[b.logged_on]=(m[b.logged_on]||0)+1);
  return m;
}
function bestStreak(){
  const act=activityByDay(); const days=Object.keys(act).sort();
  let best=0,run=0,prev=null;
  days.forEach(ds=>{
    if(prev){ const gap=Math.round((new Date(ds+'T00:00:00')-new Date(prev+'T00:00:00'))/86400000);
      run = gap===1 ? run+1 : 1; }
    else run=1;
    if(run>best) best=run; prev=ds;
  });
  return best;
}
function xpInRange(start,end){
  const goalById=Object.fromEntries(GOALS.map(g=>[g.id,g]));
  const byDayStat={};
  COMPLETIONS.forEach(c=>{ const d=new Date(c.done_on+'T00:00:00'); if(d>=start&&d<end){ const g=goalById[c.goal_id]; if(!g)return; const k=c.done_on+'|'+g.stat_key; (byDayStat[k]=byDayStat[k]||[]).push(g.difficulty*XP_PER_DIFFICULTY); } });
  let xp=0; Object.values(byDayStat).forEach(bases=>{ bases.sort((a,b)=>b-a); bases.forEach((b,i)=>xp+=Math.round(b*drFactor(i))); });
  BOND_LOGS.forEach(bl=>{ const d=new Date(bl.logged_on+'T00:00:00'); if(d>=start&&d<end) xp+=HANGOUT_CHARM_XP; });
  return xp;
}
function weeklyBuckets(n){
  const out=[]; const thisMon=startOfWeek(new Date());
  for(let i=n-1;i>=0;i--){
    const ws=new Date(thisMon); ws.setDate(ws.getDate()-i*7);
    const we=new Date(ws); we.setDate(we.getDate()+7);
    const tasks=COMPLETIONS.filter(c=>{const d=new Date(c.done_on+'T00:00:00');return d>=ws&&d<we;}).length
              + BOND_LOGS.filter(b=>{const d=new Date(b.logged_on+'T00:00:00');return d>=ws&&d<we;}).length;
    out.push({ws,label:ws.toLocaleDateString('en-GB',{day:'numeric',month:'short'}),tasks,xp:xpInRange(ws,we)});
  }
  return out;
}
function focusStat(){
  const wk=weeklyDeltaByStat(); let best=null;
  STAT_DEFS.forEach(d=>{ const v=wk[d.key]||0, tot=STATS[d.key]?.xp||0;
    if(!best||v<best.v||(v===best.v&&tot<best.tot)) best={key:d.key,v,tot}; });
  return best;
}

/* ══════════════════════════════════════════════
   DATA LOADING
   ══════════════════════════════════════════════ */
async function seedIfNeeded(){
  // profile
  let { data:prof } = await sb.from('profiles').select('*').eq('id',USER.id).maybeSingle();
  if(!prof){ const r=await sb.from('profiles').insert({id:USER.id}).select().single(); prof=r.data; }
  PROFILE=prof;
  // stats
  let { data:stats } = await sb.from('stats').select('*').eq('user_id',USER.id);
  if(!stats || stats.length<STAT_DEFS.length){
    const have=new Set((stats||[]).map(s=>s.key));
    const toAdd=STAT_DEFS.filter(d=>!have.has(d.key)).map(d=>({user_id:USER.id,key:d.key,label:d.label,xp:0}));
    if(toAdd.length){ await sb.from('stats').insert(toAdd); }
    const r=await sb.from('stats').select('*').eq('user_id',USER.id); stats=r.data;
  }
  STATS={}; stats.forEach(s=>STATS[s.key]={id:s.id,xp:s.xp});
}
async function loadAll(){
  const g=await sb.from('goals').select('*').eq('user_id',USER.id).eq('active',true).order('created_at');
  GOALS=g.data||[];
  const since=ymd(new Date(Date.now()-120*86400000)); // ~17 weeks: covers history charts + long streaks
  const c=await sb.from('completions').select('goal_id,done_on').eq('user_id',USER.id).gte('done_on',since);
  COMPLETIONS=c.data||[];
  const b=await sb.from('bonds').select('*').eq('user_id',USER.id).order('created_at');
  BONDS=b.data||[];
  const bl=await sb.from('bond_logs').select('bond_id,logged_on').eq('user_id',USER.id).gte('logged_on',since);
  BOND_LOGS=bl.data||[];
  const ac=await sb.from('achievements').select('key,earned_on').eq('user_id',USER.id);
  EARNED=new Set((ac.data||[]).map(r=>r.key));
  EARNED_DATES={}; (ac.data||[]).forEach(r=>EARNED_DATES[r.key]=r.earned_on);
}

/* ── weekly decay (applied on load, no server job) ──
   For each fully-completed week since we last checked, each stat that
   fell short of its goals slips a little: shortfall-proportional, ~5% of
   the current rank's band at full neglect, never below the current rank. */
function weeklyTargetFor(g){ return (g.days && g.days.length) ? g.days.length : (g.times_per_week || 1); }
async function applyDecay(){
  DECAY_APPLIED=[];
  const thisMon=startOfWeek(new Date());
  const lastCompletedMon=new Date(thisMon); lastCompletedMon.setDate(lastCompletedMon.getDate()-7);

  if(!PROFILE.decay_through){ // first ever run — start the clock now, no back-decay
    PROFILE.decay_through=ymd(thisMon);
    await sb.from('profiles').update({decay_through:PROFILE.decay_through}).eq('id',USER.id);
    return;
  }

  let cursor=new Date(PROFILE.decay_through+'T00:00:00');
  const earliest=new Date(thisMon); earliest.setDate(earliest.getDate()-12*7); // cap: at most 12 weeks
  if(cursor<earliest) cursor=earliest;

  const changed={}, totals={}; let guard=0;
  while(cursor<=lastCompletedMon && guard<16){
    const ws=new Date(cursor), we=new Date(cursor); we.setDate(we.getDate()+7);
    STAT_DEFS.forEach(d=>{
      const goals=GOALS.filter(g=>g.stat_key===d.key && new Date(g.created_at) < ws); // week's grace for new goals
      if(!goals.length) return;
      let expected=0, got=0;
      goals.forEach(g=>{
        const target=weeklyTargetFor(g);
        const done=COMPLETIONS.filter(c=>{ if(c.goal_id!==g.id) return false; const cd=new Date(c.done_on+'T00:00:00'); return cd>=ws&&cd<we; }).length;
        expected+=target; got+=Math.min(done,target);
      });
      if(expected<=0) return;
      const shortfall=(expected-got)/expected;
      if(shortfall<=0) return; // fed it enough — no slip
      const xp=(changed[d.key]!==undefined?changed[d.key]:(STATS[d.key]?.xp||0));
      const r=rankFromXp(xp);
      const lo=STAT_RANK_THRESHOLDS[r-1]??0;
      const hi=STAT_RANK_THRESHOLDS[r]??(lo+1200);
      const dec=Math.round((hi-lo)*0.05*shortfall);
      const newXp=Math.max(lo, xp-dec); // hard floor at current rank
      const applied=xp-newXp;
      if(applied>0){ changed[d.key]=newXp; totals[d.key]=(totals[d.key]||0)+applied; }
    });
    cursor.setDate(cursor.getDate()+7); guard++;
  }

  for(const k of Object.keys(changed)){
    STATS[k].xp=changed[k];
    await sb.from('stats').update({xp:changed[k]}).eq('id',STATS[k].id);
  }
  PROFILE.decay_through=ymd(thisMon);
  await sb.from('profiles').update({decay_through:PROFILE.decay_through}).eq('id',USER.id);
  DECAY_APPLIED=Object.entries(totals).map(([key,amount])=>({key,amount}));
}

/* ══════════════════════════════════════════════
   ACTIONS
   ══════════════════════════════════════════════ */
async function toggleTask(goalId){
  const g=GOALS.find(x=>x.id===goalId); if(!g) return;
  const t=todayStr();
  const already=doneToday(goalId);
  const before=todayStatEarned(g.stat_key);
  if(already){
    await sb.from('completions').delete().eq('goal_id',goalId).eq('done_on',t);
    COMPLETIONS=COMPLETIONS.filter(c=>!(c.goal_id===goalId&&c.done_on===t));
  } else {
    await sb.from('completions').insert({user_id:USER.id,goal_id:goalId,done_on:t});
    COMPLETIONS.push({goal_id:goalId,done_on:t});
  }
  const after=todayStatEarned(g.stat_key);
  await bumpStat(g.stat_key, after-before);
  await evaluateAchievements(false);
  render();
}
async function bumpStat(key,delta){
  const s=STATS[key]; if(!s) return;
  s.xp=Math.max(0,s.xp+delta);
  await sb.from('stats').update({xp:s.xp}).eq('id',s.id);
}
async function deleteGoal(goalId){
  if(!confirm('Delete this goal? Your past completions stay counted.')) return;
  await sb.from('goals').update({active:false}).eq('id',goalId);
  GOALS=GOALS.filter(g=>g.id!==goalId);
  render();
}
async function acceptBump(goalId){
  const g=GOALS.find(x=>x.id===goalId); if(!g) return;
  const nv=prompt(`New target for "${g.name}"?`, g.current_target||g.progress_start||'');
  if(nv===null) return;
  await sb.from('goals').update({current_target:nv}).eq('id',goalId);
  g.current_target=nv; render();
}
async function snoozeBump(goalId){
  const until=ymd(new Date(Date.now()+14*86400000));
  await sb.from('goals').update({snooze_until:until}).eq('id',goalId);
  const g=GOALS.find(x=>x.id===goalId); if(g) g.snooze_until=until;
  render();
}

async function logHangout(bondId){
  const b=BONDS.find(x=>x.id===bondId); if(!b) return;
  const t=todayStr();
  await sb.from('bond_logs').insert({user_id:USER.id,bond_id:bondId,logged_on:t});
  BOND_LOGS.push({bond_id:bondId,logged_on:t});
  b.xp=(b.xp||0)+BOND_XP_PER_HANGOUT; b.last_seen=t;
  await sb.from('bonds').update({xp:b.xp,last_seen:t}).eq('id',bondId);
  await bumpStat('charm', HANGOUT_CHARM_XP);
  await evaluateAchievements(false);
  render();
}
async function createBond(name, relationship){
  if(!name.trim()) return;
  const r=await sb.from('bonds').insert({user_id:USER.id,name:name.trim(),relationship}).select().single();
  if(r.error){ alert('Could not save: '+r.error.message); return; }
  BONDS.push(r.data);
  await evaluateAchievements(false);
  CURRENT_SCREEN='bonds'; render();
}
async function deleteBond(bondId){
  if(!confirm('Remove this person? Their hangout history goes too.')) return;
  await sb.from('bonds').delete().eq('id',bondId);
  BONDS=BONDS.filter(x=>x.id!==bondId);
  BOND_LOGS=BOND_LOGS.filter(x=>x.bond_id!==bondId);
  render();
}

/* ---- achievements ---- */
async function evaluateAchievements(silent){
  const newly=ACHIEVEMENTS.filter(a=>!EARNED.has(a.key) && a.cond());
  if(!newly.length) return;
  const today=todayStr();
  await sb.from('achievements').insert(newly.map(a=>({user_id:USER.id,key:a.key})));
  newly.forEach(a=>{ EARNED.add(a.key); EARNED_DATES[a.key]=today; });
  if(!silent){ POPUP_QUEUE.push(...newly); showNextPopup(); }
}
function showNextPopup(){
  if(POPUP_SHOWING || !POPUP_QUEUE.length) return;
  POPUP_SHOWING=true;
  const a=POPUP_QUEUE.shift();
  const reward = a.title||a.theme
    ? `<div class="pop-reward">Unlocked${a.title?` title “${esc(a.title)}”`:''}${a.title&&a.theme?' + ':''}${a.theme?`${THEMES[a.theme].label} theme`:''}</div>` : '';
  const el=document.createElement('div');
  el.className='pop-overlay';
  el.innerHTML=`<div class="pop-card">
    <div class="pop-eyebrow">Achievement unlocked</div>
    <div class="pop-glyph">${a.glyph}</div>
    <div class="pop-name">${esc(a.name)}</div>
    <div class="pop-desc">${esc(a.desc)}</div>
    ${reward}
    <button class="pop-close">Nice</button>
  </div>`;
  document.body.appendChild(el);
  const close=()=>{ el.remove(); POPUP_SHOWING=false; showNextPopup(); if(!POPUP_QUEUE.length) render(); };
  el.querySelector('.pop-close').onclick=close;
  el.onclick=e=>{ if(e.target===el) close(); };
}
function unlockedTitles(){
  const t=['The Wanderer'];
  ACHIEVEMENTS.forEach(a=>{ if(a.title && EARNED.has(a.key)) t.push(a.title); });
  return t;
}
function unlockedThemes(){
  const t=['crimson'];
  ACHIEVEMENTS.forEach(a=>{ if(a.theme && EARNED.has(a.key) && !t.includes(a.theme)) t.push(a.theme); });
  return t;
}
function applyTheme(key){
  const th=THEMES[key]||THEMES.crimson;
  document.documentElement.style.setProperty('--crimson', th.c);
  document.documentElement.style.setProperty('--blood', th.b);
}
async function equipTitle(title){
  await sb.from('profiles').update({codename:title}).eq('id',USER.id);
  PROFILE.codename=title; render();
}
async function equipTheme(key){
  if(!unlockedThemes().includes(key)) return;
  await sb.from('profiles').update({theme:key}).eq('id',USER.id);
  PROFILE.theme=key; applyTheme(key); render();
}

/* ══════════════════════════════════════════════
   RENDERING
   ══════════════════════════════════════════════ */
const $ = s => document.querySelector(s);
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function render(){
  $('#topright').innerHTML = `<div class="streak">&#9873; ${computeStreak()}-DAY STREAK</div><button class="logout" id="logout">Log out</button>`;
  $('#logout').onclick=async()=>{ await sb.auth.signOut(); location.reload(); };
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('on',b.dataset.screen===CURRENT_SCREEN));
  const body=$('#screen-body');
  if(CURRENT_SCREEN==='home') body.innerHTML=viewHome();
  else if(CURRENT_SCREEN==='today') body.innerHTML=viewToday();
  else if(CURRENT_SCREEN==='stats') body.innerHTML=viewStats();
  else if(CURRENT_SCREEN==='goals') body.innerHTML=viewGoals();
  else if(CURRENT_SCREEN==='newgoal') body.innerHTML=viewNewGoal();
  else if(CURRENT_SCREEN==='bonds') body.innerHTML=viewBonds();
  else if(CURRENT_SCREEN==='newbond') body.innerHTML=viewNewBond();
  else if(CURRENT_SCREEN==='awards') body.innerHTML=viewAwards();
  wire();
}

function diffPips(n){
  let h=''; for(let i=1;i<=5;i++) h+=`<i class="${i<=n?'on':''}"></i>`;
  return `<span class="diff">${h}<span>Diff ${n}</span></span>`;
}
function homeBanner(){
  // show only the single most important banner, to keep the phone view calm
  return decayBanner() || bumpBanner() || focusBanner();
}
function decayBanner(){
  if(!DECAY_APPLIED.length) return '';
  const parts=DECAY_APPLIED.map(x=>`${STAT_LABEL[x.key]} −${x.amount}`).join(' · ');
  return `<div class="decay">
    <div class="decay-msg"><b>Quiet stretch.</b> A few stats slipped: ${parts}. Nothing lost that a good week won't win back.</div>
    <button class="decay-x" id="decay-dismiss" title="Dismiss">✕</button>
  </div>`;
}
function focusBanner(){
  if(GOALS.length===0 && BONDS.length===0) return '';
  const f=focusStat(); if(!f) return '';
  const label=STAT_LABEL[f.key], col=STAT_COLOR[f.key];
  const line = f.v<=0 ? `You haven't fed ${label} at all this week.` : `${label} has had the least attention this week.`;
  return `<div class="focus" style="border-left-color:${col}">
    <div class="focus-dot" style="background:${col}"></div>
    <div class="focus-msg"><b>Focus:</b> ${line} <span>A little ${label.toLowerCase()} goal would balance you out.</span></div>
  </div>`;
}
function bumpBanner(){
  const g=levelUpSuggestion(); if(!g) return '';
  const nxt=g.progress_increment?` (+${esc(g.progress_increment)})`:'';
  return `<div class="suggest" data-goal="${g.id}">
    <div class="msg">&#9650; Ready to push "${esc(g.name)}"${nxt}?<small>You've been consistent for weeks — time to level it up.</small></div>
    <div class="btns"><button class="yes act-bump">Bump it</button><button class="act-snooze">Happy for now</button></div>
  </div>`;
}

function viewHome(){
  const li=levelInfo(); const wk=weeklyDeltaByStat(); const streak=computeStreak();
  const todays=GOALS.filter(scheduledToday);
  const doneCount=todays.filter(g=>doneToday(g.id)).length;
  const stat=k=>{
    const xp=STATS[k]?.xp||0, r=rankFromXp(xp), d=wk[k]||0;
    return `<div class="mstat ${d>0?'up':''}">
      <div class="nm">${STAT_LABEL[k]}</div>
      <div class="track"><i style="width:${Math.round(rankProgress(xp)*100)}%;background:${d>0?'var(--gold)':STAT_COLOR[k]}"></i></div>
      <div class="rk" style="color:${d>0?'var(--gold)':STAT_COLOR[k]}">${ROMAN[Math.min(r,10)]}</div>
      <div class="dl ${d>=0?'p':'n'}">${d>=0?'+':'−'}${Math.abs(d)}</div>
    </div>`;
  };
  const trow=g=>{
    const done=doneToday(g.id);
    return `<div class="trow ${done?'done':''}"><div class="tick">${done?'&#10003;':''}</div>
      <div class="tnm">${esc(g.name)}</div>
      <span class="stat-pill" style="background:${STAT_COLOR[g.stat_key]}">${STAT_LABEL[g.stat_key]}</span></div>`;
  };
  return `
  <div class="hero">
    <div class="levelcard">
      <div class="lvl-label">Level</div>
      <div class="lvl-num">${li.level}</div>
      <div class="lvl-sub">${esc(PROFILE.codename||'The Wanderer')}</div>
      <div class="lvl-bar"><i style="width:${li.pct}%"></i></div>
      <div class="lvl-hint">${li.pct}% — ${li.level>1||li.pct>0?`close to Level ${li.level+1}`:'begin the climb'}</div>
    </div>
    <div class="tiles">
      <div class="tile gold"><div class="tv">${streak}</div><div class="tl">Day streak</div><div class="tsmall">Keep it alive</div></div>
      <div class="tile crim"><div class="tv">${doneCount}<small>/${todays.length}</small></div><div class="tl">Today's tasks</div><div class="tsmall">${todays.length-doneCount} left</div></div>
      <div class="tile"><div class="tv">${weeklyPct()}%</div><div class="tl">This week</div><div class="tsmall">Goals on track</div></div>
    </div>
  </div>
  ${homeBanner()}
  <div class="cols">
    <div>
      <div class="sectitle"><h2>TODAY</h2><div class="rule"><b></b></div><button class="link act-go" data-to="today">Open day ▸</button></div>
      ${todays.length?todays.map(trow).join(''):'<div class="empty">No tasks scheduled today.</div>'}
    </div>
    <div>
      <div class="sectitle"><h2>STATS</h2><div class="rule"><b></b></div><button class="link act-go" data-to="stats">Full sheet ▸</button></div>
      ${STAT_DEFS.map(d=>stat(d.key)).join('')}
    </div>
  </div>`;
}

function viewToday(){
  const todays=GOALS.filter(scheduledToday);
  const done=todays.filter(g=>doneToday(g.id)).length;
  const pct=todays.length?Math.round(done/todays.length*100):0;
  const d=new Date();
  const dateStr=d.toLocaleDateString('en-GB',{weekday:'long'}).toUpperCase()+' · '+d.toLocaleDateString('en-GB',{day:'numeric',month:'long'}).toUpperCase();
  const task=g=>{
    const isDone=doneToday(g.id);
    const tag=g.current_target||g.target_label;
    return `<div class="task ${isDone?'done':''}" data-goal="${g.id}">
      <div class="check">${isDone?'&#10003;':''}</div>
      <div class="tbody">
        <div class="tname">${esc(g.name)}</div>
        <div class="tmeta">
          <span class="stat-pill" style="background:${STAT_COLOR[g.stat_key]}">${STAT_LABEL[g.stat_key]}</span>
          ${diffPips(g.difficulty)}
          ${tag?`<span class="goaltag">${esc(tag)}</span>`:''}
        </div>
      </div>
    </div>`;
  };
  return `
  <div class="pagetitle" style="font-size:30px">${dateStr}</div>
  <div class="pagesub">${done} of ${todays.length} done · day ${pct}%</div>
  ${bumpBanner()}
  <div class="sectitle"><h2>TODAY</h2><div class="rule"><b></b></div></div>
  <div class="tasks">${todays.length?todays.map(task).join(''):'<div class="empty">Nothing scheduled today. Add goals from the Goals tab.</div>'}</div>`;
}

function viewStats(){
  const li=levelInfo(); const wk=weeklyDeltaByStat();
  const card=d=>{
    const xp=STATS[d.key]?.xp||0, r=rankFromXp(xp), delta=wk[d.key]||0, up=rankProgress(xp)>0.85;
    return `<div class="stat ${up?'up':''}">
      ${up?'<div class="up-flag">▲ Rank up close</div>':''}
      <div class="stat-top"><div class="stat-name">${d.label}</div>
        <div class="stat-rank" style="color:${up?'var(--gold)':STAT_COLOR[d.key]}">${ROMAN[Math.min(r,10)]}</div></div>
      <div class="stat-flavor">${d.flavor}</div>
      <div class="track-lg"><i style="width:${Math.round(rankProgress(xp)*100)}%;background:${up?'var(--gold)':STAT_COLOR[d.key]}"></i></div>
      <div class="stat-foot"><span>Rank ${ROMAN[Math.min(r,10)]} → ${ROMAN[Math.min(r+1,10)]}</span>
        <span class="${delta>=0?'':''}" style="color:${delta>0?'var(--green)':delta<0?'var(--crimson)':'#8a8a8a'}">${delta>=0?'+':'−'}${Math.abs(delta)} this week</span></div>
    </div>`;
  };
  return `
  <div class="hero">
    <div class="levelcard" style="grid-column:1/-1;flex-direction:row;align-items:center;justify-content:space-between;clip-path:polygon(0 0,100% 0,100% 82%,96% 100%,0 100%)">
      <div><div class="lvl-label">Character Level</div><div class="lvl-sub" style="font-size:20px">${esc(PROFILE.codename||'The Wanderer')}</div></div>
      <div style="text-align:right"><div class="lvl-num" style="font-size:64px">${li.level}</div><div class="lvl-hint">${li.pct}% to Level ${li.level+1}</div></div>
    </div>
  </div>
  <div class="sectitle"><h2>STATS</h2><div class="rule"><b></b></div></div>
  <div class="stats-grid">${STAT_DEFS.map(card).join('')}</div>
  ${viewHistory()}`;
}

function viewHistory(){
  const streak=computeStreak(), best=bestStreak();
  const weeks=weeklyBuckets(8);
  const maxTasks=Math.max(1,...weeks.map(w=>w.tasks));
  const maxXp=Math.max(1,...weeks.map(w=>w.xp));
  // weekly bars (tasks) with a subtle xp line overlaid
  const barW=100/weeks.length;
  const bars=weeks.map(w=>{
    const h=Math.round(w.tasks/maxTasks*100);
    return `<div class="wbar-col"><div class="wbar-track"><div class="wbar" style="height:${h}%"></div></div><div class="wbar-lbl">${w.label.split(' ')[0]}</div></div>`;
  }).join('');
  const pts=weeks.map((w,i)=>{
    const x=barW*i+barW/2, y=100-(w.xp/maxXp*100);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // activity heatmap: last 5 weeks
  const act=activityByDay();
  const heatMon=startOfWeek(new Date()); heatMon.setDate(heatMon.getDate()-4*7);
  let cols='';
  for(let wcol=0;wcol<5;wcol++){
    let cells='';
    for(let drow=0;drow<7;drow++){
      const d=new Date(heatMon); d.setDate(d.getDate()+wcol*7+drow);
      const key=ymd(d); const future=d>new Date();
      const n=act[key]||0;
      const lvl = future?'f':n===0?'0':n===1?'1':n<=2?'2':n<=4?'3':'4';
      cells+=`<div class="heat-cell h${lvl}" title="${key}: ${n}"></div>`;
    }
    cols+=`<div class="heat-col">${cells}</div>`;
  }
  const totalXp8=weeks.reduce((s,w)=>s+w.xp,0);
  return `
  <div class="sectitle" style="margin-top:26px"><h2>MOMENTUM</h2><div class="rule"><b></b></div></div>
  <div class="tiles" style="margin-bottom:18px">
    <div class="tile gold"><div class="tv">${streak}</div><div class="tl">Current streak</div><div class="tsmall">Days in a row</div></div>
    <div class="tile"><div class="tv">${best}</div><div class="tl">Best streak</div><div class="tsmall">Your record</div></div>
    <div class="tile crim"><div class="tv">${weeks[weeks.length-1].tasks}</div><div class="tl">This week</div><div class="tsmall">Tasks logged</div></div>
  </div>

  <div class="hist-card">
    <div class="hist-head"><span>Weekly activity</span><span class="hist-legend"><i class="lg-bar"></i>tasks <i class="lg-line"></i>xp</span></div>
    <div class="wbars">
      <svg class="xp-line" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts}"/></svg>
      ${bars}
    </div>
  </div>

  <div class="hist-card">
    <div class="hist-head"><span>Active days · last 5 weeks</span><span class="hist-legend muted">${totalXp8} xp over 8 weeks</span></div>
    <div class="heat">${cols}</div>
  </div>`;
}

function viewGoals(){
  const row=g=>{
    const freq=(g.days&&g.days.length)?g.days.map(k=>k[0].toUpperCase()+k.slice(1)).join(' '):`${g.times_per_week||1}× / week`;
    return `<div class="gcard">
      <span class="stat-pill" style="background:${STAT_COLOR[g.stat_key]}">${STAT_LABEL[g.stat_key]}</span>
      <div style="flex:1">
        <div class="gname">${esc(g.name)}</div>
        <div class="gmeta">${freq} · diff ${g.difficulty}${g.auto_levelup?' · auto-levels':''}${g.current_target||g.target_label?' · '+esc(g.current_target||g.target_label):''}</div>
      </div>
      <button class="gdel act-del" data-goal="${g.id}">Delete</button>
    </div>`;
  };
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div class="pagetitle">GOALS</div>
    <button class="addbtn act-new"><span>+ New goal</span></button>
  </div>
  <div class="pagesub">Everything you're working toward. Tap a day on Today to tick it off.</div>
  <div class="glist">${GOALS.length?GOALS.map(row).join(''):'<div class="empty">No goals yet. Hit “+ New goal” to begin.</div>'}</div>`;
}

/* new goal form uses a tiny local draft */
let DRAFT=null;
function freshDraft(){ return {name:'',stat_key:'vigor',difficulty:3,days:[],times_per_week:4,target_label:'',auto_levelup:false,progress_start:'',progress_increment:''}; }
function viewNewGoal(){
  if(!DRAFT) DRAFT=freshDraft();
  const d=DRAFT;
  const diffWords=['','Very light','Light','Moderate','Hard','Brutal'];
  return `
  <div class="pagetitle">NEW GOAL</div>
  <div class="pagesub">Set it once. The app tracks it, feeds your stats, and offers to level it up when you're ready.</div>

  <div class="field"><div class="flabel">Goal name</div>
    <input class="textin" id="d-name" value="${esc(d.name)}" placeholder="e.g. Morning run, Gym, Call a mate"></div>

  <div class="field"><div class="flabel">Which stat does it build?</div>
    <div class="chips" id="d-stats">${STAT_DEFS.map(s=>`<div class="chip ${d.stat_key===s.key?'sel':''}" data-k="${s.key}" style="${d.stat_key===s.key?`background:${s.color};border-color:${s.color}`:''}"><span>${s.label}</span></div>`).join('')}</div></div>

  <div class="field"><div class="flabel">Difficulty <span class="opt">— how much it earns</span></div>
    <div class="diffpick"><div id="d-diff" style="display:flex;gap:12px">
      ${[1,2,3,4,5].map(n=>`<div class="slab ${d.difficulty===n?'sel':''}" data-n="${n}"><span>${n}</span></div>`).join('')}
    </div><div class="difftext" id="d-difftext">${diffWords[d.difficulty]}</div></div></div>

  <div class="field"><div class="flabel">How often? <span class="opt">— pick days, or just a count</span></div>
    <div class="daypick" id="d-days">${DAYS.map(x=>`<div class="day ${d.days.includes(x.k)?'sel':''}" data-k="${x.k}"><span>${x.l}</span></div>`).join('')}</div>
    <div class="freqalt"><span class="freqor">or any</span>
      <div class="stepper"><button id="d-freq-dn">−</button><span class="val" id="d-freq">${d.times_per_week}</span><button id="d-freq-up">+</button></div>
      <span class="freqor">days a week</span></div>
    <div class="hint">Pick specific days, or leave them off and just say “N days a week” for anytime goals.</div></div>

  <div class="field"><div class="flabel">Target label <span class="opt">— optional</span></div>
    <input class="textin" id="d-target" value="${esc(d.target_label)}" placeholder="e.g. 2K, 20 min" style="max-width:260px">
    <div class="hint">Just a reminder on the task. You only tick it done — no numbers to log.</div></div>

  <div class="field"><div class="prog">
    <div class="progtop"><div class="t">▲ Auto level-up this goal</div>
      <div class="toggle ${d.auto_levelup?'on':''}" id="d-auto"></div></div>
    <div class="progrow" id="d-progrow" style="${d.auto_levelup?'':'opacity:.4;pointer-events:none'}">
      <div class="progcell"><div class="cl">Start at</div><input class="cv" id="d-pstart" value="${esc(d.progress_start)}" placeholder="2K"></div>
      <div class="progcell"><div class="cl">Increase by</div><input class="cv" id="d-pinc" value="${esc(d.progress_increment)}" placeholder="1K"></div>
    </div>
    <div class="progexplain">After ~3 weeks of consistency, the app asks if you're ready to bump the target. Accept, tweak, or hit “Happy for now” and it won't ask again for a couple of weeks.</div>
  </div></div>

  <div class="cta"><button class="create act-create">CREATE GOAL</button><button class="cancel act-go" data-to="goals">Cancel</button></div>`;
}

function viewBonds(){
  const card=b=>{
    const rel=REL[b.relationship]||REL.friend;
    const xp=b.xp||0, r=bondRank(xp), pct=Math.round(bondProgress(xp)*100);
    const seen=b.last_seen?`Last seen ${daysAgo(b.last_seen)===0?'today':daysAgo(b.last_seen)+' day'+(daysAgo(b.last_seen)===1?'':'s')+' ago'}`:'Not logged yet';
    const stale=b.last_seen && daysAgo(b.last_seen)>=STALE_DAYS;
    const initial=esc((b.name||'?').trim()[0]||'?').toUpperCase();
    let pips=''; for(let i=1;i<=10;i++) pips+=`<i class="${i<=r?'on':''}" style="${i<=r?`background:${rel.color}`:''}"></i>`;
    return `<div class="bond ${stale?'stale':''}" data-bond="${b.id}">
      <div class="portrait" style="background:${rel.color};color:${b.relationship==='friend'?'var(--bone)':'var(--ink)'}">${initial}</div>
      <div class="binfo">
        <div class="bhead"><div class="bname">${esc(b.name)}</div><div class="brel" style="background:${rel.color};color:${b.relationship==='friend'?'var(--bone)':'var(--ink)'}">${rel.label}</div></div>
        <div class="rankline"><span class="rankno" style="color:${rel.color}">${Math.min(r,10)}</span><span class="rankword">Rank ${ROMAN[Math.min(r,10)]}</span><span class="pips">${pips}</span></div>
        <div class="btrack"><i style="width:${pct}%;background:${rel.color}"></i></div>
        <div class="bfoot"><span class="seen ${stale?'stale':''}">${seen}</span>
          <span style="display:flex;gap:6px"><button class="logbtn act-hang">Log hangout</button><button class="gdel act-delbond">✕</button></span></div>
      </div>
    </div>`;
  };
  return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div class="pagetitle">BONDS</div>
    <button class="addbtn act-newbond"><span>+ Add person</span></button>
  </div>
  <div class="pagesub">The people who matter. Log time together to deepen each bond — every hangout feeds Charm and keeps your streak alive.</div>
  <div class="grid">${BONDS.length?BONDS.map(card).join(''):'<div class="empty">No one here yet. Add a friend, family member, or partner to start a bond.</div>'}</div>`;
}

let BDRAFT=null;
function viewNewBond(){
  if(!BDRAFT) BDRAFT={name:'',relationship:'friend'};
  const d=BDRAFT;
  return `
  <div class="pagetitle">ADD PERSON</div>
  <div class="pagesub">Someone you want to spend more real time with.</div>
  <div class="field"><div class="flabel">Name</div>
    <input class="textin" id="b-name" value="${esc(d.name)}" placeholder="e.g. Jordan, Mum, Sam"></div>
  <div class="field"><div class="flabel">Relationship</div>
    <div class="chips" id="b-rel">${Object.entries(REL).map(([k,v])=>`<div class="chip ${d.relationship===k?'sel':''}" data-k="${k}" style="${d.relationship===k?`background:${v.color};border-color:${v.color};color:${k==='friend'?'var(--bone)':'var(--ink)'}`:''}"><span>${v.label}</span></div>`).join('')}</div></div>
  <div class="cta"><button class="create act-createbond">ADD PERSON</button><button class="cancel act-go" data-to="bonds">Cancel</button></div>`;
}

function viewAwards(){
  const earnedCount=EARNED.size, total=ACHIEVEMENTS.length;
  const cats=[{k:'streak',t:'Streaks'},{k:'stat',t:'Stats'},{k:'bond',t:'Bonds'}];
  const badge=a=>{
    const got=EARNED.has(a.key);
    return `<div class="badge ${got?'got':''}">
      <div class="badge-glyph">${got?a.glyph:'<span style="opacity:.5">🔒</span>'}</div>
      <div class="badge-name">${esc(a.name)}</div>
      <div class="badge-desc">${esc(a.desc)}</div>
      ${got&&(a.title||a.theme)?`<div class="badge-reward">${a.title?esc(a.title):''}${a.title&&a.theme?' · ':''}${a.theme?THEMES[a.theme].label:''}</div>`:''}
    </div>`;
  };
  const section=c=>`
    <div class="sectitle"><h2>${c.t.toUpperCase()}</h2><div class="rule"><b></b></div></div>
    <div class="badge-grid">${ACHIEVEMENTS.filter(a=>a.cat===c.k).map(badge).join('')}</div>`;

  const titles=unlockedTitles();
  const cur=PROFILE.codename||'The Wanderer';
  const titleChips=titles.map(t=>`<button class="chip ${t===cur?'sel':''}" data-title="${esc(t)}" style="${t===cur?'background:var(--crimson);border-color:var(--crimson);color:var(--ink)':''}"><span>${esc(t)}</span></button>`).join('');

  const themes=unlockedThemes();
  const curTheme=PROFILE.theme||'crimson';
  const themeSwatches=Object.keys(THEMES).map(k=>{
    const on=themes.includes(k), sel=k===curTheme;
    return `<button class="swatch ${on?'':'locked'} ${sel?'sel':''}" data-theme="${k}" ${on?'':'disabled'}>
      <span class="dot" style="background:${THEMES[k].c}"></span>${THEMES[k].label}${on?'':' 🔒'}</button>`;
  }).join('');

  return `
  <div class="pagetitle">AWARDS</div>
  <div class="pagesub">${earnedCount} of ${total} unlocked. Earn badges to unlock titles and colour themes.</div>

  <div class="sectitle"><h2>TITLE</h2><div class="rule"><b></b></div></div>
  <div class="pagesub" style="margin-bottom:12px">Shown on your level card. Tap to equip.</div>
  <div class="chips" id="title-row">${titleChips}</div>

  <div class="sectitle" style="margin-top:26px"><h2>THEME</h2><div class="rule"><b></b></div></div>
  <div class="pagesub" style="margin-bottom:12px">Recolours the app. Unlock more by earning badges.</div>
  <div class="swatches" id="theme-row">${themeSwatches}</div>

  <div style="margin-top:30px">${cats.map(section).join('')}</div>`;
}

/* ══════════════════════════════════════════════
   WIRING (attach listeners after each render)
   ══════════════════════════════════════════════ */
function wire(){
  document.querySelectorAll('.act-go').forEach(b=>b.onclick=()=>{ CURRENT_SCREEN=b.dataset.to; render(); });
  const dx=document.getElementById('decay-dismiss'); if(dx) dx.onclick=()=>{ DECAY_APPLIED=[]; render(); };
  document.querySelectorAll('.act-new').forEach(b=>b.onclick=()=>{ DRAFT=freshDraft(); CURRENT_SCREEN='newgoal'; render(); });
  document.querySelectorAll('.task').forEach(t=>t.onclick=()=>toggleTask(t.dataset.goal));
  document.querySelectorAll('.act-del').forEach(b=>b.onclick=e=>{ e.stopPropagation(); deleteGoal(b.dataset.goal); });
  document.querySelectorAll('.act-bump').forEach(b=>b.onclick=()=>{ const s=b.closest('.suggest'); acceptBump(s.dataset.goal); });
  document.querySelectorAll('.act-snooze').forEach(b=>b.onclick=()=>{ const s=b.closest('.suggest'); snoozeBump(s.dataset.goal); });
  document.querySelectorAll('.act-newbond').forEach(b=>b.onclick=()=>{ BDRAFT={name:'',relationship:'friend'}; CURRENT_SCREEN='newbond'; render(); });
  document.querySelectorAll('.act-hang').forEach(b=>b.onclick=e=>{ e.stopPropagation(); logHangout(b.closest('.bond').dataset.bond); });
  document.querySelectorAll('.act-delbond').forEach(b=>b.onclick=e=>{ e.stopPropagation(); deleteBond(b.closest('.bond').dataset.bond); });
  document.querySelectorAll('#title-row .chip').forEach(b=>b.onclick=()=>equipTitle(b.dataset.title));
  document.querySelectorAll('#theme-row .swatch:not(.locked)').forEach(b=>b.onclick=()=>equipTheme(b.dataset.theme));
  if(CURRENT_SCREEN==='newbond'){
    const d=BDRAFT;
    const nm=$('#b-name'); if(nm) nm.oninput=e=>d.name=e.target.value;
    document.querySelectorAll('#b-rel .chip').forEach(c=>c.onclick=()=>{ d.relationship=c.dataset.k; render(); });
    document.querySelectorAll('.act-createbond').forEach(btn=>btn.onclick=()=>{ if(!d.name.trim()){ alert('Give them a name first.'); return; } createBond(d.name,d.relationship); });
  }

  // new-goal form bindings
  if(CURRENT_SCREEN==='newgoal'){
    const d=DRAFT;
    const nm=$('#d-name'); if(nm) nm.oninput=e=>d.name=e.target.value;
    $('#d-target') && ($('#d-target').oninput=e=>d.target_label=e.target.value);
    document.querySelectorAll('#d-stats .chip').forEach(c=>c.onclick=()=>{ d.stat_key=c.dataset.k; render(); });
    document.querySelectorAll('#d-diff .slab').forEach(s=>s.onclick=()=>{ d.difficulty=+s.dataset.n; render(); });
    document.querySelectorAll('#d-days .day').forEach(dd=>dd.onclick=()=>{ const k=dd.dataset.k; d.days.includes(k)?d.days=d.days.filter(x=>x!==k):d.days.push(k); render(); });
    $('#d-freq-up') && ($('#d-freq-up').onclick=()=>{ d.times_per_week=Math.min(7,d.times_per_week+1); render(); });
    $('#d-freq-dn') && ($('#d-freq-dn').onclick=()=>{ d.times_per_week=Math.max(1,d.times_per_week-1); render(); });
    $('#d-auto') && ($('#d-auto').onclick=()=>{ d.auto_levelup=!d.auto_levelup; render(); });
    $('#d-pstart') && ($('#d-pstart').oninput=e=>d.progress_start=e.target.value);
    $('#d-pinc') && ($('#d-pinc').oninput=e=>d.progress_increment=e.target.value);
    document.querySelectorAll('.act-create').forEach(b=>b.onclick=createGoal);
  }
}
async function createGoal(){
  const d=DRAFT;
  if(!d.name.trim()){ alert('Give your goal a name first.'); return; }
  const row={
    user_id:USER.id, name:d.name.trim(), stat_key:d.stat_key, difficulty:d.difficulty,
    days:d.days, times_per_week:d.days.length?null:d.times_per_week,
    target_label:d.target_label||null, auto_levelup:d.auto_levelup,
    progress_start:d.auto_levelup?(d.progress_start||null):null,
    progress_increment:d.auto_levelup?(d.progress_increment||null):null,
    current_target:d.auto_levelup?(d.progress_start||d.target_label||null):null
  };
  const r=await sb.from('goals').insert(row).select().single();
  if(r.error){ alert('Could not save: '+r.error.message); return; }
  GOALS.push(r.data); DRAFT=null; CURRENT_SCREEN='goals'; render();
}

/* ══════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════ */
let AUTH_MODE='login';
function showAuth(){
  $('#boot').classList.add('hidden'); $('#app').classList.add('hidden');
  $('#screen-auth').classList.remove('hidden');
  $('#auth-toggle-text').textContent = AUTH_MODE==='login'?'New here?':'Already have an account?';
  $('#auth-toggle-btn').textContent = AUTH_MODE==='login'?'Create an account':'Log in';
  $('#auth-go').textContent = AUTH_MODE==='login'?'ENTER':'CREATE ACCOUNT';
}
$('#auth-toggle-btn').onclick=()=>{ AUTH_MODE=AUTH_MODE==='login'?'signup':'login'; $('#auth-msg').textContent=''; showAuth(); };
$('#auth-go').onclick=async()=>{
  const email=$('#auth-email').value.trim(), pass=$('#auth-pass').value;
  const msg=$('#auth-msg'); msg.style.color='var(--crimson)';
  if(!email||!pass){ msg.textContent='Enter an email and password.'; return; }
  $('#auth-go').disabled=true; $('#auth-go').textContent='…';
  let res;
  if(AUTH_MODE==='signup') res=await sb.auth.signUp({email,password:pass});
  else res=await sb.auth.signInWithPassword({email,password:pass});
  $('#auth-go').disabled=false;
  if(res.error){ msg.textContent=res.error.message; showAuth(); return; }
  if(AUTH_MODE==='signup' && !res.data.session){ msg.style.color='var(--gold)'; msg.textContent='Check your email to confirm, then log in.'; AUTH_MODE='login'; showAuth(); return; }
  boot();
};

/* ══════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════ */
async function boot(){
  if(CFG.key==='PASTE_YOUR_PUBLISHABLE_KEY_HERE'){
    $('#boot').innerHTML='Almost there — paste your Supabase publishable key into config.js.';
    return;
  }
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ showAuth(); return; }
  USER=session.user;
  $('#screen-auth').classList.add('hidden');
  $('#boot').classList.remove('hidden'); $('#boot').textContent='Loading your quest…';
  await seedIfNeeded();
  await loadAll();
  applyTheme(PROFILE.theme||'crimson');
  await applyDecay();                 // apply any weekly slips since last visit
  await evaluateAchievements(true);   // backfill already-earned, no pop-up spam
  $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');
  CURRENT_SCREEN='home'; render();
}
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{ CURRENT_SCREEN=b.dataset.screen; render(); });
boot();
