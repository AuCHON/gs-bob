/* =========================================================
 * 冒烟测试:零依赖,Node 直接运行(npm test)
 * 1) 语法门:node --check js/game.js
 * 2) mock DOM/Canvas 加载 game.js,覆盖:
 *    菜单(含获胜分数设定 3~16) → 倒计时 → 对局(输入/碰撞/暂停/失焦/R)
 *    → 突然死亡 → 结算 → 再来一局/返回菜单 → 4 分制恰在第 4 分结算
 * 3) 全新二次加载复位默认 3 分。
 * ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STEP = 1000 / 60;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  ok  ${name}`); }
  else { failed++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/* ---------- 1) 语法门 ---------- */
const synt = spawnSync(process.execPath, ['--check', path.join(ROOT, 'js', 'game.js')], { encoding: 'utf8' });
check('语法检查 node --check js/game.js', synt.status === 0, synt.stderr);

/* ---------- 1b) HTML 静态层契约(获胜规则提示双副本防漂移) ---------- */
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
check('规则行结构:2 组容器 / 4 行 / 4 图标',
  (HTML.match(/class="win-rule/g) || []).length === 2
  && (HTML.match(/class="wr"/g) || []).length === 4
  && (HTML.match(/class="wr-ic"/g) || []).length === 4);
check('获胜条件文案两处逐字一致且默认 3',
  (HTML.match(/先得 <b id="(subScoreNum|ruleScoreNum)">3<\/b> 分即胜/g) || []).length === 2
  && (HTML.match(/时间到 · 分高者胜/g) || []).length === 2);
check('菜单含平分加赛脚注且无死锚点 ruleLine', /class="wr-note">平分加赛/.test(HTML) && !/ruleLine/.test(HTML));
check('结算"恭喜"先于胜者名',
  HTML.indexOf('class="congrats">恭喜!') >= 0 && HTML.indexOf('class="congrats">恭喜!') < HTML.indexOf('id="winText"'));
check('虚拟按键结构:P1/P2 各 5 键且容器 aria 隐藏',
  ['vk-w','vk-a','vk-s','vk-d','vk-sp','vk-up','vk-left','vk-down','vk-right','vk-en']
    .every(id => HTML.includes(`id="${id}"`))
  && /id="pads" class="hidden" aria-hidden="true"/.test(HTML));
check('竖屏提示卡与关闭按钮存在', /id="rotateHint"/.test(HTML) && /id="rhClose"/.test(HTML));
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
check('触控契约:touch-action 防线与竖屏媒体查询',
  /touch-action: none/.test(CSS) && /orientation: portrait/.test(CSS) && /touch-action: manipulation/.test(CSS));
check('触屏档按键加大:基础档+自适应档分层、块序在窄屏块后、横屏 4+1 重排',
  CSS.indexOf('@media (any-pointer: coarse)') > CSS.indexOf('max-width: 760px')
  && (CSS.match(/@media \(any-pointer: coarse\)/g) || []).length === 4   // 四处全用 any-pointer(含触屏隐藏 P/R 行)
  && !/@media \(pointer: coarse\)/.test(CSS)                              // 无残留主指针判定
  && /@supports \(width: 1cqw\)/.test(CSS)
  && /container-type: inline-size/.test(CSS)
  && /repeat\(3, 44px\)/.test(CSS)
  && /clamp\(44px, 13cqw, 52px\)/.test(CSS)
  && /clamp\(44px, 12cqw, 48px\)/.test(CSS)
  && /clamp\(44px, 10\.5cqw, 54px\)/.test(CSS)
  && /clamp\(44px, 9cqw, 46px\)/.test(CSS)
  && CSS.indexOf('grid-area: 1 / 4') > CSS.indexOf('@supports (width: 1cqw)')   // 重排须在 @supports 内
  && /grid-area: 2 \/ 1 \/ 3 \/ -1/.test(CSS)
  && /#rotateHint \{ bottom: min\(186px, calc\(66\.67cqw - 56px\)\); \}/.test(CSS));
const JSRC0 = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
check('tips 面板重构与侧栏排版契约(锚定选择器,芯片-机制双钉)',
  (HTML.match(/class="tchip"/g) || []).length === 2
  && /id="durationLine"/.test(HTML) && /class="tips-keys"/.test(HTML)
  && /常规 <b>2:30<\/b>/.test(HTML) && /平分加赛 <b>≤15 秒/.test(HTML)
  && /GAME_TIME = 150/.test(JSRC0) && /0\.067/.test(JSRC0)          // 芯片数字与机制常量同钉(改任一处须同步)
  && /\.panel \{[\s\S]*?padding: 5px 11px;[\s\S]*?font-size: 14\.5px;[\s\S]*?line-height: 1\.65;/.test(CSS)
  && /\.side-title \{[\s\S]*?font-size: 24px;[\s\S]*?line-height: 1\.25;/.test(CSS)
  && /\.tchip \{[\s\S]*?white-space: nowrap;/.test(CSS)
  && /\.panel \{ padding: 4px 10px; font-size: 13\.5px; line-height: 1\.6; \}/.test(CSS)
  && /any-pointer: coarse[\s\S]*?\.tips-keys \{ display: none; \}/.test(CSS));
check('viewport 防误缩放 + README 触屏说明',
  /user-scalable=no/.test(HTML) && /虚拟按键/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
check('得分横幅不含"恭喜"(仅结算层)', !/恭喜/.test(fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8')));
check('侧栏与舞台等高:--stage-h 联动公式 + 面板弹性撑满',
  /--stage-h: min\(calc\(96vh \* 0\.96\), calc\(\(100vw - 306px\) \/ 1\.5\)\)/.test(CSS)
  && /width: min\(calc\(96vh \* 1\.44\), calc\(100vw - 306px\)\)/.test(CSS)   // 舞台侧公式同被钉住
  && /aspect-ratio: 3 \/ 2/.test(CSS)
  && /height: var\(--stage-h\)/.test(CSS)
  && /flex: 1 1 auto/.test(CSS)
  && /min-width: 761px\) and \(max-width: 1279px\)/.test(CSS));

/* ---------- 2) mock 环境 ---------- */
function makeCtx() {
  const grad = { addColorStop() {} };
  const box = {};
  return new Proxy(box, {
    get(t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad;
      if (!(prop in t)) t[prop] = function () {};
      return t[prop];
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}
function makeClassList() {
  const s = new Set();
  return {
    add: c => s.add(c),
    remove: c => s.delete(c),
    toggle: (c, force) => { (force === undefined ? !s.has(c) : force) ? s.add(c) : s.delete(c); },
    contains: c => s.has(c),
  };
}
function makeEl(id) {
  return {
    id, tagName: 'DIV', textContent: '', style: {}, onclick: null, disabled: false,
    classList: makeClassList(),
    blur() {},
    addEventListener(type, fn) {   // 同类型多监听器以数组共存(单值覆盖会假绿)
      (this._ev = this._ev || {});
      (this._ev[type] = this._ev[type] || []).push(fn);
    },
    children: id === 'pips1' || id === 'pips2' ? [makeEl(id + '-i0'), makeEl(id + '-i1'), makeEl(id + '-i2')] : [],
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    get lastChild() { return this.children[this.children.length - 1]; },
    getContext: id === 'game' ? () => makeCtx() : undefined,
  };
}
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');

/* 每次调用 = 一次"全新页面加载" */
function createGame() {
  const els = {}, handlers = {}, g = { els, handlers };
  let rafCb = null, t = 0;
  const sandbox = {
    document: {
      getElementById: id => (els[id] = els[id] || makeEl(id)),
      createElement: tag => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => makeCtx() } : makeEl('dyn-' + tag)),
      activeElement: null,
    },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    requestAnimationFrame: cb => { rafCb = cb; return 1; },
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: false }),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'game.js' });
  g.frame = n => { for (let i = 0; i < n; i++) { t += STEP; rafCb(t); } };
  g.key = code => handlers.keydown({ code, repeat: false, preventDefault() {} });
  g.keyOn = (code, tagName) => handlers.keydown({ code, repeat: false, preventDefault() {}, target: { tagName } });
  g.keyup = code => handlers.keyup && handlers.keyup({ code });
  g.pad = (id, type, ptype, pid) => {
    const el = els[id];
    const fns = el && el._ev && el._ev[type];
    if (fns) fns.forEach(fn => fn({ pointerType: ptype, pointerId: pid || 1, preventDefault() {} }));
  };
  g.ptr = (type, pid) => { if (handlers[type]) handlers[type]({ pointerId: pid }); };   // 全局指针事件(pointerup/cancel)
  g.blur = () => handlers.blur && handlers.blur();
  g.click = id => { if (els[id] && typeof els[id].onclick === 'function') els[id].onclick(); };
  return g;
}

/* ---------- 3) 主流程 ---------- */
let g1 = null, loadErr = null;
try { g1 = createGame(); } catch (e) { loadErr = e; }
check('加载 game.js 无异常', !loadErr && !!g1, loadErr && loadErr.stack);
if (!g1) { console.error('无法继续,提前退出'); process.exit(1); }
const E = g1.els;
const sc = () => [parseInt(E.score1.textContent, 10) || 0, parseInt(E.score2.textContent, 10) || 0];
const sum = () => sc()[0] + sc()[1];
const overShown = () => !E.over.classList.contains('hidden');
/* 按住 D 走位挤下对手得分一次(得分或结算出现即停) */
function scoreOnce(maxFrames) {
  const before = sum();
  g1.key('KeyD');
  for (let i = 0; i < (maxFrames || 600) && sum() === before && !overShown(); i++) g1.frame(1);
  g1.keyup('KeyD');
  g1.frame(130);   // 得分横幅(1.4s)
}

let runErr = null;
try {
  /* —— 菜单:获胜分数设定 —— */
  g1.frame(5);
  check('默认获胜分数为 3', String(E.winScoreVal.textContent) === '3');
  check('侧栏/菜单规则数字默认 3', String(E.ruleScoreNum.textContent) === '3'
    && String(E.subScoreNum.textContent) === '3');
  for (let i = 0; i < 20; i++) g1.click('btnScorePlus');
  check('+ 越界钳制到 16', String(E.winScoreVal.textContent) === '16', E.winScoreVal.textContent);
  check('到 16 后 + 按钮禁用', E.btnScorePlus.disabled === true);
  for (let i = 0; i < 20; i++) g1.click('btnScoreMinus');
  check('− 越界钳制到 3', String(E.winScoreVal.textContent) === '3', E.winScoreVal.textContent);
  check('到 3 后 − 按钮禁用', E.btnScoreMinus.disabled === true);
  for (let i = 0; i < 5; i++) g1.click('btnScorePlus');
  check('8 分制仍用点阵(8 枚)', E.pips1.children.length === 8 && E.pips1.style.display === 'flex');
  g1.click('btnScorePlus');
  check('9 分制切换为 x/N 计数并清空点阵', E.pips1.style.display === 'none'
    && E.wincount1.style.display === 'block' && E.pips1.children.length === 0);
  for (let i = 0; i < 5; i++) g1.click('btnScoreMinus');
  check('菜单与侧栏规则数字联动为 4', String(E.subScoreNum.textContent) === '4'
    && String(E.ruleScoreNum.textContent) === '4');
  g1.click('btnScoreMinus');   // 回到 3,走默认全流程

  /* 按钮聚焦时 Enter/Space 豁免全局热键(交给按钮原生激活) */
  g1.keyOn('Space', 'BUTTON'); g1.frame(5);
  check('菜单按钮聚焦时空格不开局', !E.menu.classList.contains('hidden'));
  // 注:菜单期 pads 隐藏由 HTML 契约断言(id="pads" class="hidden")覆盖,mock 无法感知初始 class
  g1.click('rhClose');
  check('竖屏提示"知道了"会话内关闭', E.rotateHint.classList.contains('dismissed'));

  /* —— 默认 3 分全流程 —— */
  g1.key('Space'); g1.frame(10);
  check('开局后菜单隐藏', E.menu.classList.contains('hidden'));
  check('开局后 HUD 显示', !E.hud.classList.contains('hidden'));
  check('开局后虚拟按键显示', !E.pads.classList.contains('hidden'));
  g1.frame(230);
  check('倒计时结束进入对局后 HUD 仍显示', !E.hud.classList.contains('hidden'));
  check('计时格式 m:ss', /^\d+:\d{2}$/.test(E.timer.textContent), E.timer.textContent);
  check('≤4 分制时长行承诺 3 分钟', /3 分钟/.test(String(E.durationLine.textContent)));
  g1.frame(60);
  check('对局中比分为 0:0', String(E.score1.textContent) === '0' && String(E.score2.textContent) === '0');

  g1.key('KeyW'); g1.key('Space');
  let scored = false;
  g1.key('KeyD');
  for (let i = 0; i < 600 && !scored; i++) { g1.frame(1); scored = sum() >= 1; }
  g1.keyup('KeyD');
  g1.keyup('KeyW'); g1.keyup('Space');   // 全部抬起:后续暂停/恢复断言不再受持键随机得分干扰
  check('移动+碰撞可得分', scored);
  g1.frame(130);
  check('得分后回到对局(计时继续)', /^\d+:\d{2}$/.test(E.timer.textContent));

  const tFrozen = E.timer.textContent;
  g1.key('KeyP'); g1.frame(60);
  check('P 暂停后计时冻结', E.timer.textContent === tFrozen);
  g1.key('KeyP'); g1.frame(10);
  g1.blur(); g1.frame(60);
  check('失焦自动暂停(计时冻结)', E.timer.textContent === tFrozen);
  g1.key('KeyP'); g1.frame(10);
  g1.key('KeyP'); g1.frame(5);                    // 再暂停 → 验证点击画面恢复(触屏路径)
  const tPaused = E.timer.textContent;
  g1.pad('vk-w', 'pointerdown', 'touch', 21); g1.frame(10);
  check('暂停时点虚拟键不误恢复(计时仍冻结)', E.timer.textContent === tPaused);
  g1.ptr('pointerup', 21);
  g1.pad('game', 'pointerdown', 'touch', 3);
  g1.frame(90);   // 1.5s,确保跨过秒界
  check('暂停后点击画面恢复', E.timer.textContent !== tPaused, E.timer.textContent);

  g1.key('KeyR'); g1.frame(10);
  check('R 重开:比分清零回到倒计时', !E.hud.classList.contains('hidden')
    && String(E.score1.textContent) === '0' && /^\d+:\d{2}$/.test(E.timer.textContent));

  /* —— 虚拟按键:鼠标过滤 / 触控操控 / 多指·pen·取消 / 卡键释放 —— */
  g1.frame(230);                                  // 倒计时结束进入对局
  g1.pad('vk-w', 'pointerdown', 'mouse', 1); g1.frame(3);
  check('鼠标点虚拟键不写入(桌面仅显示)', !E['vk-w'].classList.contains('on'));
  const beforeTouch = sum();
  g1.pad('vk-d', 'pointerdown', 'touch', 7);
  g1.frame(3);
  check('触控按下即点亮', E['vk-d'].classList.contains('on'));
  for (let i = 0; i < 600 && sum() === beforeTouch && !overShown(); i++) g1.frame(1);
  check('触控操控可得分', sum() > beforeTouch);
  g1.ptr('pointerup', 7);                         // 全局 pointerup 释放(不回落元素亦可)
  g1.frame(3);
  check('触控抬起后熄灭', !E['vk-d'].classList.contains('on'));
  // 同键两指:一指抬起仍保持,两指全抬才熄灭
  g1.pad('vk-a', 'pointerdown', 'touch', 31); g1.pad('vk-a', 'pointerdown', 'touch', 32); g1.frame(3);
  g1.ptr('pointerup', 31); g1.frame(3);
  check('同键两指:先抬一指仍点亮', E['vk-a'].classList.contains('on'));
  g1.ptr('pointercancel', 32); g1.frame(3);
  check('同键两指:全抬后熄灭(pointercancel 通道)', !E['vk-a'].classList.contains('on'));
  // pen 路径 + 全局抬起兜底(pen 无隐式捕获的浏览器)
  g1.pad('vk-a', 'pointerdown', 'pen', 33); g1.frame(3);
  check('pen 写入操控', E['vk-a'].classList.contains('on'));
  g1.ptr('pointerup', 33); g1.frame(3);
  check('pen 全局抬起释放', !E['vk-a'].classList.contains('on'));
  // R 重开兜底释放(基准#4:startMatch 亦清触控)
  g1.pad('vk-s', 'pointerdown', 'touch', 34); g1.frame(3);
  g1.key('KeyR'); g1.frame(10);
  check('R 重开释放按住的触控键', !E['vk-s'].classList.contains('on'));
  g1.frame(230);                                  // 重回对局
  g1.frame(130);                                  // 得分横幅余量
  g1.pad('vk-right', 'pointerdown', 'touch', 9);  // 按住 P2 右键不放,直到结算验证卡键释放

  g1.frame(60 * 175);   // P2 持续右走出界 → 3 分结算;兜底常规时间耗尽 → 突然死亡 → 结算
  check('整局结束后结算层显示', overShown());
  check('胜者文案', /获胜!/.test(E.winText.textContent), E.winText.textContent);
  check('终局比分格式', /^\d+ : \d+$/.test(E.finalScore.textContent), E.finalScore.textContent);
  check('突然死亡分出胜负(总分≥1)', sum() >= 1);
  check('结算自动释放按住的触控键(防卡键)', !E['vk-right'].classList.contains('on'));
  check('结算隐藏虚拟按键', E.pads.classList.contains('hidden'));

  g1.click('btnScorePlus');   // 结算界面误触步进:场景守卫应拦截
  check('结算界面步进按钮不生效', String(E.winScoreVal.textContent) === '3');

  /* —— 结算:再来一局 / 返回菜单 —— */
  g1.key('Enter'); g1.frame(30);
  check('再来一局:结算隐藏比分归零', E.over.classList.contains('hidden')
    && String(E.score1.textContent) === '0' && !E.hud.classList.contains('hidden'));
  g1.frame(230);
  g1.click('btnScorePlus');   // 对局中误触步进:场景守卫应拦截
  check('对局中步进按钮不生效', String(E.winScoreVal.textContent) === '3');

  /* 默认 3 分制速胜 → 返回菜单 */
  let overs = false;
  for (let ev = 0; ev < 8 && !overs; ev++) { scoreOnce(); overs = overShown(); }
  check('默认 3 分制:3 分即结算', overs);
  g1.click('btnMenu');
  check('返回菜单:菜单显示/结算与 HUD 隐藏', !E.menu.classList.contains('hidden')
    && E.over.classList.contains('hidden') && E.hud.classList.contains('hidden'));

  /* —— 4 分制:恰在第 4 分结算 —— */
  g1.click('btnScorePlus');
  check('菜单改为 4 分制', String(E.winScoreVal.textContent) === '4');
  g1.click('btnStart'); g1.frame(240);
  let saw3 = false, over4 = false, leaderAtOver = -1;
  for (let ev = 0; ev < 12 && !over4; ev++) {
    scoreOnce();
    const [a, b] = sc();
    over4 = overShown();
    if (over4) leaderAtOver = Math.max(a, b);
    else if (Math.max(a, b) === 3) saw3 = true;
  }
  check('4 分制:领先 3 分时未结算', saw3);
  check('4 分制:第 4 分结算', over4 && leaderAtOver === 4, `over=${over4} leader=${leaderAtOver}`);
  check('4 分制对局后设定仍为 4', String(E.winScoreVal.textContent) === '4');

  /* —— 返回菜单清上局状态,改 9 分制实战验证计数 —— */
  g1.click('btnMenu');
  check('返回菜单后侧栏比分清零', String(E.score1.textContent) === '0' && String(E.score2.textContent) === '0');
  for (let i = 0; i < 5; i++) g1.click('btnScorePlus');
  check('菜单改为 9 分制', String(E.winScoreVal.textContent) === '9');
  g1.click('btnStart'); g1.frame(240);
  check('9 分制对局中计数显示 0 / 9', String(E.wincount1.textContent) === '0 / 9', E.wincount1.textContent);
  check('>4 分制时长行切换为 3 分半', /3 分半/.test(String(E.durationLine.textContent)));

  /* —— 全新加载复位默认 —— */
  let g2 = null, err2 = null;
  try { g2 = createGame(); } catch (e) { err2 = e; }
  check('全新加载复位默认 3 分', !err2 && g2 && String(g2.els.winScoreVal.textContent) === '3');
} catch (e) { runErr = e; }
check('全流程无运行时异常', !runErr, runErr && runErr.stack);

/* ---------- 4) 结果 ---------- */
if (failed) { console.error(`\n冒烟测试失败:${failed} 项`); process.exit(1); }
console.log('\n冒烟测试全部通过');
