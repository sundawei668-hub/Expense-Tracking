'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import type { TransactionRecord, TransactionType } from '@/lib/db';
import { addCategory, CATEGORY_ICONS, CategoryGroup, CategorySelection, CategoryTarget, categoryUsageCount, deleteCategory, moveCategory, renameCategory, toggleCategoryVisibility } from '@/lib/categories';
import CategoryIcon from './category-icon';

type CategoryView = 'pick' | 'manage' | 'add' | 'edit' | 'delete';

interface Props {
  initialView: 'pick' | 'manage';
  initialGroup?: string;
  type: TransactionType;
  selected: CategorySelection;
  catalog: CategoryGroup[];
  records: TransactionRecord[];
  onChange: (catalog: CategoryGroup[]) => void;
  onSelect: (selection: CategorySelection) => void;
  onClose: () => void;
}

export default function CategoryPanel({ initialView, initialGroup, type: initialType, selected, catalog, records, onChange, onSelect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<CategoryView>(initialView);
  const [type, setType] = useState(initialType);
  const [expanded, setExpanded] = useState<string[]>([initialGroup ?? selected.categoryGroup ?? selected.category]);
  const [query, setQuery] = useState('');
  const [alphabetical, setAlphabetical] = useState(false);
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('food');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [returnView, setReturnView] = useState<'pick' | 'manage'>(initialView);
  const [editTarget, setEditTarget] = useState<CategoryTarget | null>(null);
  const depth = useRef(0);
  const manageDepth = useRef(initialView === 'manage' ? 1 : 0);
  const historyKey = useRef('');
  const viewRef = useRef(view);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    historyKey.current ||= crypto.randomUUID();
    if (window.history.state?.categoryPanelKey !== historyKey.current) {
      const state = { ...window.history.state, categoryPanel: initialView, categoryPanelKey: historyKey.current, categoryPanelDepth: 1, categoryPanelType: initialType };
      window.history.pushState(state, '', `#categories/${initialView}`);
      depth.current = 1;
    }
    const onPop = (event: PopStateEvent) => {
      if (event.state?.categoryPanelKey !== historyKey.current) { depth.current = 0; closeRef.current(); }
      else {
        depth.current = event.state.categoryPanelDepth;
        setView(event.state.categoryPanel); viewRef.current = event.state.categoryPanel;
        setType(event.state.categoryPanel === 'pick' ? initialType : event.state.categoryPanelType ?? initialType);
        setEditTarget(event.state.categoryPanelTarget ?? null);
        if (event.state.categoryPanel === 'manage') manageDepth.current = depth.current;
        setError('');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = previousOverflow;
      el?.close();
    };
  }, [initialView, initialType]);

  const navigate = (next: CategoryView, target?: CategoryTarget) => {
    setError(''); setNotice('');
    if (next === 'add') setReturnView(viewRef.current === 'manage' ? 'manage' : 'pick');
    window.history.pushState({ ...window.history.state, categoryPanel: next, categoryPanelDepth: depth.current + 1, categoryPanelType: type, categoryPanelTarget: target }, '', `#categories/${next}`);
    depth.current += 1;
    if (next === 'manage') manageDepth.current = depth.current;
    viewRef.current = next;
    setView(next);
    dialog.current?.querySelector<HTMLElement>('h2')?.focus();
  };
  const close = () => { if (depth.current > 0) window.history.go(-depth.current); depth.current = 0; onClose(); };
  const goBack = () => { if (depth.current > 1) window.history.back(); else close(); };
  const choose = (group: CategoryGroup, childName?: string) => {
    if (group.type !== initialType || group.hidden) return;
    onSelect({ category: childName ?? group.name, categoryGroup: group.name });
    close();
  };
  const toggleGroup = (groupName: string) => setExpanded((old) => old.includes(groupName) ? old.filter((n) => n !== groupName) : [...old, groupName]);
  const update = (action: () => CategoryGroup[], message: string) => {
    try { onChange(action()); setError(''); setNotice(message); }
    catch (e) { setError(e instanceof Error ? e.message : '分类保存失败，请重试'); }
  };
  const startAdding = (groupId = '') => { setParentId(groupId); setName(''); setIcon(catalog.find((g) => g.id === groupId)?.icon ?? 'food'); navigate('add'); };
  const startEditing = (parent: CategoryGroup, childId?: string) => {
    const target = { groupId: parent.id, childId };
    const item = childId ? parent.children.find((c) => c.id === childId) : parent;
    if (!item) return;
    setEditTarget(target); setName(item.name); setIcon(parent.icon); navigate('edit', target);
  };
  const startDeleting = (target: CategoryTarget) => { setEditTarget(target); navigate('delete', target); };
  const backToManage = () => {
    if (manageDepth.current > 0 && manageDepth.current < depth.current) window.history.go(manageDepth.current - depth.current);
    else goBack();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const next = addCategory(catalog, type, parentId || null, name, icon);
      onChange(next);
      const parent = next.find((g) => g.id === parentId);
      setExpanded([parent?.name ?? name.trim()]); setQuery(''); setNotice('分类已添加'); setError('');
      setView(returnView); viewRef.current = returnView;
      window.history.back();
    } catch (e) { setError(e instanceof Error ? e.message : '分类保存失败，请重试'); }
  };

  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editTarget) return;
    try {
      const next = renameCategory(catalog, editTarget, name, icon);
      onChange(next);
      const parent = next.find((g) => g.id === editTarget.groupId);
      if (parent) setExpanded([parent.name]);
      setQuery(''); setError(''); setNotice('分类已修改，历史账单保留原名称');
      backToManage();
    } catch (e) { setError(e instanceof Error ? e.message : '修改失败，请重试'); }
  };
  const confirmDelete = () => {
    if (!editTarget) return;
    try {
      onChange(deleteCategory(catalog, editTarget));
      setError(''); setNotice('分类已删除，历史账单已保留');
      backToManage();
    } catch (e) { setError(e instanceof Error ? e.message : '删除失败，请重试'); }
  };

  const targetParent = catalog.find((g) => g.id === editTarget?.groupId);
  const targetItem = editTarget?.childId ? targetParent?.children.find((c) => c.id === editTarget.childId) : targetParent;
  const targetUsage = editTarget && targetItem ? categoryUsageCount(records, catalog, editTarget) : 0;
  const isList = view === 'pick' || view === 'manage';

  const term = query.trim().toLowerCase();
  let groups = catalog.filter((g) => g.type === (view === 'pick' ? initialType : type) && (view === 'manage' || !g.hidden));
  if (alphabetical && view === 'pick') groups = [...groups].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const visibleGroups = groups.filter((g) => !term || g.name.toLowerCase().includes(term) || g.children.some((c) => (view === 'manage' || !c.hidden) && c.name.toLowerCase().includes(term)));
  const selectedGroup = selected.categoryGroup ?? selected.category;
  const isPicked = (g: CategoryGroup, child?: string) => type === initialType && selectedGroup === g.name && selected.category === (child ?? g.name);

  return <dialog ref={dialog} className={`category-dialog ${!isList ? 'category-editor-dialog' : ''}`} aria-labelledby="category-page-title" onCancel={(e) => { e.preventDefault(); goBack(); }}>
    <div className="category-page">
      <header className="category-page-header">
        <button type="button" className="icon-button" onClick={goBack} aria-label={depth.current > 1 ? '返回上一页' : '关闭分类页面'}>‹</button>
        <h2 id="category-page-title" tabIndex={-1}>{view === 'pick' ? '选择分类' : view === 'manage' ? '分类管理' : view === 'edit' ? '编辑分类' : view === 'delete' ? '删除分类' : '添加分类'}</h2>
        {view === 'pick' ? <button className={`icon-button sort-button ${alphabetical ? 'selected' : ''}`} onClick={() => setAlphabetical(!alphabetical)} aria-label="按拼音排序" aria-pressed={alphabetical}>A↓</button> : <button className="icon-button" onClick={close} aria-label="关闭分类页面">×</button>}
      </header>
      {isList && <>
        <div className="category-toolbar">
          {view === 'manage' && <div className="category-type-tabs" aria-label="管理收支分类">
            {(['expense', 'income'] as const).map((item) => <button key={item} className={item === type ? 'active' : ''} onClick={() => { setType(item); setQuery(''); setError(''); window.history.replaceState({ ...window.history.state, categoryPanelType: item }, ''); }}>{item === 'expense' ? '支出' : '收入'}</button>)}
          </div>}
          <label className="category-search"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg><input aria-label="搜索分类" placeholder="搜索大类或子分类" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button onClick={() => setQuery('')} aria-label="清空分类搜索">×</button>}</label>
          {view === 'manage' && <p className="category-help">点“编辑”修改名称；展开大类可隐藏、排序或删除。历史账单保留原分类。</p>}
        </div>
      </>}
      {error && <p className="category-feedback error" role="alert">{error}</p>}
      {notice && <p className="category-feedback" role="status">{notice}</p>}
      <div className="category-page-scroll">
        {view === 'add' ? <form className="category-editor" onSubmit={submit}>
          <div className="category-preview"><CategoryIcon name={icon} /><strong>{name.trim() || '新分类'}</strong><span>{type === 'expense' ? '支出' : '收入'}{parentId ? ` / ${catalog.find((g) => g.id === parentId)?.name}` : ' / 大类'}</span></div>
          <label>所属大类<select value={parentId} onChange={(e) => { setParentId(e.target.value); setIcon(catalog.find((g) => g.id === e.target.value)?.icon ?? 'food'); }}><option value="">新建一个大类</option>{catalog.filter((g) => g.type === type && !g.hidden).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <label>分类名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder={parentId ? '例如：工作日午餐' : '例如：旅行'} maxLength={24} required /></label>
          {!parentId && <fieldset className="category-icon-options"><legend>选择图标</legend>{CATEGORY_ICONS.map((item, index) => <button type="button" key={item} aria-label={`图标 ${index + 1}`} aria-pressed={icon === item} className={icon === item ? 'selected' : ''} onClick={() => setIcon(item)}><CategoryIcon name={item} /></button>)}</fieldset>}
          <button className="save-button" type="submit">保存分类</button>
        </form> : (view === 'edit' || view === 'delete') && (!targetItem || !targetParent) ? <div className="category-empty"><h3>这个分类已不存在</h3><p>已删除的分类不会重新出现在选择列表中。</p><button onClick={backToManage}>返回分类管理</button></div>
        : view === 'edit' && targetParent && targetItem ? <form className="category-editor" onSubmit={submitEdit}>
          <div className="category-preview"><CategoryIcon name={icon} /><strong>{name.trim() || targetItem.name}</strong><span>{targetParent.type === 'expense' ? '支出' : '收入'} / {editTarget?.childId ? targetParent.name : '大类'}</span></div>
          <label>分类名称<input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required /></label>
          {!editTarget?.childId && <fieldset className="category-icon-options"><legend>选择图标</legend>{CATEGORY_ICONS.map((item, index) => <button type="button" key={item} aria-label={`图标 ${index + 1}`} aria-pressed={icon === item} className={icon === item ? 'selected' : ''} onClick={() => setIcon(item)}><CategoryIcon name={item} /></button>)}</fieldset>}
          <p className="category-edit-note">新名称用于以后记账。{targetUsage > 0 ? `已有 ${targetUsage} 笔账单保留原分类名称。` : '历史账单的分类和金额不会改动。'}</p>
          <button className="save-button" type="submit">保存修改</button>
          <button type="button" className="category-delete-entry" onClick={() => editTarget && startDeleting(editTarget)}>删除这个{editTarget?.childId ? '子分类' : '大类'}</button>
        </form>
        : view === 'delete' && targetParent && targetItem ? <section className="category-delete-confirm" aria-labelledby="category-delete-heading">
          <CategoryIcon name={targetParent.icon} />
          <h3 id="category-delete-heading">删除“{targetItem.name}”？</h3>
          <p>{editTarget?.childId ? `这个子分类将从“${targetParent.name}”中移除。` : '这个大类将从分类列表中移除。'}</p>
          {!editTarget?.childId && targetParent.children.length > 0 && <div className="category-delete-children"><b>同时移除 {targetParent.children.length} 个子分类</b><p>{targetParent.children.map((c) => c.name).join('、')}</p></div>}
          <p className="category-retain-note">{targetUsage > 0 ? `已有的 ${targetUsage} 笔相关账单全部保留，仍可查看、编辑和导出。` : '这只会删除分类选项，不会删除任何账单。'}</p>
          <p className="category-help">如果只是暂时不用，可以返回后选择“隐藏”。</p>
          <button type="button" className="category-delete-button" onClick={confirmDelete}>确认删除分类</button>
          <button type="button" className="category-cancel-delete" onClick={goBack}>取消，保留分类</button>
        </section> : <div className="category-tree">
          {visibleGroups.length === 0 && <div className="category-empty"><CategoryIcon name="other" /><h3>没有找到“{query}”</h3><p>换个关键词，或添加一个新分类。</p><button onClick={() => startAdding()}>添加分类</button></div>}
          {visibleGroups.map((g) => {
            const open = Boolean(term) || expanded.includes(g.name);
            const children = g.children.filter((c) => (view === 'manage' || !c.hidden) && (!term || g.name.toLowerCase().includes(term) || c.name.toLowerCase().includes(term)));
            const groupIndex = groups.findIndex((item) => item.id === g.id);
            return <section className={`category-branch ${g.hidden ? 'is-hidden' : ''}`} key={g.id}>
              <div className="category-group-row">
                <button className="category-group-toggle" aria-expanded={open} onClick={() => toggleGroup(g.name)}><CategoryIcon name={g.icon} /><span>{g.name}{g.hidden && <small>已隐藏</small>}</span><span className="category-count">{g.children.filter((c) => !c.hidden).length}</span><span className={`tree-chevron ${open ? 'open' : ''}`}>⌄</span></button>
                {view === 'manage' && <div className="category-row-actions"><button onClick={() => startEditing(g)} aria-label={`编辑大类${g.name}`}>编辑</button></div>}
              </div>
              {open && <div className="category-children">
                {view === 'manage' && <div className="category-group-tools">
                  <button aria-label={`上移${g.name}`} disabled={groupIndex === 0} onClick={() => update(() => moveCategory(catalog, g.id, -1), '顺序已保存')}>↑ 上移</button>
                  <button aria-label={`下移${g.name}`} disabled={groupIndex === groups.length - 1} onClick={() => update(() => moveCategory(catalog, g.id, 1), '顺序已保存')}>↓ 下移</button>
                  <button onClick={() => update(() => toggleCategoryVisibility(catalog, g.id), g.hidden ? '分类已恢复' : '分类已隐藏')}>{g.hidden ? '恢复' : '隐藏'}</button>
                  <button className="category-danger-text" onClick={() => startDeleting({ groupId: g.id })}>删除</button>
                </div>}
                {view === 'pick' && (!term || g.name.toLowerCase().includes(term)) && <button className={`category-child-row ${isPicked(g) ? 'is-picked' : ''}`} onClick={() => choose(g)} aria-pressed={isPicked(g)}><CategoryIcon name={g.icon} /><span>{g.name}<small>不细分</small></span>{isPicked(g) && <b className="category-check">✓</b>}</button>}
                {children.map((c) => view === 'pick' ? <button className={`category-child-row ${isPicked(g, c.name) ? 'is-picked' : ''}`} key={c.id} aria-pressed={isPicked(g, c.name)} onClick={() => choose(g, c.name)}><CategoryIcon name={g.icon} /><span>{c.name}</span>{isPicked(g, c.name) && <b className="category-check">✓</b>}</button> : <div className={`category-child-row ${c.hidden ? 'is-hidden' : ''}`} key={c.id}><CategoryIcon name={g.icon} /><span>{c.name}{c.hidden && <small>已隐藏</small>}</span><div className="category-child-tools"><button onClick={() => startEditing(g, c.id)} aria-label={`编辑${g.name}的${c.name}`}>编辑</button><button onClick={() => update(() => toggleCategoryVisibility(catalog, g.id, c.id), c.hidden ? '子分类已恢复' : '子分类已隐藏')}>{c.hidden ? '恢复' : '隐藏'}</button></div></div>)}
                {view === 'manage' && !g.hidden && <button className="category-add-child" onClick={() => startAdding(g.id)}>＋ 添加{g.name}子分类</button>}
              </div>}
            </section>;
          })}
        </div>}
      </div>
      {isList && <footer className="category-page-footer"><button onClick={() => startAdding(catalog.find((g) => g.type === type && !g.hidden && expanded.includes(g.name))?.id)}><span>＋</span>添加分类</button>{view === 'pick' ? <button onClick={() => { setQuery(''); navigate('manage'); }}>管理</button> : <button onClick={close}>完成</button>}</footer>}
    </div>
  </dialog>;
}
