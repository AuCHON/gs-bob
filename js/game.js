/* =========================================================
 * 球球大乱斗 —— 双人同屏对战 · 霓虹街机版
 * 玩家1: A/D 移动  W 跳  S 下砸  空格 冲刺
 * 玩家2: ←/→ 移动 ↑ 跳 ↓ 下砸  回车 冲刺
 * 物理与判定常量为冻结项(基准见 doc/reports/ 各报告);
 * 获胜分数经 2026-09-24 增量授权改为开局前可设(WIN_MIN~WIN_MAX)。
 * ========================================================= */
(() => {
'use strict';

/* ---------- 常量(冻结:玩法与节拍;获胜分数范围为授权例外) ---------- */
const W = 960, H = 640;
const GRAVITY = 1900;
const ACCEL = 2400;          // 地面加速度
const AIR_ACCEL = 1200;      // 空中加速度
const JUMP_V = 760;
const SLAM_V = 1050;
const DASH_V = 920;
const DASH_CD = 2.6;
const MAX_VX = 520;
const FRICTION_G = 8.5;      // 地面摩擦(每秒衰减系数)
const FRICTION_A = 0.6;
const GAME_TIME = 150;       // 常规 2:30,平分加赛 ≤15 秒
const WIN_MIN = 3, WIN_MAX = 16;   // 获胜分数设定范围(开局前菜单可调,默认 3)
const BASE_R = 22;

// 平台(基准几何，实际渲染按 state.shrink 缩放宽度)
const PLAT = { cx: W / 2, y: 400, w: 600, h: 74 };

/* ---------- 表现层参数 ---------- */
const MAX_PARTICLES = 300;   // 同屏粒子上限
const HIT_STOP_MAX = 0.08;   // hit-stop 顿帧上限(秒)
const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 画布 ---------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);
const ui = {
  hud: $('hud'), menu: $('menu'), over: $('over'),
  score1: $('score1'), score2: $('score2'),
  timer: $('timer'), st1: $('status1'), st2: $('status2'),
  winText: $('winText'), finalScore: $('finalScore'),
  pips1: $('pips1'), pips2: $('pips2'),
  winCount1: $('wincount1'), winCount2: $('wincount2'),
  winScoreVal: $('winScoreVal'), subScoreNum: $('subScoreNum'),
  ruleScoreNum: $('ruleScoreNum'), durationLine: $('durationLine'),
  btnScoreMinus: $('btnScoreMinus'), btnScorePlus: $('btnScorePlus'),
  pads: $('pads'), stage: $('stage'),
};

/* ---------- 音效(WebAudio 极简合成,本次未改动) ---------- */
let actx = null;
const initAudio = () => { if (!actx) try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} };
function beep(freq, dur = .08, type = 'square', vol = .12, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(.001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur);
}
const sfx = {
  hit:  () => { beep(150, .09, 'square', .16); beep(90, .12, 'sawtooth', .1, .01); },
  jump: () => beep(320, .06, 'sine', .08),
  dash: () => beep(500, .1, 'sawtooth', .09),
  pick: () => { beep(660, .07, 'sine', .12); beep(990, .09, 'sine', .12, .07); },
  score:() => { beep(392, .12, 'triangle', .16); beep(523, .18, 'triangle', .16, .12); },
  tick: () => beep(880, .05, 'sine', .1),
  go:   () => beep(1174, .2, 'triangle', .14),
  win:  () => [523, 659, 784, 1046].forEach((f, i) => beep(f, .16, 'triangle', .14, i * .12)),
};

/* ---------- 状态 ---------- */
const state = {
  scene: 'menu',        // menu | count | play | banner | over
  paused: false,
  timer: GAME_TIME,
  scores: [0, 0],
  winScore: 3,          // 开局时自菜单设定的快照(score()/HUD 读此值)
  sudden: false,
  shrink: 1,            // 突然死亡时平台收缩
  countT: 0,            // 倒计时
  bannerT: 0, bannerText: '',
  shake: 0, time: 0,
};

/* ---------- 表现层特效 ---------- */
const fx = {
  freeze: 0,            // hit-stop 剩余秒数
  goT: 0,               // GO! 展示剩余秒数
  flash: null,          // 全屏色闪 { c, a }
  waves: [],            // 冲击波扩散环
  texts: [],            // 浮动文字
  confetti: [],         // 结算彩带
  bannerColor: '#ffd166',
  shrinkSpk: 0,         // 平台收缩边缘火花计时
};

/* ---------- 玩家 ---------- */
function makePlayer(id) {
  return {
    id, name: id === 0 ? '玩家 1' : '玩家 2',
    color: id === 0 ? '#ff4d6d' : '#4dc3ff',
    dark:  id === 0 ? '#c9184a' : '#1e6fb8',
    x: 0, y: 0, vx: 0, vy: 0, r: BASE_R,
    onGround: false, face: id === 0 ? 1 : -1,
    dashCd: 0, speedT: 0, growT: 0, frozenT: 0,
    slamming: false, dead: false, eyeX: 0, eyeY: 0,
    // 表现层
    sx: 1, sy: 1, dashT: 0, trail: [], blink: id * 1.7 + 1.2,
  };
}
const players = [makePlayer(0), makePlayer(1)];
respawn();   // 菜单场景也要让角色站在平台上(悬浮呼吸待战)

function respawn() {
  const w = PLAT.w * state.shrink;
  players.forEach(p => {
    p.x = PLAT.cx + (p.id === 0 ? -1 : 1) * w * 0.28;
    p.vx = 0; p.vy = 0;
    p.r = BASE_R; p.onGround = false;
    p.y = PLAT.y - p.r - 2;
    p.dashCd = 0; p.speedT = 0; p.growT = 0; p.frozenT = 0;
    p.slamming = false; p.dead = false;
    p.sx = 1; p.sy = 1; p.dashT = 0; p.trail = [];
  });
}

/* ---------- 道具 ---------- */
const PROP_TYPES = [
  { key: 'speed',  color: '#ffd166', name: '加速' },
  { key: 'grow',   color: '#ff9f68', name: '变大' },
  { key: 'freeze', color: '#8ad8ff', name: '冰冻' },
  { key: 'dash',   color: '#ff8ad8', name: '冲刺' },
];
let props = [], propTimer = 3, particles = [], embers = [];

function spawnProp() {
  const w = PLAT.w * state.shrink;
  const t = PROP_TYPES[Math.floor(Math.random() * PROP_TYPES.length)];
  props.push({
    ...t, x: PLAT.cx + (Math.random() - 0.5) * (w - 80),
    y: PLAT.y - 40, life: 9, t: Math.random() * 6,
  });
}
function applyProp(p, prop) {
  sfx.pick();
  switch (prop.key) {
    case 'speed':  p.speedT = 5;   break;
    case 'grow':   p.growT = 6;    break;
    case 'freeze': players[1 - p.id].frozenT = 2.5; break;
    case 'dash':   p.dashCd = 0; p.speedT = Math.max(p.speedT, 1.6); break;
  }
  for (let i = 0; i < 12; i++) burst(prop.x, prop.y, prop.color);
  if (!REDUCED) {
    fx.texts.push({ x: p.x, y: p.y - p.r - 26, txt: prop.name + '!', color: prop.color, size: 20, a: 1, vy: -64 });
    fx.waves.push({ x: prop.x, y: prop.y, r: 6, vr: 420, w: 2.5, a: .55, color: prop.color });
  }
}
function burst(x, y, color, n = 10, sp = 260) {
  if (REDUCED) n = Math.round(n * 0.4);
  n = Math.max(0, Math.min(n, MAX_PARTICLES - particles.length - fx.confetti.length));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = sp * (0.4 + Math.random() * 0.8);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: .5 + Math.random() * .3, color, size: 1.5 + Math.random() * 1.8 });
  }
}

/* 环境余烬(平台下方上升,替代旧岩浆层的危险暗示) */
function initEmbers() {
  embers = [];
  for (let i = 0; i < 24; i++) {
    embers.push({ x: Math.random() * W, y: 470 + Math.random() * (H - 470), v: 16 + Math.random() * 38, ph: Math.random() * 6.28, sz: .8 + Math.random() * 1.4 });
  }
}
initEmbers();

/* ---------- 输入 ---------- */
/* keys 为唯一读面(玩法逻辑只读它);物理键盘与虚拟按键两源合并:
   physKeys=物理键状态,padPtrs=虚拟按键每键活跃触控指针集合(同键多指取并集) */
const keys = {};
const physKeys = {};
const padPtrs = {};
const ptrCode = {};   // pointerId → 虚拟键 code(全局释放映射,兜底 pen 无隐式捕获/元素隐藏场景)
const syncKey = c => { keys[c] = !!physKeys[c] || !!(padPtrs[c] && padPtrs[c].size > 0); };
function clearKey(c) { physKeys[c] = false; if (padPtrs[c]) padPtrs[c].clear(); keys[c] = false; }
const clearKeys = () => {
  for (const k in keys) { keys[k] = false; physKeys[k] = false; }
  for (const c in padPtrs) padPtrs[c].clear();
};
addEventListener('keydown', e => {
  initAudio();
  // 菜单/结算中按钮聚焦时,Enter/Space 交给按钮原生激活(步进器/结算按钮可达),不触发全局热键
  if ((state.scene === 'menu' || state.scene === 'over') && e.target && e.target.tagName === 'BUTTON') {
    if (!e.repeat) { physKeys[e.code] = true; syncKey(e.code); }   // 仍记录按键,防持有键跨开局丢失
    return;
  }
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  physKeys[e.code] = true; syncKey(e.code);

  if (state.scene === 'menu' && (e.code === 'Space' || e.code === 'Enter')) startMatch();
  else if (state.scene === 'over' && e.code === 'Enter') startMatch();
  if (e.code === 'KeyR' && state.scene !== 'menu') startMatch();
  if (e.code === 'KeyP' && state.scene === 'play') { state.paused = !state.paused; }
});
addEventListener('keyup', e => { physKeys[e.code] = false; syncKey(e.code); });
addEventListener('blur', () => { clearKeys(); if (state.scene === 'play') state.paused = true; });
$('btnStart').onclick = () => { initAudio(); startMatch(); };
$('btnRestart').onclick = () => { initAudio(); startMatch(); };
$('btnMenu').onclick = () => { if (state.scene === 'over') returnToMenu(); };
/* 触屏友好:暂停时点击画面恢复(纯触屏玩家无 P 键) */
canvas.addEventListener('pointerdown', () => {
  if (state.paused && state.scene === 'play') state.paused = false;
});
/* 竖屏提示关闭(会话内不再出现) */
$('rhClose').onclick = () => { $('rotateHint').classList.add('dismissed'); };

/* ---------- 虚拟按键(桌面=按下点亮显示;触屏/触控笔=直接操控) ---------- */
const PAD_KEYS = {
  'vk-w': 'KeyW', 'vk-a': 'KeyA', 'vk-s': 'KeyS', 'vk-d': 'KeyD', 'vk-sp': 'Space',
  'vk-up': 'ArrowUp', 'vk-left': 'ArrowLeft', 'vk-down': 'ArrowDown', 'vk-right': 'ArrowRight', 'vk-en': 'Enter',
};
const padEls = [];
for (const id in PAD_KEYS) {
  const el = $(id);
  if (!el || typeof el.addEventListener !== 'function') continue;
  const code = PAD_KEYS[id];
  padEls.push({ el, code });
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    initAudio();
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;   // 鼠标不写入:桌面 pads 仅作输入显示
    ptrCode[e.pointerId] = code;
    (padPtrs[code] = padPtrs[code] || new Set()).add(e.pointerId);
    syncKey(code);
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
}
/* 指针抬起/取消/丢捕获:按 pointerId 全局释放,不依赖事件回落到原元素
   (touch 有隐式捕获,pen 在部分浏览器没有——抬起可能派发到别处,靠映射兜底) */
function releasePointer(e) {
  const code = ptrCode[e.pointerId];
  if (code === undefined) return;
  delete ptrCode[e.pointerId];
  if (padPtrs[code]) padPtrs[code].delete(e.pointerId);
  syncKey(code);
}
addEventListener('pointerup', releasePointer);
addEventListener('pointercancel', releasePointer);
addEventListener('lostpointercapture', releasePointer);
/* 触控键全量释放(pads 隐藏/开局/结算时防卡键:手指仍按住但元素已 display:none) */
function releasePads() {
  for (const pid in ptrCode) delete ptrCode[pid];
  for (const c in padPtrs) { padPtrs[c].clear(); syncKey(c); }
}
/* pads 点亮同步 = 物理∪触控 合并态 */
function syncPads() {
  for (const pe of padEls) pe.el.classList.toggle('on', !!keys[pe.code]);
}
function showPads(on) { ui.pads.classList.toggle('hidden', !on); }

/* ---------- 获胜分数设定(仅菜单场景可调) ---------- */
function setWinScore(n) {
  winScore = Math.max(WIN_MIN, Math.min(WIN_MAX, n));
  ui.winScoreVal.textContent = winScore;
  ui.subScoreNum.textContent = winScore;
  ui.ruleScoreNum.textContent = winScore;
  ui.durationLine.textContent = winScore <= 4 ? '整局保证在 3 分钟以内' : '高分制整局至多约 3 分半';
  ui.btnScoreMinus.disabled = winScore <= WIN_MIN;
  ui.btnScorePlus.disabled = winScore >= WIN_MAX;
  buildPips();
}
/* 胜点显示:≤8 分用点阵,>8 分空间不足改用 x/N 计数 */
function buildPips() {
  const dots = winScore <= 8 ? winScore : 0;
  [ui.pips1, ui.pips2].forEach(pl => {
    while (pl.children.length > dots) pl.removeChild(pl.lastChild);
    while (pl.children.length < dots) pl.appendChild(document.createElement('i'));
    pl.style.display = dots ? 'flex' : 'none';
  });
  [ui.winCount1, ui.winCount2].forEach(el => { el.style.display = dots ? 'none' : 'block'; });
}
ui.btnScoreMinus.onclick = () => {
  if (state.scene === 'menu') { setWinScore(winScore - 1); ui.btnScoreMinus.blur(); }   // 点击后去焦点,空格留给开局
};
ui.btnScorePlus.onclick = () => {
  if (state.scene === 'menu') { setWinScore(winScore + 1); ui.btnScorePlus.blur(); }
};
let winScore = 3;
setWinScore(3);

/* ---------- 流程 ---------- */
function startMatch() {
  state.scores = [0, 0];
  state.timer = GAME_TIME;
  state.winScore = winScore;               // 快照当前设定,对局中不再受菜单 UI 影响
  state.sudden = false; state.shrink = 1;
  state.paused = false;
  releasePads();                             // 清残留触控指针(基准#4:开局前兜底)
  clearKey('Space'); clearKey('Enter');      // 防开局误触冲刺(物理+触控两源一并清除)
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
  props = []; particles = []; propTimer = 3;
  fx.freeze = 0; fx.goT = 0; fx.flash = null;
  fx.waves = []; fx.texts = []; fx.confetti = []; fx.shrinkSpk = 0;
  respawn();
  state.scene = 'count'; state.countT = 3.2;
  ui.menu.classList.add('hidden');
  ui.over.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.stage.classList.remove('ui-over');   // 结算期隐藏的竖屏提示卡恢复可用
  showPads(true);
  updateHUD();
}
function endBanner(text, color = '#ffd166') {
  state.scene = 'banner'; state.bannerT = 1.4; state.bannerText = text;
  fx.bannerColor = color;
}
function gameOver(winner) {
  state.scene = 'over';
  showPads(false);
  releasePads();          // 结算时手指仍按住虚拟键 → 防下局卡键
  ui.stage.classList.add('ui-over');   // 结算画面保持干净:竖屏提示卡让位
  ui.winText.textContent = winner.name + ' 获胜!';
  ui.winText.style.background = winner.id === 0
    ? 'linear-gradient(90deg,#ff4d6d,#ffd166)' : 'linear-gradient(90deg,#4dc3ff,#ffd166)';
  ui.winText.style.webkitBackgroundClip = 'text';
  ui.finalScore.textContent = `${state.scores[0]} : ${state.scores[1]}`;
  ui.over.classList.remove('hidden');
  spawnConfetti(winner);
  sfx.win();
}
function returnToMenu() {   // 结算返回菜单:可调整获胜分数后再开局
  state.scene = 'menu';
  state.paused = false;
  state.scores = [0, 0];
  state.sudden = false; state.shrink = 1;
  state.timer = GAME_TIME;
  props = []; particles = [];
  clearKeys();
  releasePads();
  fx.confetti = [];
  respawn();
  ui.over.classList.add('hidden');
  ui.hud.classList.add('hidden');
  ui.stage.classList.remove('ui-over');
  showPads(false);
  ui.menu.classList.remove('hidden');
  updateHUD();
}
function spawnConfetti(winner) {
  if (REDUCED) return;
  const colors = [winner.color, winner.color, '#ffd166', '#2ee6a8', '#ffffff'];
  for (let i = 0; i < 130 && fx.confetti.length + particles.length < MAX_PARTICLES; i++) {
    fx.confetti.push({
      x: Math.random() * W, y: -30 - Math.random() * H * 0.6,
      vx: (Math.random() - .5) * 90, vy: 90 + Math.random() * 170,
      w: 4 + Math.random() * 4, h: 7 + Math.random() * 6,
      ph: Math.random() * 6.28, sp: (Math.random() - .5) * 6,
      rot: Math.random() * 6.28,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
}
// 得分:loserIdx 掉落
function score(loserIdx) {
  const winner = players[1 - loserIdx];
  state.scores[1 - loserIdx]++;
  sfx.score();
  updateHUD();
  if (!REDUCED) {
    fx.flash = { c: winner.color, a: .3 };
    fx.waves.push({ x: PLAT.cx, y: PLAT.y + 16, r: 20, vr: 900, w: 5, a: .8, color: winner.color });
  }
  const win = state.scores[1 - loserIdx] >= state.winScore || state.sudden;
  if (win) { gameOver(winner); return; }
  respawn();
  endBanner(`${winner.name} 得分!`, winner.color);
}

/* ---------- 更新 ---------- */
function update(dt) {
  state.time += dt;
  state.shake = Math.max(0, state.shake - dt * 30);
  syncPads();

  // 表现层特效在所有非暂停场景推进(菜单/结算也要有生命感)
  if (!(state.paused && state.scene === 'play')) updateFX(dt);

  if (state.scene === 'count') {
    const prev = Math.ceil(state.countT);
    state.countT -= dt;
    const now = Math.ceil(state.countT);
    if (now !== prev && now > 0) sfx.tick();
    if (state.countT <= 0) {
      state.scene = 'play'; sfx.go();
      fx.goT = .55;
      if (!REDUCED) fx.waves.push({ x: W / 2, y: H / 2 - 30, r: 10, vr: 980, w: 4, a: .7, color: '#ffd166' });
    }
    return;
  }
  if (state.scene === 'banner') {
    state.bannerT -= dt;
    if (state.bannerT <= 0) { state.scene = 'play'; }
    return;
  }
  if (state.scene !== 'play' || state.paused) return;

  // 计时
  if (!state.sudden) {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.timer = 0;
      if (state.scores[0] !== state.scores[1]) { gameOver(players[state.scores[0] > state.scores[1] ? 0 : 1]); return; }
      state.sudden = true;
      endBanner('突然死亡!下一分定胜负', '#ff4d6d');
      return;
    }
  } else {
    // 突然死亡:约 15 秒内收缩殆尽,强制分出胜负,兜底常规时间结束时的平分
    const before = state.shrink;
    state.shrink = Math.max(0, state.shrink - dt * 0.067);
    // 收缩边缘迸出火花(纯表现)
    if (state.shrink < before && !REDUCED) {
      fx.shrinkSpk -= dt;
      if (fx.shrinkSpk <= 0) {
        fx.shrinkSpk = .09;
        const edge = PLAT.w * state.shrink / 2;
        burst(PLAT.cx - edge, PLAT.y + 8, '#ff4d6d', 3, 140);
        burst(PLAT.cx + edge, PLAT.y + 8, '#ff4d6d', 3, 140);
      }
    }
  }

  // 道具生成
  propTimer -= dt;
  if (propTimer <= 0 && props.length < 3) { spawnProp(); propTimer = 5 + Math.random() * 3; }

  updatePlayer(players[0], dt, {
    left: keys.KeyA, right: keys.KeyD, up: keys.KeyW, down: keys.KeyS, dash: keys.Space,
  });
  updatePlayer(players[1], dt, {
    left: keys.ArrowLeft, right: keys.ArrowRight, up: keys.ArrowUp, down: keys.ArrowDown, dash: keys.Enter,
  });

  collidePlayers();
  props.forEach(pr => { pr.life -= dt; pr.t += dt; });
  props = props.filter(pr => {
    if (pr.life <= 0) return false;
    for (const p of players) {
      if (!p.dead && Math.hypot(p.x - pr.x, p.y - pr.y) < p.r + 16) { applyProp(p, pr); return false; }
    }
    return true;
  });

  // 掉落判定(同时掉落:位置更低者先死)
  const dead = players.filter(p => p.y - p.r > H + 80);
  if (dead.length) {
    dead.sort((a, b) => b.y - a.y);
    score(dead[0].id);
  }

  updateHUD();
}

/* ---------- 特效推进(纯表现,不含任何判定) ---------- */
function updateFX(dt) {
  if (fx.flash) { fx.flash.a -= dt * 2.4; if (fx.flash.a <= 0) fx.flash = null; }
  fx.goT = Math.max(0, fx.goT - dt);

  fx.waves.forEach(wv => { wv.r += wv.vr * dt; wv.a -= dt * 1.7; });
  fx.waves = fx.waves.filter(wv => wv.a > 0);
  fx.texts.forEach(tx => { tx.y += tx.vy * dt; tx.a -= dt * 1.15; });
  fx.texts = fx.texts.filter(tx => tx.a > 0);

  particles = particles.filter(pt => (pt.life -= dt) > 0);
  particles.forEach(pt => { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 600 * dt; });

  players.forEach(p => {
    p.trail.forEach(tr => tr.life -= dt * 3.3);
    p.trail = p.trail.filter(tr => tr.life > 0);
  });

  fx.confetti.forEach(cf => {
    cf.x += cf.vx * dt + Math.sin(state.time * 2.2 + cf.ph) * 46 * dt;
    cf.y += cf.vy * dt;
    cf.rot += cf.sp * dt;
  });
  fx.confetti = fx.confetti.filter(cf => cf.y < H + 30);

  embers.forEach(e => {
    e.y -= e.v * dt;
    e.x += Math.sin(state.time * .8 + e.ph) * 10 * dt;
    if (e.y < 468) { e.y = H + 6; e.x = Math.random() * W; }
  });
}

function updatePlayer(p, dt, c) {
  const frozen = p.frozenT > 0;
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.speedT = Math.max(0, p.speedT - dt);
  p.growT = Math.max(0, p.growT - dt);
  p.frozenT = Math.max(0, p.frozenT - dt);
  p.r = p.growT > 0 ? 33 : BASE_R;

  const boost = p.speedT > 0 ? 1.5 : 1;
  if (!frozen) {
    const a = (p.onGround ? ACCEL : AIR_ACCEL) * boost;
    if (c.left)  { p.vx -= a * dt; p.face = -1; }
    if (c.right) { p.vx += a * dt; p.face = 1; }
    if (c.up && p.onGround) { p.vy = -JUMP_V; p.onGround = false; sfx.jump(); p.sy = 1.24; p.sx = .82; }
    if (c.down && !p.onGround) { p.vy = Math.max(p.vy, SLAM_V); p.slamming = true; }
    if (c.dash && p.dashCd <= 0) {
      p.vx = DASH_V * (c.left ? -1 : c.right ? 1 : p.face) * boost;
      p.vy = Math.min(p.vy, -80);
      p.dashCd = DASH_CD; sfx.dash();
      p.dashT = .22;
      burst(p.x, p.y, '#fff', 8, 160);
    }
  }

  // 摩擦 & 速度上限
  const fr = p.onGround ? FRICTION_G : FRICTION_A;
  if (!c.left && !c.right) p.vx *= Math.exp(-fr * dt);
  const maxV = MAX_VX * boost * (p.growT > 0 ? 0.85 : 1);
  p.vx = Math.max(-maxV * 1.8, Math.min(maxV * 1.8, p.vx));

  // 重力(变大更沉)
  p.vy += GRAVITY * (p.growT > 0 ? 1.25 : 1) * dt;
  p.vy = Math.min(p.vy, 1400);

  p.x += p.vx * dt;
  const wasFalling = p.vy > 0;
  const prevBottom = p.y + p.r;
  p.y += p.vy * dt;

  // 平台碰撞(圆 vs 矩形)
  p.onGround = false;
  const pw = PLAT.w * state.shrink / 2;
  const nx = Math.max(PLAT.cx - pw, Math.min(p.x, PLAT.cx + pw));
  const ny = Math.max(PLAT.y, Math.min(p.y, PLAT.y + PLAT.h));
  const dx = p.x - nx, dy = p.y - ny;
  const dist = Math.hypot(dx, dy);
  if (dist < p.r && dist > 0.0001) {
    const pen = p.r - dist;
    const ux = dx / dist, uy = dy / dist;
    p.x += ux * pen; p.y += uy * pen;
    const vn = p.vx * ux + p.vy * uy;
    if (vn < 0) {
      p.vx -= vn * ux * 1.15;
      p.vy -= vn * uy * 1.15;
      if (uy < -0.5 && wasFalling) {   // 落地
        p.onGround = true;
        if (p.slamming) {              // 下砸落地:冲击波
          p.slamming = false;
          state.shake = 10; sfx.hit();
          burst(p.x, p.y + p.r, '#ffd76e', 14, 300);
          const o = players[1 - p.id];
          if (Math.abs(o.x - p.x) < 160 && o.y > PLAT.y - 60 && !o.dead) {
            const dir = Math.sign(o.x - p.x) || 1;
            o.vx += dir * 620; o.vy -= 420;
          }
          if (!REDUCED) {
            p.sx = 1.45; p.sy = .6;
            fx.freeze = Math.min(HIT_STOP_MAX, .05);
            fx.flash = { c: '#ffd166', a: .15 };
            fx.waves.push({ x: p.x, y: p.y + p.r, r: 12, vr: 760, w: 5, a: .75, color: '#ffd166' });
          }
        } else if (!REDUCED) {         // 普通落地:按冲量挤压
          const k = Math.min(1, -vn / 900);
          p.sx = 1 + .32 * k; p.sy = 1 - .32 * k;
        }
      }
    }
  }

  p.eyeX += ((p.vx / 600) - p.eyeX) * Math.min(1, dt * 8);
  p.eyeY += ((p.vy / 900) - p.eyeY) * Math.min(1, dt * 8);

  // 表现层:挤压恢复 / 冲刺余辉 / 拖尾采样 / 眨眼
  p.dashT = Math.max(0, p.dashT - dt);
  p.blink -= dt;
  if (p.blink < -0.12) p.blink = 2.4 + Math.random() * 2.2;
  if (!REDUCED) {
    const ty = p.onGround ? 1 : 1 + Math.min(.22, Math.abs(p.vy) / 3800);
    const tx = p.onGround ? 1 : 1 - Math.min(.16, Math.abs(p.vy) / 5200);
    p.sx += (tx - p.sx) * Math.min(1, dt * 10);
    p.sy += (ty - p.sy) * Math.min(1, dt * 10);
    if (Math.abs(p.vx) > 430 || p.dashT > 0) {
      p.trail.push({ x: p.x, y: p.y, r: p.r, life: p.dashT > 0 ? 1 : .6 });
      if (p.trail.length > 14) p.trail.shift();
    }
  } else { p.sx = p.sy = 1; }
}

function collidePlayers() {
  const [a, b] = players;
  if (a.dead || b.dead) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy), minD = a.r + b.r;
  if (dist >= minD || dist === 0) return;

  const ux = dx / dist, uy = dy / dist;
  const pen = minD - dist;
  const ma = a.growT > 0 ? 1.9 : 1, mb = b.growT > 0 ? 1.9 : 1;
  a.x -= ux * pen * (mb / (ma + mb));
  a.y -= uy * pen * (mb / (ma + mb));
  b.x += ux * pen * (ma / (ma + mb));
  b.y += uy * pen * (ma / (ma + mb));

  const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
  const vn = rvx * ux + rvy * uy;
  if (vn > 0) return;
  const j = -(1 + 1.25) * vn / (1 / ma + 1 / mb);  // 冲量(带撞击加成)
  a.vx -= j * ux / ma; a.vy -= j * uy / ma;
  b.vx += j * ux / mb; b.vy += j * uy / mb;

  const strength = Math.min(1, Math.abs(vn) / 700);
  state.shake = Math.max(state.shake, 12 * strength);
  burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#fff', Math.round(4 + 10 * strength), 220 + 300 * strength);
  if (strength > 0.25) sfx.hit();
  // 重击:顿帧 + 白闪 + 冲击波(纯表现)
  if (!REDUCED && strength > 0.55) {
    fx.freeze = Math.min(HIT_STOP_MAX, .045 + .035 * strength);
    fx.flash = { c: '#ffffff', a: .18 };
  }
  if (!REDUCED && strength > 0.35) {
    fx.waves.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: 8, vr: 520 + 320 * strength, w: 3, a: .45 + .3 * strength, color: '#ffffff' });
  }
}

/* ---------- HUD ---------- */
function updateHUD() {
  ui.score1.textContent = state.scores[0];
  ui.score2.textContent = state.scores[1];
  const m = Math.floor(state.timer / 60), s = Math.floor(state.timer % 60);
  ui.timer.textContent = state.sudden ? '决斗' : `${m}:${String(s).padStart(2, '0')}`;
  ui.timer.classList.toggle('danger', !state.sudden && state.timer <= 30);
  [players[0], players[1]].forEach((p, i) => {
    const el = i === 0 ? ui.st1 : ui.st2;
    const parts = [];
    if (p.speedT > 0) parts.push('加速 ' + p.speedT.toFixed(1) + 's');
    if (p.growT > 0) parts.push('变大 ' + p.growT.toFixed(1) + 's');
    if (p.frozenT > 0) parts.push('冰冻 ' + p.frozenT.toFixed(1) + 's');
    if (p.dashCd > 0) parts.push('冲刺 ' + p.dashCd.toFixed(1) + 's');
    el.textContent = parts.join(' · ');
  });
  [ui.pips1, ui.pips2].forEach((pl, i) => {
    for (let k = 0; k < pl.children.length; k++) {
      pl.children[k].classList.toggle('on', k < state.scores[i]);
    }
  });
  ui.winCount1.textContent = `${state.scores[0]} / ${state.winScore}`;
  ui.winCount2.textContent = `${state.scores[1]} / ${state.winScore}`;
}

/* ---------- 预渲染(离屏层,避免逐帧重建大渐变) ---------- */
function makeCanvas(w, h) {
  try {
    const c = document.createElement('canvas');
    if (!c || typeof c.getContext !== 'function') return null;
    c.width = w; c.height = h;
    return c.getContext('2d') ? c : null;
  } catch (e) { return null; }
}
function makeGlow(rgb) {   // 球体光晕贴图
  const c = makeCanvas(128, 128);
  if (!c) return null;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  rg.addColorStop(0, `rgba(${rgb},.55)`);
  rg.addColorStop(.45, `rgba(${rgb},.22)`);
  rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return c;
}
function makeBackground() {   // 底色渐变+星云,一次性离屏(避免逐帧全屏渐变重建)
  const c = makeCanvas(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#070b1a'); base.addColorStop(.55, '#0a0e28'); base.addColorStop(1, '#120c2c');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  let rg = g.createRadialGradient(W * .2, H * .18, 20, W * .2, H * .18, 430);
  rg.addColorStop(0, 'rgba(60,110,255,.13)'); rg.addColorStop(1, 'rgba(60,110,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  rg = g.createRadialGradient(W * .85, H * .5, 20, W * .85, H * .5, 480);
  rg.addColorStop(0, 'rgba(150,60,255,.11)'); rg.addColorStop(1, 'rgba(150,60,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  return c;
}
function makeGlowStrip(rgb, h) {   // 底部余烬辉光条(预渲染)
  const c = makeCanvas(W, h);
  if (!c) return null;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, `rgba(${rgb},0)`); lg.addColorStop(1, `rgba(${rgb},.26)`);
  g.fillStyle = lg; g.fillRect(0, 0, W, h);
  return c;
}
function makeVignette() {          // 突然死亡红色暗角(预渲染)
  const c = makeCanvas(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .78);
  rg.addColorStop(0, 'rgba(255,45,70,0)'); rg.addColorStop(1, 'rgba(255,45,70,.17)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  return c;
}
const glowP1 = makeGlow('255,77,109'), glowP2 = makeGlow('77,195,255');
const bgCv = makeBackground();
const stripWarm = makeGlowStrip('255,150,80', 150), stripRed = makeGlowStrip('255,90,95', 150);
const vigCv = makeVignette();

/* 星层(视差 + 闪烁) */
const starLayers = [];
[[26, 1.1, .36, 9], [16, 1.7, .52, 20], [10, 2.2, .68, 38]].forEach(([n, sz, al, dr], li) => {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ x: Math.random() * W, y: Math.random() * (170 + li * 70), ph: Math.random() * 6.28 });
  starLayers.push({ sz, al, dr, arr });
});

/* ---------- 渲染 ---------- */
function render() {
  ctx.save();
  const sk = state.shake * (REDUCED ? .4 : 1);
  if (sk > 0) ctx.translate((Math.random() - .5) * sk, (Math.random() - .5) * sk);

  drawBackground();
  drawGridFloor();
  drawEmbers();
  if (state.scene === 'menu' || state.scene === 'count') drawWatermark();
  drawPlatform();
  for (const pr of props) drawProp(pr);
  for (const p of players) drawTrail(p);
  for (const p of players) if (!p.dead && p.y < H + 60) drawPlayer(p);
  drawParticles();
  drawConfetti();
  drawWaves();
  drawTexts();
  drawFlash();
  if (state.sudden) drawDangerVignette();
  drawSceneText();

  ctx.restore();
}

function drawBackground() {
  if (bgCv) ctx.drawImage(bgCv, -20, -20, W + 40, H + 40);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070b1a'); g.addColorStop(.55, '#0a0e28'); g.addColorStop(1, '#120c2c');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  // 星层(减动效:静止且不闪烁)
  for (const layer of starLayers) {
    for (const st of layer.arr) {
      const sx = REDUCED ? st.x : ((st.x - state.time * layer.dr) % W + W) % W;
      ctx.globalAlpha = layer.al * (REDUCED ? .8 : (.55 + .45 * Math.sin(state.time * 1.8 + st.ph)));
      ctx.fillStyle = '#cdd8ff';
      ctx.fillRect(sx, st.y, layer.sz, layer.sz);
    }
  }
  ctx.globalAlpha = 1;
}

/* 霓虹网格地面:地平线在平台下方,缓缓向下流动 */
function drawGridFloor() {
  const gy0 = 478, cxv = W / 2;
  const col = state.sudden ? '255,77,109' : '46,230,168';
  const pulse = state.sudden && !REDUCED ? .8 + .25 * Math.sin(state.time * 6) : 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(${col},.05)`;
  for (let k = -6; k <= 6; k++) {
    ctx.beginPath();
    ctx.moveTo(cxv + k * 34, gy0);
    ctx.lineTo(cxv + k * 150, H + 20);
    ctx.stroke();
  }
  const scroll = REDUCED ? 0 : (state.time * .55) % 1;
  for (let i = 0; i < 13; i++) {
    const p = (i + scroll) / 13;
    const y = gy0 + (H + 30 - gy0) * p * p;
    ctx.strokeStyle = `rgba(${col},${(.03 + .11 * p) * pulse})`;
    ctx.beginPath(); ctx.moveTo(-10, y); ctx.lineTo(W + 10, y); ctx.stroke();
  }
  // 地平线亮线
  ctx.lineWidth = 9; ctx.strokeStyle = `rgba(${col},${.10 * pulse})`;
  ctx.beginPath(); ctx.moveTo(0, gy0); ctx.lineTo(W, gy0); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(${col},${.5 * pulse})`;
  ctx.beginPath(); ctx.moveTo(0, gy0); ctx.lineTo(W, gy0); ctx.stroke();
}

function drawEmbers() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 底部辉光(预渲染条)
  const strip = state.sudden ? stripRed : stripWarm;
  if (strip) ctx.drawImage(strip, -20, H - 140, W + 40, 150);
  else {
    const base = state.sudden ? '255,90,95' : '255,150,80';
    const g = ctx.createLinearGradient(0, H - 140, 0, H);
    g.addColorStop(0, `rgba(${base},0)`); g.addColorStop(1, `rgba(${base},.26)`);
    ctx.fillStyle = g; ctx.fillRect(-20, H - 140, W + 40, 150);
  }
  for (const e of embers) {
    ctx.globalAlpha = REDUCED ? .22 : .16 + .14 * Math.sin(state.time * 2 + e.ph);
    ctx.fillStyle = state.sudden ? 'rgb(255,90,95)' : 'rgb(255,150,80)';
    ctx.beginPath(); ctx.arc(e.x, e.y, e.sz, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawWatermark() {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 58px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  const g = ctx.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0);
  g.addColorStop(0, 'rgba(255,77,109,.16)'); g.addColorStop(.5, 'rgba(140,150,255,.14)'); g.addColorStop(1, 'rgba(77,195,255,.16)');
  ctx.fillStyle = g;
  ctx.fillText('球球大乱斗', W / 2, H / 2);
  ctx.restore();
}

function drawPlatform() {
  const pw = PLAT.w * state.shrink;
  if (pw < 4) return;
  const px = PLAT.cx - pw / 2;
  const sd = state.sudden;
  const rim = sd ? '#ff4d6d' : '#2ee6a8';
  const rimHi = sd ? '#ff96ac' : '#8fffd4';
  const pulse = sd && !REDUCED ? .7 + .3 * Math.sin(state.time * 7) : 1;

  // 悬浮能量辉光
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (sd ? .5 : .38) * (REDUCED ? 1 : .8 + .2 * Math.sin(state.time * 2.2));
  const ug = ctx.createRadialGradient(PLAT.cx, PLAT.y + PLAT.h + 14, 8, PLAT.cx, PLAT.y + PLAT.h + 14, pw * .48);
  ug.addColorStop(0, sd ? 'rgba(255,77,109,.30)' : 'rgba(46,230,168,.24)');
  ug.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ug;
  ctx.fillRect(px - 40, PLAT.y + PLAT.h, pw + 80, 60);
  ctx.restore();

  // 主体
  const body = ctx.createLinearGradient(0, PLAT.y, 0, PLAT.y + PLAT.h);
  body.addColorStop(0, '#262e5e'); body.addColorStop(1, '#151a3c');
  ctx.fillStyle = body;
  roundRect(px, PLAT.y, pw, PLAT.h, 10); ctx.fill();
  // 顶部霓虹沿口
  ctx.fillStyle = sd ? '#8f1d3c' : '#175843';
  roundRect(px, PLAT.y, pw, 13, 8); ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = pulse;
  ctx.fillStyle = rim;
  ctx.fillRect(px + 3, PLAT.y, pw - 6, 3);
  ctx.globalAlpha = pulse * .5;
  ctx.fillStyle = rimHi;
  ctx.fillRect(px + 3, PLAT.y - 2, pw - 6, 2);
  ctx.restore();
  // 两端侧沿高光
  ctx.fillStyle = 'rgba(255,255,255,.07)';
  ctx.fillRect(px, PLAT.y, 2.5, PLAT.h);
  ctx.fillRect(px + pw - 2.5, PLAT.y, 2.5, PLAT.h);
}

/* 道具:霓虹环 + 自绘矢量图标(与侧栏 SVG 同构) */
function drawProp(pr) {
  const bob = Math.sin(pr.t * 3) * 5;
  const y = pr.y + bob;
  const a = pr.life < 2 ? (REDUCED ? .55 : (Math.sin(pr.life * 12) * .5 + .5) * .9) : 1;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath(); ctx.arc(pr.x, y, 17, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = pr.color; ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a * .3;
  ctx.lineWidth = 6; ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  drawIcon(pr.key, pr.x, y, 8.5, pr.color);
  ctx.restore();
}

/* 矢量图标:闪电 / 外扩箭头 / 雪花 / 八向星芒 */
function drawIcon(key, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath();
  if (key === 'speed') {
    ctx.moveTo(.25 * s, -s); ctx.lineTo(-.55 * s, .15 * s); ctx.lineTo(-.05 * s, .15 * s);
    ctx.lineTo(-.25 * s, s); ctx.lineTo(.55 * s, -.15 * s); ctx.lineTo(.05 * s, -.15 * s);
    ctx.closePath(); ctx.fill();
  } else if (key === 'grow') {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(.4 * s * dx, .4 * s * dy);
      ctx.lineTo(1.05 * s * dx, 1.05 * s * dy);
      ctx.moveTo(1.05 * s * dx, 1.05 * s * dy);
      ctx.lineTo((1.05 - .38) * s * dx - .3 * s * dy, (1.05 - .38) * s * dy - .3 * s * dx);
      ctx.moveTo(1.05 * s * dx, 1.05 * s * dy);
      ctx.lineTo((1.05 - .38) * s * dx + .3 * s * dy, (1.05 - .38) * s * dy + .3 * s * dx);
    }
    ctx.stroke();
  } else if (key === 'freeze') {
    for (let k = 0; k < 3; k++) {
      const ang = k * Math.PI / 3;
      ctx.moveTo(Math.cos(ang) * s, Math.sin(ang) * s);
      ctx.lineTo(-Math.cos(ang) * s, -Math.sin(ang) * s);
    }
    ctx.stroke();
  } else {  // dash
    for (let k = 0; k < 8; k++) {
      const ang = k * Math.PI / 4;
      ctx.moveTo(Math.cos(ang) * .45 * s, Math.sin(ang) * .45 * s);
      ctx.lineTo(Math.cos(ang) * 1.05 * s, Math.sin(ang) * 1.05 * s);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrail(p) {
  if (!p.trail.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const tr of p.trail) {
    ctx.globalAlpha = Math.max(0, tr.life) * (p.dashT > 0 ? .34 : .18);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r * .85, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(p) {
  const bob = state.scene === 'menu' && !REDUCED ? Math.sin(state.time * 2 + p.id * 2.1) * 6 : 0;
  const x = p.x, y = p.y + bob, r = p.r;

  // 地面阴影
  ctx.beginPath(); ctx.ellipse(x, PLAT.y + 6, r * .8, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fill();

  // 霓虹光晕
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = p.id === 0 ? glowP1 : glowP2;
  if (glow) {
    ctx.globalAlpha = p.dashT > 0 ? .8 : .5;
    ctx.drawImage(glow, x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
  } else {
    const rg = ctx.createRadialGradient(x, y, r * .4, x, y, r * 2.6);
    rg.addColorStop(0, p.id === 0 ? 'rgba(255,77,109,.4)' : 'rgba(77,195,255,.4)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = .8;
    ctx.fillStyle = rg; ctx.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
  }
  ctx.restore();

  // 球体(带挤压形变)
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(p.sx, p.sy);
  const g = ctx.createRadialGradient(-r * .3, -r * .4, r * .2, 0, 0, r);
  g.addColorStop(0, '#ffffff8c'); g.addColorStop(.3, p.color); g.addColorStop(1, p.dark);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  // 沿口:冲刺就绪时亮白发光
  const ready = p.dashCd <= 0;
  if (ready) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = .45;
    ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, 0, r - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = ready ? '#ffffff' : 'rgba(7,9,20,.5)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

  // 变大:内圈虚线环
  if (p.growT > 0) {
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.beginPath(); ctx.arc(0, 0, r * .6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 加速:身后速度线
  if (p.speedT > 0) {
    ctx.save();
    ctx.globalAlpha = .5; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const lx = -p.face * r * 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, i * r * .45);
      ctx.lineTo(lx - p.face * r * .5, i * r * .45);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 眼睛:P1 双圆眼 / P2 单护目镜(色弱也可辨的角色区分)
  const ex = p.eyeX * 4, ey = p.eyeY * 4;
  const blinkK = p.blink < 0 ? .12 : 1;
  if (p.id === 0) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * r * .32 + ex, -r * .15 + ey, r * .18, r * .18 * blinkK, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      if (blinkK > .5) {
        ctx.beginPath();
        ctx.arc(s * .32 * r + ex * 1.6, -r * .15 + ey * 1.6, r * .09, 0, Math.PI * 2);
        ctx.fillStyle = '#181b33'; ctx.fill();
      }
    }
  } else {
    roundRect(-r * .55, -r * .34, r * 1.1, r * .44, r * .2);
    ctx.fillStyle = '#0c1028'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.stroke();
    if (blinkK > .5) {
      ctx.fillStyle = '#bff0ff';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * .24 + ex * 1.4, -r * .12 + ey * 1.4, r * .07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 冰冻外壳 + 裂纹
  if (p.frozenT > 0) {
    ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(150,225,255,.32)'; ctx.fill();
    ctx.strokeStyle = '#cfefff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) {
      const a0 = k * 2.1 + .4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * (r - 4), Math.sin(a0) * (r - 4));
      ctx.lineTo(Math.cos(a0 + .35) * (r + 4), Math.sin(a0 + .35) * (r + 4));
      ctx.stroke();
    }
  }
  ctx.restore();

  // 冲刺冷却弧环(就绪时由亮白沿口表示)
  if (p.dashCd > 0) {
    const prog = 1 - p.dashCd / DASH_CD;
    ctx.beginPath();
    ctx.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 玩家名称
  ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(5,7,18,.75)'; ctx.lineWidth = 3;
  ctx.strokeText(p.name, x, y - r - 14);
  ctx.fillStyle = p.color;
  ctx.fillText(p.name, x, y - r - 14);
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2.2));
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawConfetti() {
  if (!fx.confetti.length) return;
  for (const cf of fx.confetti) {
    ctx.save();
    ctx.translate(cf.x, cf.y);
    ctx.rotate(cf.rot);
    ctx.globalAlpha = .92;
    ctx.fillStyle = cf.color;
    ctx.fillRect(-cf.w / 2, -cf.h / 2, cf.w, cf.h);
    ctx.restore();
  }
}

function drawWaves() {
  if (!fx.waves.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const wv of fx.waves) {
    ctx.globalAlpha = Math.max(0, wv.a);
    ctx.strokeStyle = wv.color;
    ctx.lineWidth = wv.w;
    ctx.beginPath(); ctx.arc(wv.x, wv.y, wv.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawTexts() {
  if (!fx.texts.length) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of fx.texts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, tx.a));
    ctx.font = `900 ${tx.size}px "Segoe UI", "Microsoft YaHei", sans-serif`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,7,18,.8)';
    ctx.strokeText(tx.txt, tx.x, tx.y);
    ctx.fillStyle = tx.color;
    ctx.fillText(tx.txt, tx.x, tx.y);
  }
  ctx.restore();
}

function drawFlash() {
  if (!fx.flash) return;
  ctx.save();
  ctx.globalAlpha = Math.min(.85, Math.max(0, fx.flash.a));
  ctx.fillStyle = fx.flash.c;
  ctx.fillRect(-30, -30, W + 60, H + 60);
  ctx.restore();
}

function drawDangerVignette() {
  const k = REDUCED ? .7 : .6 + .4 * Math.sin(state.time * 5);   // 峰值 .17
  if (vigCv) {
    ctx.globalAlpha = k;
    ctx.drawImage(vigCv, -20, -20, W + 40, H + 40);
    ctx.globalAlpha = 1;
    return;
  }
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .78);
  g.addColorStop(0, 'rgba(255,45,70,0)');
  g.addColorStop(1, `rgba(255,45,70,${(k * .17).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(-20, -20, W + 40, H + 40);
}

/* 倒计时 / GO / 横幅 / 暂停 */
function drawSceneText() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (state.scene === 'count') {
    const n = Math.ceil(state.countT);
    const frac = state.countT - Math.floor(state.countT);
    const cx = W / 2, cy = H / 2 - 30;
    // 进度环
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2); ctx.stroke();
    // 数字(每秒弹出)
    const s = REDUCED ? 1 : 1 + .45 * frac * frac;
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, s);
    ctx.globalAlpha = REDUCED ? 1 : .35 + .65 * frac;
    ctx.font = '900 84px "Segoe UI", "Microsoft YaHei", sans-serif';
    const g = ctx.createLinearGradient(0, -40, 0, 40);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffd166');
    ctx.fillStyle = g;
    ctx.fillText(n > 3 ? '3' : String(n), 0, 0);
    ctx.restore();
  }
  if (fx.goT > 0 && state.scene === 'play') {
    const k = fx.goT / .55;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 30);
    const gs = REDUCED ? 1 : 1 + (1 - k) * .45;
    ctx.scale(gs, gs);
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.font = '900 92px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,209,102,.35)';
    ctx.strokeText('GO!', 0, 0);
    ctx.fillStyle = '#ffd166';
    ctx.fillText('GO!', 0, 0);
    ctx.restore();
  }
  if (state.scene === 'banner') {
    const a = Math.min(1, state.bannerT * 2.5);
    const pop = REDUCED ? 1 : 1 + .18 * Math.max(0, (state.bannerT - 1.15) / .25);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 36);
    ctx.scale(pop, pop);
    ctx.globalAlpha = a;
    try { ctx.letterSpacing = '6px'; } catch (e) {}
    ctx.font = '900 50px "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.lineWidth = 12; ctx.lineJoin = 'round';
    ctx.strokeStyle = fx.bannerColor;
    ctx.globalAlpha = a * .35;
    ctx.strokeText(state.bannerText, 0, 0);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.bannerText, 0, 0);
    ctx.restore();
  }
  if (state.paused && state.scene === 'play') {
    ctx.fillStyle = 'rgba(4,6,16,.62)'; ctx.fillRect(0, 0, W, H);
    ctx.font = '900 46px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(140,160,255,.3)';
    ctx.strokeText('已暂停', W / 2, H / 2 - 20);
    ctx.fillStyle = '#fff';
    ctx.fillText('已暂停', W / 2, H / 2 - 20);
    ctx.font = '16px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.globalAlpha = REDUCED ? 1 : .75 + .25 * Math.sin(state.time * 3);
    ctx.fillStyle = '#ffd166';
    ctx.fillText('按 P 或点击画面继续 · 按 R 重新开始', W / 2, H / 2 + 38);
    ctx.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------- 主循环 ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (fx.freeze > 0) {
    // hit-stop:世界冻结,仅渲染(表现层,≤0.08 秒)
    fx.freeze -= dt;
    render();
  } else {
    update(dt);
    render();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
