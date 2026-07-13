/* ══════════════════════════════════════════════════════════════
   QUEST — background music player
   ──────────────────────────────────────────────────────────────
   HOW TO ADD YOUR OWN MUSIC (you only edit the TRACKS list below):

   1. Get royalty-free tracks in that jazzy/stylish vibe. Good free
      sources: pixabay.com/music, uppbeat.io, incompetech.com.
      Download them as .mp3 files.

   2. Upload the .mp3 files to your GitHub repo (Add file → Upload
      files → drag them in → Commit). Easiest is to drop them at the
      top level, next to index.html.

   3. List each track below: a title to show, and the filename you
      uploaded. Keep the quotes and the comma. Example:
         { title: "Rainy Days",  src: "rainy-days.mp3" },

   That's it — save, upload this file too, and the player picks them up.
   ══════════════════════════════════════════════════════════════ */

const TRACKS = [
  { title: "Coffee Shop",      src: "coffee-shop-soundroll-main-version-1849-02-49.mp3" },
  { title: "Kitchen Sunbeams", src: "kitchen-sunbeams-avbe-main-version-32035.mp3" },
  { title: "Ryan Walz",        src: "ryan-walz-main-version-01-34-3632.mp3" },
];

/* ────────────────────────────────────────────────
   Player — no need to edit anything below.
   ──────────────────────────────────────────────── */
(function(){
  const usable = TRACKS.filter(t => t.src && t.src.trim());
  const audio = new Audio();
  audio.preload = "none";
  let idx = parseInt(localStorage.getItem('quest_music_idx')||'0',10) || 0;
  if(idx>=usable.length) idx=0;
  let vol = parseFloat(localStorage.getItem('quest_music_vol'));
  if(isNaN(vol)) vol = 0.5;
  audio.volume = vol;

  // build UI
  const wrap = document.createElement('div');
  wrap.className = 'music';
  wrap.innerHTML = `
    <button class="music-toggle" title="Music">&#9835;</button>
    <div class="music-panel">
      <div class="music-title" id="music-title">—</div>
      <div class="music-controls">
        <button class="music-btn" id="music-prev" title="Previous">&#9668;&#9668;</button>
        <button class="music-btn music-play" id="music-play" title="Play/Pause">&#9654;</button>
        <button class="music-btn" id="music-next" title="Next">&#9658;&#9658;</button>
      </div>
      <div class="music-vol">
        <span>&#128266;</span>
        <input type="range" id="music-vol" min="0" max="1" step="0.05" value="${vol}">
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const $=id=>wrap.querySelector(id);
  const titleEl=$('#music-title'), playBtn=$('#music-play'), panel=wrap.querySelector('.music-panel');

  function label(){
    if(!usable.length){ titleEl.textContent='No tracks added yet'; titleEl.classList.add('muted'); return; }
    titleEl.classList.remove('muted');
    titleEl.textContent = usable[idx].title;
  }
  function load(){ if(!usable.length) return; audio.src = usable[idx].src; localStorage.setItem('quest_music_idx',idx); label(); }
  function play(){
    if(!usable.length) return;
    if(!audio.src) load();
    audio.play().then(()=>{ playBtn.innerHTML='&#10074;&#10074;'; }).catch(()=>{});
  }
  function pause(){ audio.pause(); playBtn.innerHTML='&#9654;'; }
  function next(){ if(!usable.length) return; idx=(idx+1)%usable.length; load(); play(); }
  function prev(){ if(!usable.length) return; idx=(idx-1+usable.length)%usable.length; load(); play(); }

  wrap.querySelector('.music-toggle').onclick=()=>{ wrap.classList.toggle('open'); };
  playBtn.onclick=()=>{ if(audio.paused) play(); else pause(); };
  $('#music-next').onclick=next;
  $('#music-prev').onclick=prev;
  $('#music-vol').oninput=e=>{ audio.volume=+e.target.value; localStorage.setItem('quest_music_vol',e.target.value); };
  audio.addEventListener('ended', next);
  audio.addEventListener('error', ()=>{ if(usable.length){ titleEl.textContent='Couldn’t load "'+usable[idx].title+'"'; titleEl.classList.add('muted'); } });

  label();
})();
