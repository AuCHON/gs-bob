# AI 对抗 Review 报告:恭喜文案 + 虚拟按键 + 竖屏提示

- 日期：2026-09-24
- 触发改动：接续 `doc/reports/20260924-ai-report-rule-hint-glanceable.md`(PASS)的增量——用户三项需求:①"玩家 X 获胜!"前加"恭喜"并适当调整布局;②增加玩家虚拟按键显示(左 wasd/右方向键);③自主判断是否增加手机端方向旋转提示便于操控。改动文件(预计):`index.html`、`css/style.css`、`js/game.js`、`test/smoke.js`、`README.md`、本报告
- 基准 commit：a63aea3(源码基准=上一交付 PASS 时工作区)
- 状态：PASS
- 需求基准：用户任务描述 + 本报告"〇、增量基准"与阶段 A 裁定表
- 审查方式：requirement-adversary(增量) + implementation-adversary(只读,2 轮),主 Agent 汇总
- 自测基线：`npm test` 全绿,64 项断言(修复后 8/8 稳定 + 复审者 8 次 + Main Agent 终跑连续 3 次);无头截图 2 张已生成,图像分析服务当日不可用,视觉以几何推算+对抗推理复核,机器实测记为遗留

## 〇、增量基准(主 Agent 初拟,待对抗修正)

1. **恭喜文案**:结算界面改为两行——`恭喜!`(金色中号,字距发光,入场弹跳)在 `玩家 X 获胜!` 大字上方;胜负逻辑/winText 内容不变。
2. **虚拟按键双重用途**(对"显示"的解读:既是桌面输入监视器,也是触屏实际控制器):
   - 左下 P1 簇:W/A/S/D 键帽 + 通栏"空格"冲刺条;右下 P2 簇:↑/←/↓/→ + 通栏"回车"
   - 按下点亮:物理键盘与触控均点亮(共享 keys 状态,含 dash 条),队伍色发光(P1 红/P2 蓝)
   - 显隐:与 HUD 同步(菜单/结算隐藏,倒计时/对局/横幅显示)
3. **触控**:每个键 pointerdown/up/cancel/leave → 写 keys[code];touch-action:none + 禁长按菜单/选中;多点触控各键独立(HTML5 pointer events 天然支持);触控行为与物理键完全一致(含按住冲刺冷却后自动再冲,与物理键一致)
4. **竖屏提示(决策:做)**:理由——舞台 3:2 横版,竖屏下舞台宽仅 96vw≈窄条,底部双角按键簇将重叠平台区;横屏操控显著更佳。实现:`@media (orientation:portrait) and (pointer:coarse)` 显示底部提示卡(CSS 画旋转手机图标 + "横屏体验更佳" + "知道了"关闭,会话内不再出现),转横屏自动消失(纯 CSS 媒体查询驱动)。
5. **viewport**:加 `maximum-scale=1, user-scalable=no`(防双击/捏合缩放打断触控;a11y 代价在本地对战游戏场景可接受)。
6. **不做**:P/R 系统键不上虚拟按键(暂停/重开属键盘玩家;触屏玩家点 HUD 按钮属后续增量);竖屏不做强制锁定(仅提示不阻断)。
7. **README 同步**:操作说明补"触屏:画面左右下角虚拟按键(双人各控一角)"。

### 已记录不做(🟡)
- (待对抗后补)

## 一、需求对抗结论

### 阶段 A：增量需求对抗（只读子代理,2026-09-24）

统计:🔴×2 ｜ 🟠×7 ｜ 🟡×4,全部裁定处置如下:

| # | 严重度 | 问题 | 裁定（并入基准） |
| --- | --- | --- | --- |
| 1 | 🔴 | pointer 事件对鼠标同样触发——桌面点击=未授权输入面,与"桌面仅显示"矛盾 | **只认 touch/pen**:pad 写键前判 `e.pointerType==='touch'\|\|'pen'`;桌面 pads 纯监视(点亮由物理键驱动) |
| 2 | 🔴 | 纯触屏无法从暂停恢复(blur 自动暂停 + P 键专属)——切后台回来对局卡死 | **点击画面恢复**:canvas pointerdown 在 paused&&play 时恢复;暂停画面文案改"按 P 或点击画面继续" |
| 3 | 🟠 | "适当调整布局"零验收;over 层 360px 竖屏必裁切 | 验收量化:**360px 宽竖屏 over 层无裁切**;≤760px 紧凑化(字号/间距/按钮纵排) |
| 4 | 🟠 | pads 隐藏瞬间触控手指仍按住 → keys 卡死 true,下局自动移动 | gameOver/returnToMenu/startMatch 调 **releasePads()** 清触控键集;断言覆盖 |
| 5 | 🟠 | 滑动/并发语义未定义(隐式捕获、同键两指、物理+触控并发) | 语义:按压命中、滑动不切键(隐式捕获=手指离键仍保持至抬起);同键多指用**活跃指针计数**;物理与触控**合并(OR)**:physKeys + padPtrs 计数 → keys[code] 单一读面(玩法读取不变) |
| 6 | 🟠 | user-scalable=no iOS 失效;页面滚动未处理 | `html{touch-action:manipulation}`(灭双击缩放保滚动) + `#stage,#pads .vk{touch-action:none}`;viewport 缩放锁为附加防线(注明 iOS 失效) |
| 7 | 🟠 | "显隐与 HUD 同步"前提不真(gameOver 不隐藏 hud) | 显隐改绑**场景**:count/play/banner 显示;gameOver/returnToMenu 隐藏(并 releasePads);菜单初始隐藏 |
| 8 | 🟠 | 提示卡挂载层/z 序/关闭记忆未定义 | 挂 #stage 内、**z 序高于 overlay**(菜单首屏也要见)、底部居中浮卡(底边抬高避开双簇);"知道了"=JS 会话变量关闭;仅 portrait+coarse 显示,转横自动消失 |
| 9 | 🟠 | 零测试项,mock 缺 addEventListener 会直接崩 | mock 扩 addEventListener;断言:HTML pads 结构/aria、恭喜源顺序+banner 无恭喜、pointer(touch) 写键与点亮、mouse 过滤、场景显隐、卡键清理、点击恢复、CSS 契约(touch-action/portrait)、README 同步 |
| 10 | 🟡 | "恭喜"同行 vs 两行 | 两行式;验收=源顺序"恭喜!"先于 winText,winText 逐字不变 |
| 11 | 🟡 | 触控目标无尺寸下限 | 每键帽 ≥44×44px(桌面 46/移动 44);双簇与提示卡最小视口不互叠(卡抬高) |
| 12 | 🟡 | pads a11y;zoom 锁低视力代价 | `#pads aria-hidden="true"`(键盘为可达路径,pads 不入 a11y 树);缩放防线以 touch-action 为主 |
| 13 | 🟡 | README 未记触屏能力边界 | 同步:虚拟按键、点击恢复、P/R 键盘专属、竖屏提示行为 |

### 已记录不做(🟡)
- P/R 不上虚拟按键(点击画面恢复已覆盖暂停;触屏重开走结算按钮)。
- 竖屏仅提示不阻断;不做陀螺仪自动旋转。
- pads 不做滑动换键(隐式捕获语义,见 #5)。

## 二、实现对抗发现（第 1 轮,只读子代理;npm test 定向 8 次 + 内存探针定位）

| # | 严重度 | 维度 | 位置 | 问题 | 复现与证据 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 🔴 | 自动化测试 | test/smoke.js | "暂停后点击画面恢复"断言不稳定:8 次 5 败——KeyW/Space 按下未 keyup,持键随机得分在 90 帧窗口触发横幅冻结计时,文本差分失败;自测门"全绿"声明被证伪(前两次通过属侥幸);断言计数 56 实为 57 | 8 次运行 5 次 FAIL | 已修复(keyW/Space 用后即抬;修复后 8/8 稳定;计数以实际 grep 为准 64) |
| 2 | 🟠 | CSS 几何 | css rotateHint | bottom:128px 低于 pads 实际栈高(紧凑档 132/平板档 148),提示卡压住 W/↑ 键顶;且未设 pointer-events 吞结算按钮点击 | 数值推算 | 已修复(bottom 168px + 卡片 pointer-events:none + 仅关闭按钮可点 + 结算期 stage.ui-over 整卡让位) |
| 3 | 🟠 | 触控目标 | css vk-dash | 冲刺条高桌面 34px/移动 30px,违反裁定#11 ≥44px | 读 grid-template-rows | 已修复(两档均 44px) |
| 4 | 🟠 | 输入/异常 | js/game.js pads | pen 无隐式捕获(部分浏览器)→ 划出键外抬起 pointerup 不回落原元素 → padPtrs 残留整局卡键,R 重开也无法解除 | Safari/iPadOS 语义分析 | 已修复(全局 ptrCode 映射:pointerup/pointercancel/lostpointercapture 三通道按 pointerId 释放,不依赖事件回落) |
| 5 | 🟡 | 基准兑现 | js/game.js startMatch | 裁定#4 明文 startMatch 调 releasePads,实现未调(推演当前无可达缺陷,属验收未兑现) | 通读 | 已修复(startMatch 首行 releasePads) |
| 6 | 🟡 | CSS 几何 | css #over | 360×640 竖屏 over 层高度预算仅 ~7px 余量且无机器复核(图像服务不可用) | 数值推算 | 已压缩(gap 8/字号再降/按钮更紧,余量 ~25px;实测待图像服务恢复,记录在案) |
| 7 | 🟡 | 遮挡 | css pads | 360 竖屏 pads 占舞台下部约 63%(414px 机型约 55%),出生球被按键簇遮挡(基线已知未量化) | 几何推算 | 豁免(竖屏非推荐向,提示卡引导横屏;横屏/桌面推算干净;记录量化数据) |
| 8 | 🔵 | 死代码 | js/game.js startMatch | keys.Space/Enter=false 两行被 clearKey 完全覆盖,误导 | 读取 | 已修复(删除) |
| 9 | 🔵 | mock 局限 | test/smoke.js | addEventListener 同类型单值覆盖,第二个监听器静默丢弃 | 读取 | 已修复(数组共存,g.pad 逐个调用) |

另核实为净:物理键盘路径逐字等价(豁免分支/blur/R 瞬间)、padPtrs Set 双通道 delete 幂等、层叠 z30 推理成立、releasePads 在 score→gameOver 时序安全、无新增注入面。
测试盲区补齐:多指同键/pen 路径/pointercancel 通道/R 释放/暂停误恢复/rhClose 行为断言已加(64 项)。

## 三、自动化测试结果

| 用例 | 预期 | 实际 | 结论 |
| --- | --- | --- | --- |
| node --check js/game.js | 语法通过 | 通过 | ✅ |
| HTML/CSS/README 契约(结构/恭喜顺序/触控防线/竖屏查询等 9 项) | 通过 | 通过 | ✅ |
| 默认全流程 + 触控行为(点亮/得分/释放/防卡键/点击恢复等) | 通过 | 64 项全绿 | ✅ |
| 稳定性 | 连续多跑全绿 | 修复后 8/8 通过(修复前 3/8) | ✅ |

## 四、汇总判定

- 发现统计:🔴×1 ｜ 🟠×3 ｜ 🟡×3 ｜ 🔵×2(第 1 轮) + 第 2 轮新 🔵×2(竖屏提示卡与 HUD 视觉重叠边角[穿透可关闭不阻断,后续若动竖屏改 top 锚定]/#7 数值标签已校正);阶段 A 增量对抗 🔴×2 🟠×7 🟡×4 全部裁定落实
- 判定:✅ PASS(第 2 轮收窄复审:9 项修复全部落地无回归,全局指针释放被论证为 fail-safe,ui-over 生命周期全覆盖,兄弟元素事件路由推理成立;`npm test` 复审者 8 次 + Main Agent 终跑连续 3 次,64 项断言全绿)
- 修复责任:Main Agent(对抗审查者只读未写)
- 遗留:360×640 竖屏 over 层与提示卡视觉机器实测待图像分析服务恢复(几何推算余量 32px;边角重叠已记档)

## 五、复审记录（每轮追加——第 1 行为初审全量攻击，跨会话轮次从此表恢复）

| 轮次 | 本轮动作/修复摘要 | 复审结果 |
| --- | --- | --- |
| 1 | 初审(实现对抗):🔴×1 🟠×3 🟡×3 🔵×2;修复:断言抖动根因(持键未抬)、提示卡几何+穿透+结算让位、冲刺条 44px、全局指针映射根治 pen 卡键、startMatch 补 releasePads、over 层再压缩、死代码清理、mock 数组化;测试扩至 64 项,8/8 稳定 | 待第 2 轮收窄复审 |
| 2 | 收窄复审:9 项修复全部落地无回归(releasePointer 论证 fail-safe/ui-over 全覆盖/兄弟元素路由成立/CSS 数值复核);新 🔵×2(竖屏提示卡与 HUD 视觉重叠边角·不阻断、#7 数值标签已由 Main Agent 校正);`npm test` 8+3 次全绿 → PASS | PASS |