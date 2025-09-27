const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, Modal, ItemView } = require('obsidian');

// 四象限标题（二级标题）
const QUADRANTS = [
  { heading: '## 重要且紧急', key: 'IU' },
  { heading: '## 重要不紧急', key: 'IN' },
  { heading: '## 不重要且紧急', key: 'NU' },
  { heading: '## 不重要不紧急', key: 'NN' },
];
const ARCHIVE_HEADING = '## 归档';

// 默认设置
const DEFAULT_SETTINGS = {
  mySetting: 'default',
  autoArchiveOnCheck: true, // 勾选后自动移动到“归档”
  preferBoardView: false,   // 使用看板视图模式
  maxArchiveItems: 500,     // 归档记录上限（可配置）
  maxQuadrantItems: 50,     // 四象限每栏记录上限（可配置）
};

module.exports = class FourGridsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // 注册自定义看板视图（four-grids-board）
    this.registerView('four-grids-board', (leaf) => new FourGridsBoardView(leaf, this));

    // 初始化四象限模板命令
    this.addCommand({
      id: 'ob-four-grids-init-template',
      name: '初始化四象限清单模板',
      callback: () => this.initQuadrantTemplateOnActive(),
    });

    // 快速添加到四象限的命令（打开弹窗）
    this.addCommand({
      id: 'ob-four-grids-quick-add',
      name: '快速添加任务到四象限',
      callback: () => new QuickAddModal(this.app, this).open(),
    });

    // 独立命令：直接添加到各象限
    this.addCommand({ id: 'ob-four-grids-add-IU', name: '快速添加到：重要且紧急', callback: () => new QuickAddModal(this.app, this, 'IU').open() });
    this.addCommand({ id: 'ob-four-grids-add-IN', name: '快速添加到：重要不紧急', callback: () => new QuickAddModal(this.app, this, 'IN').open() });
    this.addCommand({ id: 'ob-four-grids-add-NU', name: '快速添加到：不重要且紧急', callback: () => new QuickAddModal(this.app, this, 'NU').open() });
    this.addCommand({ id: 'ob-four-grids-add-NN', name: '快速添加到：不重要不紧急', callback: () => new QuickAddModal(this.app, this, 'NN').open() });

    // Ribbon：根据设置开关，优先打开看板或快速添加
    const plugin = this;
    this.addRibbonIcon('layout', plugin.settings.preferBoardView ? '打开四象限看板' : '快速添加任务到四象限', () => {
      if (plugin.settings.preferBoardView) plugin.openBoardForActiveFile();
      else new QuickAddModal(plugin.app, plugin).open();
    });

    // 状态栏
    const status = this.addStatusBarItem();
    status.addClass('ob-four-grids-status');
    status.setText('ob-four-grids ready');

    // 调试日志，确认当前加载到的插件版本与方法可用性
    console.log('ob-four-grids onload', {
      hasRegisterKanbanIntegration: typeof this.registerKanbanIntegration,
    });

    // 集成 Kanban 视图：监听卡片复选框变更，触发跨列移动（通过修改底层 Markdown）
    if (typeof this.registerKanbanIntegration === 'function') {
      this.registerKanbanIntegration();
    } else {
      console.error('[ob-four-grids] registerKanbanIntegration is not a function — 请确认 main.js 已更新且被正确加载');
    }

    // 自动归档：监听文件修改，移除四象限中已勾选的条目并移动到“归档”；归档勾选则返回原象限
    this.isProcessing = false;
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!this.settings.autoArchiveOnCheck) return;
        if (this.isProcessing) return;
        if (!file || file.extension !== 'md') return;
        try {
          const content = await this.app.vault.read(file);
          // 仅在包含四象限或 Kanban frontmatter 的文件上处理
          if (!containsQuadrantsOrArchive(content) && !hasKanbanFrontmatter(content)) return;
          let processed = moveCheckedInQuadrantsToArchive(content);
          processed = postProcess(processed, this.settings);
          if (processed !== content) {
            this.isProcessing = true;
            await this.app.vault.modify(file, processed);
            this.isProcessing = false;
          }
        } catch (e) {
          console.error(e);
          this.isProcessing = false;
        }
      })
    );

    // 设置面板
    this.addSettingTab(new FourGridsSettingTab(this.app, this));
  }

  onunload() {
    // 卸载自定义视图，避免出现“创建此标签的插件不再活动”提示
    this.app.workspace.detachLeavesOfType('four-grids-board');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // 打开当前笔记的看板视图（不依赖 Kanban 插件）
  openBoardForActiveFile() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice('请在一个 Markdown 笔记中运行该命令');
      return;
    }

    // 1) 如果同一文件的看板标签已存在，直接切换过去
    const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType('four-grids-board') : [];
    for (const leaf of leaves) {
      const v = leaf.view;
      if (v && v.file && v.file.path === file.path) {
        this.app.workspace.revealLeaf(leaf);
        return;
      }
    }

    // 2) 若已有其他看板标签，则复用其中一个并切换到当前文件
    if (leaves && leaves.length > 0) {
      const leaf = leaves[0];
      leaf.setViewState({ type: 'four-grids-board', state: { file: file.path } });
      this.app.workspace.revealLeaf(leaf);
      return;
    }

    // 3) 否则创建新的看板标签
    const leaf = this.app.workspace.getLeaf(true);
    leaf.setViewState({ type: 'four-grids-board', state: { file: file.path } });
    this.app.workspace.revealLeaf(leaf);
  }

  initQuadrantTemplateOnActive() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('请在一个 Markdown 笔记中运行该命令');
      return;
    }
    const editor = view.editor;
    const content = editor.getValue();
    const updated = ensureQuadrantSections(content);
    if (updated !== content) {
      editor.setValue(updated);
      new Notice('已初始化四象限清单模板');
    } else {
      // 若没有归档则补齐归档
      const withArchive = ensureArchiveSection(updated);
      if (withArchive !== updated) {
        editor.setValue(withArchive);
        new Notice('已补充“归档”段落');
      } else {
        new Notice('四象限清单已存在');
      }
    }
  }

  addTaskToQuadrantInActive(key, taskText) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('请在一个 Markdown 笔记中运行该命令');
      return;
    }
    const editor = view.editor;
    const content = ensureArchiveSection(ensureQuadrantSections(editor.getValue()));

    const lines = content.split(/\r?\n/);
    const heading = QUADRANTS.find(q => q.key === key)?.heading;
    if (!heading) {
      new Notice('未知象限');
      return;
    }

    // 找到插入位置（该象限的末尾）
    const idxHeading = lines.findIndex(l => l.trim() === heading.trim());
    if (idxHeading === -1) {
      // 不存在则追加该象限
      const appended = content.trim() + `\n\n${heading}\n- [ ] ${taskText}\n`;
      editor.setValue(appended);
      new Notice('已添加任务到象限（自动补齐）');
      return;
    }
    const idxNextHeading = findNextHeadingIndex(lines, idxHeading);
    const insertIdx = idxNextHeading === -1 ? lines.length : idxNextHeading; // 在该象限区域末尾插入

    // 在插入位置前插入任务，仅在需要时补一个空行分隔（避免标题下出现多余空白）
    const before = lines.slice(0, insertIdx);
    const after = lines.slice(insertIdx);
    const prev = before.length ? before[before.length - 1] : '';
    const isPrevHeading = prev && prev.trim() === heading.trim();
    const isPrevList = /^\s*[-*]\s+/.test(prev || '');
    // 如果标题下一行是空行，先移除该空行，避免生成“标题 + 空行 + 列表”
    const prevIsBlank = !(prev && prev.trim().length);
    const prev2 = before.length >= 2 ? before[before.length - 2] : '';
    if (prevIsBlank && prev2 && prev2.trim() === heading.trim()) {
      before.pop();
    }
    const needSpacer = false; // 不再插入分隔空行
    before.push(`- [ ] ${taskText}`);
    const newText = [...before, ...after].join('\n');
    const out = postProcess(newText, this.settings);
    editor.setValue(out);
    new Notice('已添加任务');
  }

  // 监听 Kanban 视图中的复选框变化，触发跨列移动（通过修改底层 Markdown 文件）
  registerKanbanIntegration() {
    this._kanbanBound = this._kanbanBound || new WeakSet();
    const bindView = (view) => {
      if (!view || typeof view.getViewType !== 'function') return;
      if (view.getViewType() !== 'kanban') return;
      const el = view.containerEl;
      if (!el || this._kanbanBound.has(el)) return;
      const handler = async (evt) => {
        const t = evt.target;
        if (!t || !(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;
        const file = view.file;
        if (!file) return;
        try {
          const content = await this.app.vault.read(file);
          let processed = moveCheckedInQuadrantsToArchive(content);
          processed = postProcess(processed, this.settings);
          if (processed !== content) {
            this.isProcessing = true;
            await this.app.vault.modify(file, processed);
            this.isProcessing = false;
          }
        } catch (e) {
          console.error(e);
          this.isProcessing = false;
        }
      };
      // 捕获阶段监听 change，尽量在 Kanban 内部处理之前拿到事件
      this.registerDomEvent(el, 'change', handler, true);
      this._kanbanBound.add(el);
    };

    // 绑定当前已有的 Kanban 视图
    const leaves = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType('kanban') : [];
    for (const leaf of leaves) {
      if (leaf.view) bindView(leaf.view);
    }

    // 绑定后续打开或布局变化出现的 Kanban 视图
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf && leaf.view) bindView(leaf.view);
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      const leaves2 = this.app.workspace.getLeavesOfType ? this.app.workspace.getLeavesOfType('kanban') : [];
      for (const leaf of leaves2) {
        if (leaf.view) bindView(leaf.view);
      }
    }));
  }
};

// 生成/补齐四象限模板（不含归档）
function ensureQuadrantSections(text) {
  let result = text;
  const hasAny = QUADRANTS.some(q => result.includes(q.heading));
  const template = '\n' + QUADRANTS.map(q => `${q.heading}\n- [ ] 在此添加任务`).join('\n\n') + '\n';
  if (!hasAny) {
    result = (result.trim().length ? result.trim() + '\n\n' : '') + template;
    return result;
  }
  const missing = QUADRANTS.filter(q => !result.includes(q.heading));
  if (missing.length > 0) {
    result = result.trim() + '\n\n' + missing.map(q => `${q.heading}\n- [ ] 在此添加任务`).join('\n\n') + '\n';
  }
  return result;
}

// 确保存在“归档”段落
function ensureArchiveSection(text) {
  if (text.includes(ARCHIVE_HEADING)) return text;
  const appended = (text.trim().length ? text.trim() + '\n\n' : '') + `${ARCHIVE_HEADING}\n`;
  return appended;
}

// 检测文件是否包含四象限标题或归档
function containsQuadrantsOrArchive(text) {
  return QUADRANTS.some(q => text.includes(q.heading)) || text.includes(ARCHIVE_HEADING);
}

// 检测 Kanban frontmatter 标记
function hasKanbanFrontmatter(text) {
  return /^---[\s\S]*?kanban-plugin:/m.test(text);
}

// 移动四象限中的已勾选任务到“归档”，以及从归档勾选后返回原象限
function moveCheckedInQuadrantsToArchive(text) {
  // 双向处理：
  // 1) 象限内 [x] -> 移动到归档为未勾选，并追加来源与日期。
  // 2) 归档内 [x] 且带来源标签 -> 移回对应象限为未勾选。
  let working = ensureArchiveSection(text);
  let lines = working.split(/\r?\n/);

  // 收集象限与归档位置
  const headingPos = new Map();
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const q = QUADRANTS.find(q => t === q.heading.trim());
    if (q) headingPos.set(q.key, i);
    if (t === ARCHIVE_HEADING.trim()) headingPos.set('ARCHIVE', i);
  }
  if (!headingPos.size) return working;

  // 计算各段落范围
  const ordered = Array.from(headingPos.entries()).sort((a, b) => a[1] - b[1]);
  const ranges = [];
  for (let i = 0; i < ordered.length; i++) {
    const [key, start] = ordered[i];
    const end = i < ordered.length - 1 ? ordered[i + 1][1] - 1 : lines.length - 1;
    ranges.push({ key, start, end });
  }

  const isCheckedTask = (s) => /^\s*[-*]\s+\[(x|X)\]\s+.+$/.test(s);
  const extractTaskText = (s) => (s || '').replace(/^\s*[-*]\s+\[(x|X)\]\s+/, '');
  const formatDate = (d) => {
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const displayLabelOfKey = (key) => {
    const q = QUADRANTS.find(q => q.key === key);
    return q ? q.heading.replace(/^#+\s*/, '').trim() : key;
  };
  const keyFromLabel = (label) => {
    const q = QUADRANTS.find(q => q.heading.replace(/^#+\s*/, '').trim() === label.trim());
    return q ? q.key : undefined;
  };

  // 1) 从各象限移动到归档
  const toArchive = [];
  for (const r of ranges) {
    if (r.key === 'ARCHIVE') continue;
    for (let i = r.start + 1; i <= r.end; i++) {
      const line = lines[i];
      if (isCheckedTask(line)) {
        const textOnly = extractTaskText(line).trim();
        const label = displayLabelOfKey(r.key);
        const dated = `- [x] ${textOnly} (from ${label} @ ${formatDate(new Date())})`;
        toArchive.push(dated);
        lines[i] = '';
      }
    }
  }

  // 2) 从归档移回原象限（当归档中的条目被勾选）
  const returnsByKey = new Map();
  const archiveRange = ranges.find(r => r.key === 'ARCHIVE');
  if (archiveRange) {
    for (let i = archiveRange.start + 1; i <= archiveRange.end; i++) {
      const line = lines[i];
      // 匹配：- [x] 任务内容 (from 标签 @ YYYY-MM-DD)
      const m = line && line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s+\(from\s+(.+?)\s+@\s+(\d{4}-\d{2}-\d{2})\)\s*$/);
      if (m) {
        const taskText = m[1];
        const label = m[2];
        const key = keyFromLabel(label);
        if (key) {
          if (!returnsByKey.has(key)) returnsByKey.set(key, []);
          returnsByKey.get(key).push(`- [ ] ${taskText}`); // 回到原象限为未勾选
          lines[i] = '';
        }
      }
    }
  }

  // 基础清理（删除空行冗余）
  const cleanedBase = lines
    .filter((l, idx, arr) => {
      if (!l || !l.trim()) {
        const prev = idx > 0 ? arr[idx - 1] : null;
        if (!prev || !prev.trim()) return false; // 连续空行去掉
        const prevTrim = prev ? prev.trim() : '';
        if (/^#+\s+/.test(prevTrim)) return false; // 紧挨标题的空行去掉
        if (/^[-*]\s+\[( |x|X)\]\s+/.test(prevTrim)) return false; // 紧挨任务行的空行去掉（避免移动后出现空白）
        return true; // 仅在段落等场景保留空行
      }
      return true;
    })
    .join('\n');

  // 将归档项插入到归档段落
  let result = insertLinesAtHeading(cleanedBase, ARCHIVE_HEADING, toArchive);
  // 将返回项插入对应象限
  for (const [key, items] of returnsByKey.entries()) {
    const heading = QUADRANTS.find(q => q.key === key)?.heading || `## ${key}`;
    result = insertLinesAtHeading(result, heading, items);
  }

  return normalizeSpacing(result);
}

function findNextHeadingIndex(lines, fromIdx) {
  for (let i = fromIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('#')) return i; // 任意 Markdown 标题视为区块分隔
  }
  return -1;
}

// 在某个标题段落末尾插入多行列表项；若标题不存在则追加该段落
function insertLinesAtHeading(text, heading, listLines) {
  if (!listLines || listLines.length === 0) return text;
  const lines = text.split(/\r?\n/);
  let idxHeading = lines.findIndex(l => l.trim() === heading.trim());
  if (idxHeading === -1) {
    // 追加段落
    const appendix = [''].concat([heading, ...listLines]).join('\n');
    return text.trim().length ? text + '\n' + appendix + '\n' : appendix + '\n';
  }
  const idxNext = findNextHeadingIndex(lines, idxHeading);
  const insertIdx = idxNext === -1 ? lines.length : idxNext;
  const before = lines.slice(0, insertIdx);
  const after = lines.slice(insertIdx);
  const prev = before.length ? before[before.length - 1] : '';
  const isPrevHeading = prev && prev.trim() === heading.trim();
  const isPrevList = /^\s*[-*]\s+/.test(prev || '');
  // 如果标题下一行是空行，先移除该空行
  const prevIsBlank = !(prev && prev.trim().length);
  const prev2 = before.length >= 2 ? before[before.length - 2] : '';
  if (prevIsBlank && prev2 && prev2.trim() === heading.trim()) {
    before.pop();
  }
  const needSpacer = false; // 不再插入分隔空行
  for (const it of listLines) before.push(it);
  return [...before, ...after].join('\n');
}

// 将某个标题下的任务条目裁剪到最多 maxItems（保留最新的 maxItems）
function capSectionItems(text, heading, maxItems) {
  if (!maxItems || maxItems <= 0) return text;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim() === heading.trim());
  if (start === -1) return text;
  let end = findNextHeadingIndex(lines, start);
  if (end === -1) end = lines.length;
  const taskIdxs = [];
  for (let i = start + 1; i < end; i++) {
    if (/^\s*[-*]\s+\[( |x|X)\]\s+.+$/.test(lines[i])) {
      taskIdxs.push(i);
    }
  }
  if (taskIdxs.length <= maxItems) return text;
  const toRemove = taskIdxs.slice(0, taskIdxs.length - maxItems);
  for (const idx of toRemove) {
    lines[idx] = '';
  }
  const cleaned = lines
    .filter((l, idx, arr) => {
      if (!l || !l.trim()) {
        const prev = idx > 0 ? arr[idx - 1] : null;
        return prev && prev.trim();
      }
      return true;
    })
    .join('\n');
  return cleaned;
}

// 根据设置对四象限与归档进行整体裁剪
function capAllSections(text, settings) {
  let out = text;
  for (const q of QUADRANTS) {
    out = capSectionItems(out, q.heading, settings?.maxQuadrantItems || DEFAULT_SETTINGS.maxQuadrantItems);
  }
  out = capSectionItems(out, ARCHIVE_HEADING, settings?.maxArchiveItems || DEFAULT_SETTINGS.maxArchiveItems);
  return out;
}

// 规范化间距：
//  - 删除所有象限/归档标题后的空白行
//  - 折叠连续空白行为 0 或 1 行
function normalizeSpacing(text) {
  const lines = text.split(/\r?\n/);
  const headingSet = new Set([ARCHIVE_HEADING.trim(), ...QUADRANTS.map(q=>q.heading.trim())]);
  const out = [];
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    if (headingSet.has((line || '').trim())) {
      out.push(line);
      // 跳过标题后紧邻的所有空白行
      let j = i + 1;
      while (j < lines.length && (!lines[j] || !lines[j].trim())) j++;
      i = j - 1;
      continue;
    }
    if (!line || !line.trim()) {
      if (out.length === 0 || !out[out.length-1].trim()) continue; // 折叠连续空白
    }
    out.push(line);
  }
  return out.join('\n');
}

// 按固定顺序重排章节：IU -> IN -> NU -> NN -> ARCHIVE
function reorderSections(text) {
  const order = [
    QUADRANTS[0].heading.trim(), // 重要且紧急
    QUADRANTS[1].heading.trim(), // 重要不紧急
    QUADRANTS[2].heading.trim(), // 不重要且紧急
    QUADRANTS[3].heading.trim(), // 不重要不紧急
    ARCHIVE_HEADING.trim(),
  ];
  const lines = text.split(/\r?\n/);
  // 收集现有所有章节块
  const blocks = new Map();
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] || '').trim();
    if (order.includes(t)) {
      const start = i;
      let end = findNextHeadingIndex(lines, start);
      if (end === -1) end = lines.length;
      blocks.set(t, lines.slice(start, end).join('\n').trimEnd());
      i = end - 1;
    }
  }
  // 以固定顺序重新拼接；若缺失则补一个空段落（仅标题，不加占位任务）
  const out = [];
  for (const h of order) {
    if (blocks.has(h)) out.push(blocks.get(h));
    else out.push(h); // 缺失则补标题
  }
  return out.join('\n\n');
}

// 统一写回前的后处理：重排 -> 裁剪 -> 规范空白
function postProcess(text, settings) {
  let out = text;
  out = reorderSections(out);
  out = capAllSections(out, settings);
  out = normalizeSpacing(out);
  return out;
}

// 看板视图实现（不依赖 Kanban 插件）
class FourGridsBoardView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
  }
  getViewType() { return 'four-grids-board'; }
  getDisplayText() { return (this.file?.basename ? `${this.file.basename} 看板` : '四象限看板'); }
  getIcon() { return 'layout'; }

  async setState(state) {
    const file = this.app.vault.getAbstractFileByPath(state?.file);
    this.file = file && file.extension === 'md' ? file : null;
    await this.render();
  }

  async onOpen() {
    await this.render();
    // 监听当前文件修改，自动刷新
    this._unsub = this.app.vault.on('modify', async (file) => {
      if (this.file && file && file.path === this.file.path) {
        await this.render();
      }
    });
  }

  onClose() {
    if (this._unsub) this.app.vault.offref(this._unsub);
    this._unsub = null;
  }

  async render() {
    const container = this.containerEl.children[1] || this.containerEl;
    container.empty();
    const wrap = container.createDiv({ cls: 'four-grids-board' });
    const grid = wrap.createDiv({ cls: 'four-grids-board__grid' });

    if (!this.file) {
      grid.createEl('p', { text: '未绑定 Markdown 文件。请从命令面板在笔记中打开看板视图。' });
      return;
    }

    const content = await this.app.vault.read(this.file);
    const data = parseQuadrantData(content);

    const sections = [
      { key: 'IU', title: '重要且紧急' },
      { key: 'IN', title: '重要不紧急' },
      { key: 'NU', title: '不重要且紧急' },
      { key: 'NN', title: '不重要不紧急' },
      { key: 'ARCHIVE', title: '归档' },
    ];

    for (const sec of sections) {
      const col = grid.createDiv({ cls: `four-grids-board__col four-grids-board__col--${sec.key}` });
      // 列本身不滚动，仅列表滚动，固定标题与添加行
      col.style.display = 'flex';
      col.style.flexDirection = 'column';
      col.style.overflow = 'hidden';
      col.createEl('h3', { text: sec.title });

      // 快速添加（除归档外）
      if (sec.key !== 'ARCHIVE') {
        const addRow = col.createDiv({ cls: 'four-grids-board__add' });
        const input = addRow.createEl('input', { type: 'text' });
        input.placeholder = '输入任务内容';
        const btn = addRow.createEl('button', { text: '添加' });
        btn.onclick = async () => {
          const text = input.value.trim();
          if (!text) { new Notice('请输入任务内容'); return; }
          // 直接调用插件的添加到象限逻辑
          const editorView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!editorView || !editorView.file || editorView.file.path !== this.file.path) {
            // 不是当前活动文件，直接改底层文件
          let updated = addTaskLineToSection(await this.app.vault.read(this.file), QUADRANTS.find(q=>q.key===sec.key)?.heading, text);
          updated = postProcess(updated, this.plugin.settings);
          await this.app.vault.modify(this.file, updated);
          } else {
            this.plugin.addTaskToQuadrantInActive(sec.key, text);
          }
          input.value = '';
          await this.render();
        };
      }

      const list = col.createEl('ul', { cls: 'four-grids-board__list' });
      // 只滚动列表区域
      list.style.flex = '1 1 auto';
      list.style.overflow = 'auto';
      const items = data[sec.key] || [];
      const limit = sec.key === 'ARCHIVE' ? this.plugin.settings.maxArchiveItems : this.plugin.settings.maxQuadrantItems;
      const itemsLimited = limit && items.length > limit ? items.slice(-limit) : items;
      for (const it of itemsLimited) {
        const li = list.createEl('li', { cls: 'four-grids-board__item' });
        const textSpan = li.createEl('span', { text: it.text });
        const btnRow = li.createDiv({ cls: 'four-grids-board__actions' });

        if (sec.key === 'ARCHIVE') {
          // 从归档“还原”回原象限
          const restoreBtn = btnRow.createEl('button', { text: '还原' });
          restoreBtn.onclick = async () => {
            const marked = markArchiveItemChecked(content, it.raw);
            let processed = moveCheckedInQuadrantsToArchive(marked);
            processed = postProcess(processed, this.plugin.settings);
            await this.app.vault.modify(this.file, processed);
            await this.render();
          };
        } else {
          // 勾选归档（动作）
          const archiveBtn = btnRow.createEl('button', { text: '归档' });
          archiveBtn.onclick = async () => {
            const marked = markTaskCheckedInSection(content, QUADRANTS.find(q=>q.key===sec.key)?.heading, it.text);
            let processed = moveCheckedInQuadrantsToArchive(marked);
            processed = postProcess(processed, this.plugin.settings);
            await this.app.vault.modify(this.file, processed);
            await this.render();
          };
        }
      }
    }
  }
}

// 解析四象限与归档数据
function parseQuadrantData(text) {
  const lines = text.split(/\r?\n/);
  const sections = { IU: [], IN: [], NU: [], NN: [], ARCHIVE: [] };
  const mapHeadingToKey = (line) => {
    const t = line.trim();
    const q = QUADRANTS.find(q => t === q.heading.trim());
    if (q) return q.key;
    if (t === ARCHIVE_HEADING.trim()) return 'ARCHIVE';
    return null;
  };

  // 预编译正则，避免每次循环创建
  const taskLineRe = new RegExp('^\\s*[-*]\\s+\\[( |x|X)\\]\\s+(.+)$');
  const fromTagRe = new RegExp('\\s*\\(from\\s+.+?\\s+@\\s+\\d{4}-\\d{2}-\\d{2}\\)\\s*$');

  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const key = mapHeadingToKey(lines[i]);
    if (key) { cur = key; continue; }
    if (!cur) continue;

    const m = taskLineRe.exec(lines[i]);
    if (m) {
      const checked = m[1].toLowerCase() === 'x';
      const textOnly = m[2].replace(fromTagRe, '').trim();
      sections[cur].push({ raw: lines[i], text: textOnly, checked });
    }
  }
  return sections;
}

// 在指定象限段落中将首个匹配的未勾选任务标记为已勾选
function markTaskCheckedInSection(text, heading, taskText){
  const lines = text.split(/\r?\n/);
  let start = lines.findIndex(l=> l.trim()===heading.trim());
  if (start===-1) return text;
  let end = findNextHeadingIndex(lines, start);
  if (end===-1) end = lines.length;
  
  const uncheckedRe = new RegExp('^\\s*[-*]\\s+\\[ \\]\\s+(.+)$');

  for (let i = start + 1; i < end; i++) {
    const m = uncheckedRe.exec(lines[i]);
    if (m) {
      const body = m[1].trim();
      if (body === taskText.trim()) {
        lines[i] = lines[i].replace('[ ]', '[x]');
        break;
      }
    }
  }
  return lines.join('\n');
}

// 在归档段落中将某条目标记为已勾选（用于还原）
function markArchiveItemChecked(text, rawLine){
  const lines = text.split(/\r?\n/);
  for (let i=0;i<lines.length;i++){
    if (lines[i].trim()===rawLine.trim()){
      lines[i] = lines[i].replace('[x]','[ ]').replace('[X]','[ ]');
      break;
    }
  }
  return lines.join('\n');
}

// 直接向某象限追加一条未勾选任务
function addTaskLineToSection(text, heading, taskText){
  const lines = text.split(/\r?\n/);
  let idx = lines.findIndex(l=> l.trim()===heading.trim());
  if (idx===-1){
    return (text.trim()? text.trim()+"\n\n": '') + `${heading}\n- [ ] ${taskText}\n`;
  }
  let nxt = findNextHeadingIndex(lines, idx);
  if (nxt===-1) nxt = lines.length;
  const before = lines.slice(0, nxt);
  const after = lines.slice(nxt);
  const prev = before.length ? before[before.length-1] : '';
  const isPrevHeading = prev && prev.trim() === heading.trim();
  const isPrevList = /^\s*[-*]\s+/.test(prev || '');
  // 如果标题下一行是空行，先移除该空行
  const prevIsBlank = !(prev && prev.trim().length);
  const prev2 = before.length >= 2 ? before[before.length - 2] : '';
  if (prevIsBlank && prev2 && prev2.trim() === heading.trim()) {
    before.pop();
  }
  const needSpacer = false; // 不再插入分隔空行
  before.push(`- [ ] ${taskText}`);
  return [...before, ...after].join('\n');
}

// 设置面板
class FourGridsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h3', { text: '四象限清单设置' });

    new Setting(containerEl)
      .setName('使用看板视图模式')
      .setDesc('启用后，功能区按钮默认打开“看板视图”；关闭则使用文本四象限模式')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.preferBoardView)
        .onChange(async (v) => {
          this.plugin.settings.preferBoardView = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('归档记录上限')
      .setDesc('超过上限的旧记录将自动裁剪，保留最新记录（默认 500）')
      .addText(text => text
        .setPlaceholder('500')
        .setValue(String(this.plugin.settings.maxArchiveItems))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            this.plugin.settings.maxArchiveItems = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('四象限每栏上限')
      .setDesc('每个象限保留的最大条目数，超过将自动裁剪旧项（默认 50）')
      .addText(text => text
        .setPlaceholder('50')
        .setValue(String(this.plugin.settings.maxQuadrantItems))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!Number.isNaN(n) && n > 0) {
            this.plugin.settings.maxQuadrantItems = n;
            await this.plugin.saveSettings();
          }
        })
      );

    new Setting(containerEl)
      .setName('自定义文本示例')
      .setDesc("It's a secret")
      .addText(text => text
        .setPlaceholder('Enter your secret')
        .setValue(this.plugin.settings.mySetting)
        .onChange(async (value) => {
          this.plugin.settings.mySetting = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

// 快速添加弹窗（支持预选象限）
class QuickAddModal extends Modal {
  constructor(app, plugin, initialKey) {
    super(app);
    this.plugin = plugin;
    this.initialKey = initialKey;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('four-grids-modal');

    contentEl.createEl('h2', { text: '快速添加任务到四象限' });

    // 选择象限
    const selectWrap = contentEl.createEl('div');
    const label = selectWrap.createEl('label', { text: '选择象限：' });
    label.style.marginRight = '8px';
    const select = selectWrap.createEl('select');
    const options = [
      { key: 'IU', text: '重要且紧急' },
      { key: 'IN', text: '重要不紧急' },
      { key: 'NU', text: '不重要且紧急' },
      { key: 'NN', text: '不重要不紧急' },
    ];
    for (const opt of options) {
      const o = select.createEl('option');
      o.value = opt.key;
      o.text = opt.text;
    }
    if (this.initialKey) {
      select.value = this.initialKey;
    }

    // 输入任务
    const input = contentEl.createEl('input');
    input.type = 'text';
    input.placeholder = '输入任务内容';
    input.style.width = '100%';
    input.style.marginTop = '8px';

    // 添加按钮
    const btnRow = contentEl.createEl('div');
    btnRow.style.marginTop = '12px';
    const addBtn = btnRow.createEl('button', { text: '添加' });
    addBtn.onclick = () => {
      const text = input.value.trim();
      const key = select.value;
      if (!text) {
        new Notice('请输入任务内容');
        return;
      }
      this.plugin.addTaskToQuadrantInActive(key, text);
      this.close();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
}