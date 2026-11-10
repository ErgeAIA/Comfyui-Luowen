// LuoWen 设置面板 i18n（DEC-042 补记 2，用户反馈 2026-11-08：双语不应拼接显示，语言要独立成文件+设置项）。
// 结构：LOCALES[zh|en] 平铺 key（<SettingId>.name / .tooltip / .opt.<value>）；t(key) 按当前语言取值，
// 语言来源 = LuoWen.Language 设置（auto=跟随宿主 Comfy.Locale）→ 每次渲染实时读取（设置项以 getter 暴露 name/tooltip/options）。
// 缺 key 回退 zh，再回退 key 本身。

const LOCALES = {
  zh: {
    'BrotherSpacing.name': '兄弟线间距',
    'BrotherSpacing.tooltip': '同一源端口分出的并行线路之间的间距（图坐标像素）。\n值越大并行线越分散。\n默认 12。',
    'Language.name': '界面语言',
    'Language.tooltip': '设置面板的显示语言。\n跟随宿主：按宿主语言设置自动选择。\n切换后重新打开设置面板或刷新页面生效。',
    'Language.opt.auto': '跟随宿主',
    'Language.opt.zh': '中文',
    'Language.opt.en': 'English',

    'Enabled.name': '启用络纹',
    'Enabled.tooltip': '总开关。\n关闭后完全回归 ComfyUI 原生线路绘制（F-001）。',
    'SnapAlign.name': '对齐吸附',
    'SnapAlign.tooltip': '拖动单个节点时，与相连邻居的引脚行按图坐标 10px 对齐吸附。\n离开 15px 才脱离。\n关闭后与未安装一致。',
    'WireStyle.name': '线路样式',
    'WireStyle.tooltip': 'orthogonal：A* 路由的正交折线。\nsmooth：同一骨架的平滑圆角。\native：ComfyUI 原生渲染。',
    'CornerRadius.name': '拐角曲线',
    'CornerRadius.tooltip': '只对 smooth 圆角样式生效。\n设定值即圆角半径上限，单位图坐标像素。\n实际半径取设定值与相邻短段三分之一中的较小值。\n0 为直角，最大 24。\northogonal 样式下此项无效。',
    'NodeAvoidance.name': '节点避障',
    'NodeAvoidance.tooltip': '线路绕开节点时的净空档位。\nlow 净空 8，standard 净空 16，high 净空 24。\n数值单位为图坐标像素。',
    'NodeAvoidance.opt.low': '低',
    'NodeAvoidance.opt.standard': '标准',
    'NodeAvoidance.opt.high': '高',
    'Chamfer.name': '绕障外角大斜切',
    'Chamfer.tooltip': '仅在正交样式下生效。\n只把为绕开第三方节点而形成的外凸直角切掉一大块。\n三通、分叉与引脚段保持直角。\n关闭后回到直角。\n与 smooth 圆角样式互斥。',
    'ColorTheme.name': '连线配色主题',
    'ColorTheme.tooltip': '按连线的数据类型着色（62 类语义映射）。\n暗色、Cyberpunk、夜灯三套主题均通过对比度与色盲 ΔE 门槛。\n夜灯为暖棕黑底、低蓝低眩光，取色源 ThemeVault erge #001。\n关闭时保持宿主原生配色。\n开启后同时同步节点槽点颜色（关闭/切换主题时还原宿主配色）。',
    'ColorTheme.opt.off': '关闭（原生）',
    'ColorTheme.opt.luowen-dark': '暗色（LuoWen Dark）',
    'ColorTheme.opt.luowen-cyberpunk': 'Cyberpunk',
    'ColorTheme.opt.luowen-nightlight': '夜灯（Night Light）',
    'ColorThemeScope.name': '主题范围',
    'ColorThemeScope.tooltip': '仅连线：只改连线描边，节点槽点保持宿主配色。\n连线+槽点：把 62 类类型色同步到节点槽点；关闭/切换主题时还原宿主配色。',
    'ColorThemeScope.opt.both': '连线 + 槽点',
    'ColorThemeScope.opt.links': '仅连线',


    'FlowAnim.name': '启用动效',
    'FlowAnim.tooltip': '动效总开关（默认关闭）。\n系统开启减少动态效果时自动改为实线。\n缩放不大于 40% 时自动关闭。',
    'AnimMode.name': '动效模式',
    'AnimMode.tooltip': '仅选中（推荐）：只动与选中节点相连的线，跟随关注焦点。\n仅执行中：只动与正在执行的节点相连的线，动=正在发生。\n全图（氛围）：空闲时也持续动，属装饰，不代表正在执行。\n空闲与无目标时循环自停、零开销。',
    'AnimMode.opt.selected': '仅选中（推荐）',
    'AnimMode.opt.executing': '仅执行中',
    'AnimMode.opt.all': '全图（氛围）',
    'FlowStyle.name': '动效线型',
    'FlowStyle.tooltip': '局部光脉冲（推荐）：一段有限长度的亮束沿连线行进，\n静止时连线保持实线，动=有事正在发生。\n虚线行进：虚线沿连线从源向目标移动（低耗方向档，参数见「动效·虚线」组）。\n旧版「发光/脉冲」线型已移除，保存值自动迁移为局部光脉冲。',
    'FlowStyle.opt.beam': '局部光脉冲',
    'FlowStyle.opt.dash': '虚线行进',
    'DashSpeed.name': '虚线·流速',
    'DashSpeed.tooltip': '虚线的行进速度，0–10 共 10 档。\n每档 30 屏幕像素/秒（已按缩放补偿，任何缩放下手感一致）。\n档位 10 = 300。只影响虚线行进线型。',
    'DashLen.name': '虚线·长度',
    'DashLen.tooltip': '虚线实线段的长度（屏幕像素）。只影响虚线行进线型。',
    'DashGap.name': '虚线·间距',
    'DashGap.tooltip': '虚线空隙的长度（屏幕像素）。只影响虚线行进线型。',
    'BeamSpeed.name': '光束·流速',
    'BeamSpeed.tooltip': '亮束的行进速度，0–10 共 10 档。\n每档 30 屏幕像素/秒（已按缩放补偿，任何缩放下手感一致）。\n只影响局部光脉冲线型。',
    'BeamLen.name': '光束·长度',
    'BeamLen.tooltip': '亮束的长度（屏幕像素）。只影响局部光脉冲线型。',
    'BeamSpacing.name': '光束·间距',
    'BeamSpacing.tooltip': '长连线上相邻亮束的间距（屏幕像素）。\n短于间距的连线保持单束。\n只影响局部光脉冲线型。',
    'DisableAnimOnRun.name': '生成时禁用动效',
    'DisableAnimOnRun.tooltip': '工作流运行期间暂停全部动效，结束后自动恢复。\n与宿主「禁用动画」开关独立；\n若想让「仅执行中」模式在运行时可视化数据流，请关闭本项。',
    'CrossCleanup.name': '离线交叉清理',
    'CrossCleanup.tooltip': '布局静止 400ms 后，\n只对存在垂直交叉的线路对做一次离线重解。\n交叉对数严格下降。\n参与线路总长增幅不超过 15% 时才采纳。\n否则保持原画面。\n默认关闭。',
    'AutoLayout.button': '⌁ 整理',
    'AutoLayout.full': '整理全图（流向）',
    'AutoLayout.selected': '整理选区（流向）',
    'AutoLayoutCollapse.name': '整理时折叠说明节点',
    'AutoLayoutCollapse.tooltip': '执行自动布局时，把 Note/Markdown 说明节点折叠为标题条（写入折叠标志与折叠高度）。\n默认关闭。\n一次整理 = 一条撤销记录，可整次恢复。',
    'AutoLayoutAlign.name': '整理时列内对齐',
    'AutoLayoutAlign.tooltip': '自动布局时，同一列（纵向排列）的节点如何对齐。\n自动（默认）：按流向逐列判定——多节点汇聚到一个节点（扇入）→ 右缘对齐；一个节点发散到多个节点（扇出）→ 左缘对齐，避免连线打架。\n右对齐/居中/左对齐：所有列统一成该对齐。\n仅在「整理」时生效。',
    'AutoLayoutAlign.opt.auto': '自动（按流向）',
    'AutoLayoutAlign.opt.right': '右对齐',
    'AutoLayoutAlign.opt.center': '居中',
    'AutoLayoutAlign.opt.left': '左对齐',
    'AutoLayoutGap.name': '整理时列内上下间距',
    'AutoLayoutGap.tooltip': '自动布局时，同一列内相邻节点之间的垂直间距（上节点底 → 下节点顶）。\n默认 40。\n节点较高或想让扇入/扇出更舒展时可调大。\n仅在「整理」时生效。',
    'AutoLayoutLayerGap.name': '整理时主链水平间距',
    'AutoLayoutLayerGap.tooltip': '自动布局时，主链相邻层（列）之间的水平净距。\n默认 60。\n入口多的节点所在层会自动加宽。\n调小可让主链更紧凑、调大更舒展。\n仅在「整理」时生效。',
    'AutoLayoutInlineGap.name': '整理时单进单出节点间距',
    'AutoLayoutInlineGap.tooltip': '自动布局时，主链上「1 进 1 出」过路节点（如采样算法、CFG 归一化）与上一段的水平间距。\n默认 50。\n比「主链水平间距」更小，让这类小节点并排压实、不占多余宽度。\n仅在「整理」时生效。',
    'AutoLayoutComponent.name': '多工作流排布',
    'AutoLayoutComponent.tooltip': '一个文件里有多个互不相连的工作流时，整理后各工作流之间如何排布。\n竖排（默认）：自上而下逐个排列。\n横排：自左向右逐个排列。\n仅在「整理」时生效。',
    'AutoLayoutComponent.opt.vertical': '竖排',
    'AutoLayoutComponent.opt.horizontal': '横排',
  },

  en: {
    'BrotherSpacing.name': 'Brother Line Spacing',
    'BrotherSpacing.tooltip': 'Spacing between parallel lines from the same source port (graph px).\nHigher values spread parallel lines further apart.\nDefault 12.',
    'Language.name': 'Language',
    'Language.tooltip': 'Display language of the LuoWen settings.\nFollow host: picks by the host language setting.\nReopen the settings panel or reload to apply.',
    'Language.opt.auto': 'Follow host',
    'Language.opt.zh': '中文',
    'Language.opt.en': 'English',

    'Enabled.name': 'Enable LuoWen',
    'Enabled.tooltip': 'Master switch.\nWhen off, fully falls back to ComfyUI native link rendering (F-001).',
    'SnapAlign.name': 'Align Snap',
    'SnapAlign.tooltip': 'While dragging a single node, its pin rows snap-align to connected neighbours within 10 graph px.\nReleases past 15 px.\nWhen off, behaves as if not installed.',
    'WireStyle.name': 'Wire Style',
    'WireStyle.tooltip': 'orthogonal: A*-routed orthogonal polylines.\nsmooth: rounded corners on the same skeleton.\nnative: ComfyUI native rendering.',
    'CornerRadius.name': 'Corner Radius',
    'CornerRadius.tooltip': 'Only applies to the smooth style.\nThe value is the corner-radius upper bound in graph px.\nEffective radius = min(value, 1/3 of each adjacent segment).\n0 = sharp corner, max 24.\nNo effect in the orthogonal style.',
    'NodeAvoidance.name': 'Node Avoidance',
    'NodeAvoidance.tooltip': 'Clearance tier when routes avoid nodes.\nlow = 8, standard = 16, high = 24 (graph px).',
    'NodeAvoidance.opt.low': 'Low',
    'NodeAvoidance.opt.standard': 'Standard',
    'NodeAvoidance.opt.high': 'High',
    'Chamfer.name': 'Chamfer',
    'Chamfer.tooltip': 'Orthogonal style only.\nCuts the large convex corners formed when routing around third-party nodes.\nT-junctions, forks and pin stubs stay square.\nOff = right angles.\nMutually exclusive with smooth rounding.',
    'ColorTheme.name': 'Color Theme',
    'ColorTheme.tooltip': 'Colors links by data type (62 semantic mappings).\nAll three themes pass the contrast and CVD ΔE gates.\nNight Light uses a warm brown-black base with low blue light (ThemeVault erge #001).\nOff = host native colors.\nWhen on, node slot dot colors sync too (host palette restored on off/switch).',
    'ColorTheme.opt.off': 'Off (native)',
    'ColorTheme.opt.luowen-dark': 'LuoWen Dark',
    'ColorTheme.opt.luowen-cyberpunk': 'Cyberpunk',
    'ColorTheme.opt.luowen-nightlight': 'Night Light',
    'ColorThemeScope.name': 'Theme Scope',
    'ColorThemeScope.tooltip': 'Links only: recolor link strokes, leave node slot dots on the host palette.\nLinks + slots: also sync all 62 type colors to node slot dots; host palette is restored on off/switch.',
    'ColorThemeScope.opt.both': 'Links + slots',
    'ColorThemeScope.opt.links': 'Links only',


    'FlowAnim.name': 'Flow Animation',
    'FlowAnim.tooltip': 'Animation master switch (default off).\nForces solid lines when the system prefers reduced motion.\nAuto-off below 40% zoom.',
    'AnimMode.name': 'Anim Mode',
    'AnimMode.tooltip': 'Selected (recommended): animate only links touching the selected nodes, following your focus.\nExecuting: animate only links touching the executing node — motion means it is happening.\nAll (ambient): keeps animating even when idle; decorative only, does NOT mean execution.\nThe loop self-stops when idle and costs nothing.',
    'AnimMode.opt.selected': 'Selected (recommended)',
    'AnimMode.opt.executing': 'Executing',
    'AnimMode.opt.all': 'All (ambient)',
    'FlowStyle.name': 'Line Style',
    'FlowStyle.tooltip': 'Light pulse (recommended): a finite bright beam travels along the link;\nat rest the link stays a solid line — motion means something is happening.\nDashes: dashes travel source→target (low-cost direction mode, see the Dash group).\nLegacy glow/pulse styles were removed; saved values migrate to light pulse automatically.',
    'FlowStyle.opt.beam': 'Light Pulse',
    'FlowStyle.opt.dash': 'Dashes',
    'DashSpeed.name': 'Dash Speed',
    'DashSpeed.tooltip': 'Dash travel speed, levels 0–10.\nEach level = 30 screen px/s (zoom-compensated, same feel at any zoom).\nLevel 10 = 300. Dashes style only.',
    'DashLen.name': 'Dash Length',
    'DashLen.tooltip': 'Length of the dash segment (screen px). Dashes style only.',
    'DashGap.name': 'Dash Gap',
    'DashGap.tooltip': 'Length of the gap between dashes (screen px). Dashes style only.',
    'BeamSpeed.name': 'Beam Speed',
    'BeamSpeed.tooltip': 'Beam travel speed, levels 0–10.\nEach level = 30 screen px/s (zoom-compensated, same feel at any zoom).\nLight pulse style only.',
    'BeamLen.name': 'Beam Length',
    'BeamLen.tooltip': 'Beam length (screen px). Light pulse style only.',
    'BeamSpacing.name': 'Beam Spacing',
    'BeamSpacing.tooltip': 'Spacing between beams on long links (screen px).\nLinks shorter than the spacing keep a single beam.\nLight pulse style only.',
    'DisableAnimOnRun.name': 'Pause on Run',
    'DisableAnimOnRun.tooltip': 'Pauses all animation while a workflow runs; resumes when it ends.\nIndependent of the host "Disable animations" switch.\nTurn this off if you want the Executing mode to visualize data flow during runs.',
    'CrossCleanup.name': 'Cross Cleanup',
    'CrossCleanup.tooltip': 'After the layout rests for 400ms,\nre-solves only crossing link pairs, offline.\nThe crossing-pair count must strictly decrease.\nAdopted only when total involved length grows ≤ 15%.\nOtherwise the original picture is kept.\nDefault off.',
    'AutoLayout.button': '⌁ Arrange',
    'AutoLayout.full': 'Arrange All (Flow)',
    'AutoLayout.selected': 'Arrange Selection (Flow)',
    'AutoLayoutCollapse.name': 'Collapse Notes on Layout',
    'AutoLayoutCollapse.tooltip': 'When running auto-layout, collapses Note/Markdown nodes to their title bar (writes the collapsed flag and height).\nDefault off.\nOne layout run = one undo entry; a single undo restores everything.',
    'AutoLayoutAlign.name': 'Column Alignment on Layout',
    'AutoLayoutAlign.tooltip': 'How nodes stacked in the same column align during auto-layout.\nAuto (default): per-column by flow — many nodes converging into one (fan-in) → right edges; one node fanning out to many (fan-out) → left edges, avoiding clashing links.\nRight/Center/Left: force that alignment on all columns.\nApplies on Arrange only.',
    'AutoLayoutAlign.opt.auto': 'Auto (by flow)',
    'AutoLayoutAlign.opt.right': 'Right',
    'AutoLayoutAlign.opt.center': 'Center',
    'AutoLayoutAlign.opt.left': 'Left',
    'AutoLayoutGap.name': 'Vertical Gap on Layout',
    'AutoLayoutGap.tooltip': 'Vertical gap between adjacent nodes in the same column during auto-layout (bottom of upper → top of lower).\nDefault 40.\nIncrease for tall nodes or airier fan-in/out.\nApplies on Arrange only.',
    'AutoLayoutLayerGap.name': 'Horizontal Gap on Layout',
    'AutoLayoutLayerGap.tooltip': 'Horizontal gap between adjacent layers (columns) on the main chain during auto-layout.\nDefault 60.\nLayers feeding many-input nodes widen automatically.\nLower = tighter main chain; higher = airier.\nApplies on Arrange only.',
    'AutoLayoutInlineGap.name': 'Inline Node Gap on Layout',
    'AutoLayoutInlineGap.tooltip': 'Horizontal gap before pass-through "1-in-1-out" nodes on the main chain (e.g. ModelSampling, CFG-normalize) during auto-layout.\nDefault 50.\nSmaller than the main horizontal gap, packing these small nodes inline instead of wasting width.\nApplies on Arrange only.',
    'AutoLayoutComponent.name': 'Multi-workflow Arrangement',
    'AutoLayoutComponent.tooltip': 'How disconnected workflows in one file are arranged after arranging.\nVertical (default): stacked top to bottom.\nHorizontal: placed left to right.\nApplies on Arrange only.',
    'AutoLayoutComponent.opt.vertical': 'Vertical',
    'AutoLayoutComponent.opt.horizontal': 'Horizontal',
  },
};

// 当前语言：读 LuoWen.Language 设置（zh/en 直取；auto=跟随宿主 Comfy.Locale，读不到时回退中文）。
// 每次渲染实时解析——设置项的 name/tooltip/options 以 getter 暴露，切语言后重开面板即生效。
function currentLang() {
  let pref = 'auto';
  try {
    pref = window.comfyAPI?.app?.app?.ui?.settings?.getSettingValue?.('LuoWen.Language') ?? 'auto';
  } catch {
    pref = 'auto';
  }
  if (pref === 'zh' || pref === 'en') return pref;
  try {
    const loc = window.comfyAPI?.app?.app?.ui?.settings?.getSettingValue?.('Comfy.Locale');
    if (loc && !String(loc).toLowerCase().startsWith('zh')) return 'en';
  } catch { /* 读不到宿主语言时按中文 */ }
  return 'zh';
}

// 取串：当前语言 → 缺失回退中文 → 再缺失回退 key 本身（便于发现漏翻）
export function t(key) {
  const lang = currentLang();
  return LOCALES[lang]?.[key] ?? LOCALES.zh[key] ?? key;
}

// 调试/验收：当前生效语言与字典规模
export function i18nDebug() {
  const lang = currentLang();
  return { lang, zhKeys: Object.keys(LOCALES.zh).length, enKeys: Object.keys(LOCALES.en).length };
}
