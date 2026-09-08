import type { TransactionRecord, TransactionType } from './db';

export interface CategoryItem { id: string; name: string; hidden?: boolean }
export interface CategoryGroup extends CategoryItem {
  type: TransactionType;
  icon: string;
  children: CategoryItem[];
}
export interface CategorySelection { category: string; categoryGroup?: string }
export interface CategoryTarget { groupId: string; childId?: string }

export const CATEGORY_STORAGE_KEY = 'yi-ben-zhang-categories-v1';
export const CATEGORY_ICONS = ['food', 'bus', 'shopping', 'film', 'medical', 'home', 'gift', 'store', 'child', 'wallet', 'book', 'other'] as const;

function group(type: TransactionType, name: string, icon: string, names: string[], hidden = false): CategoryGroup {
  return { id: `${type}:${name}`, name, type, icon, hidden,
    children: names.map((child) => ({ id: `${type}:${name}:${child}`, name: child })) };
}

export const DEFAULT_CATEGORY_GROUPS: CategoryGroup[] = [
  group('expense', '餐饮', 'food', ['早餐', '午餐', '晚餐', '夜宵', '零食', '饮料水果', '买菜原料', '油盐酱醋', '餐饮其他']),
  group('expense', '交通', 'bus', ['打车', '公交', '加油', '停车费', '地铁', '火车', '长途汽车', '飞机', '自行车', '船舶', '保养维修', '过路过桥', '罚款赔偿', '车款车贷', '车险', '驾照费用', '交通其他']),
  group('expense', '购物', 'shopping', ['服饰鞋包', '家居百货', '宝宝用品', '化妆护肤', '烟酒', '电子数码', '文具玩具', '报刊书籍', '珠宝首饰', '家具家纺', '保健用品', '电器', '摄影文印', '购物其他']),
  group('expense', '娱乐', 'film', ['旅游度假', '电影', '网游电玩', '麻将棋牌', '洗浴足浴', '运动健身', '花鸟宠物', '聚会玩乐', '茶酒咖啡', '卡拉OK', '歌舞演出', '电视', '娱乐其他']),
  group('expense', '医教', 'medical', ['医疗药品', '挂号门诊', '养生保健', '住院费', '养老院', '学杂教材', '培训考试', '幼儿教育', '学费', '家教补习', '出国留学', '助学贷款', '医教其他']),
  group('expense', '居家', 'home', ['手机电话', '水电燃气', '生活费', '美发美容', '住宿房租', '材料建材', '房款房贷', '快递邮政', '电脑宽带', '家政服务', '物业', '税费手续费', '保险费', '消费贷款', '婚庆摄影', '漏记款', '生活其他']),
  group('expense', '人情', 'gift', ['礼金红包', '请客送礼', '孝敬长辈', '捐赠', '人情其他']),
  group('expense', '生意', 'store', ['进货采购', '经营费用', '员工工资', '店铺租金', '生意其他']),
  group('expense', '子女', 'child', ['日常用品', '兴趣培养', '零花钱', '子女其他']),
  group('expense', '其他', 'other', []),
  group('expense', '医疗', 'medical', [], true),
  group('expense', '教育', 'book', [], true),
  group('income', '工资', 'wallet', ['基本工资', '加班收入', '补贴津贴']),
  group('income', '奖金', 'gift', ['绩效奖金', '年终奖']),
  group('income', '理财', 'wallet', ['利息', '分红', '投资收益']),
  group('income', '报销', 'book', ['差旅报销', '日常报销']),
  group('income', '兼职', 'store', ['兼职收入', '劳务收入']),
  group('income', '其他', 'other', ['红包礼金', '退款返还', '其他收入']),
];

export function isCategoryCatalog(value: unknown): value is CategoryGroup[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 300) return false;
  const ids = new Set<string>();
  const groupNames = new Set<string>();
  const itemValid = (item: unknown): item is CategoryItem => {
    if (!item || typeof item !== 'object') return false;
    const c = item as CategoryItem;
    if (typeof c.id !== 'string' || !c.id || ids.has(c.id)
      || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 24
      || (c.hidden !== undefined && typeof c.hidden !== 'boolean')) return false;
    ids.add(c.id);
    return true;
  };
  return value.every((entry) => {
    if (!itemValid(entry)) return false;
    const g = entry as CategoryGroup;
    const key = `${g.type}:${g.name}`;
    if (!['expense', 'income'].includes(g.type) || groupNames.has(key)
      || !CATEGORY_ICONS.includes(g.icon as typeof CATEGORY_ICONS[number])
      || !Array.isArray(g.children) || g.children.length > 300) return false;
    groupNames.add(key);
    const names = new Set([g.name]);
    return g.children.every((child) => {
      if (!itemValid(child) || names.has(child.name)) return false;
      names.add(child.name);
      return true;
    });
  }) && ['expense', 'income'].every((type) => value.some((g) => g.type === type && !g.hidden));
}

export function readCategoryCatalog(): CategoryGroup[] {
  const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
  if (!raw) return structuredClone(DEFAULT_CATEGORY_GROUPS);
  const parsed: unknown = JSON.parse(raw);
  if (!isCategoryCatalog(parsed)) throw new Error('分类设置无法读取');
  return parsed;
}

export function persistCategoryCatalog(catalog: CategoryGroup[]) {
  if (!isCategoryCatalog(catalog)) throw new Error('分类设置无效');
  localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(catalog));
}

export function addCategory(catalog: CategoryGroup[], type: TransactionType, parentId: string | null, rawName: string, icon: string): CategoryGroup[] {
  const name = validCategoryName(rawName);
  const parent = catalog.find((g) => g.id === parentId && g.type === type);
  if (parentId && (!parent || parent.hidden)) throw new Error('请重新选择所属大类');
  const siblings = parent ? [parent, ...parent.children] : catalog.filter((g) => g.type === type);
  if (siblings.some((c) => c.name === name)) throw new Error('这个名称已存在，请到管理中查看或恢复');
  const item = { id: crypto.randomUUID(), name };
  const result = parent
    ? catalog.map((g) => g.id === parent.id ? { ...g, children: [...g.children, item] } : g)
    : [...catalog, { ...item, type, icon, children: [] }];
  if (!isCategoryCatalog(result)) throw new Error('分类数量已达到上限');
  return result;
}

function validCategoryName(rawName: string) {
  const name = rawName.trim();
  if (!name || name.length > 24 || /[\r\n\t]/.test(name)) throw new Error('请输入 1–24 个字的分类名称');
  return name;
}

export function getCategoryTarget(catalog: CategoryGroup[], target: CategoryTarget) {
  const parent = catalog.find((g) => g.id === target.groupId);
  if (!parent) throw new Error('这个大类已不存在，请返回分类管理');
  const item = target.childId ? parent.children.find((c) => c.id === target.childId) : parent;
  if (!item) throw new Error('这个子分类已不存在，请返回分类管理');
  return { parent, item };
}

// Catalog edits intentionally leave transaction name snapshots untouched.
export function renameCategory(catalog: CategoryGroup[], target: CategoryTarget, rawName: string, icon?: string): CategoryGroup[] {
  const { parent, item } = getCategoryTarget(catalog, target);
  const name = validCategoryName(rawName);
  const siblings = target.childId ? [parent, ...parent.children] : catalog.filter((g) => g.type === parent.type);
  if (siblings.some((c) => c.id !== item.id && c.name === name)
    || (!target.childId && parent.children.some((c) => c.name === name))) throw new Error('这个名称已存在，请换一个名称');
  const result = catalog.map((g) => g.id !== parent.id ? g : target.childId
    ? { ...g, children: g.children.map((c) => c.id === item.id ? { ...c, name } : c) }
    : { ...g, name, icon: icon ?? g.icon });
  if (!isCategoryCatalog(result)) throw new Error('分类设置无效，请重新检查');
  return result;
}

export function deleteCategory(catalog: CategoryGroup[], target: CategoryTarget): CategoryGroup[] {
  const { parent, item } = getCategoryTarget(catalog, target);
  const result = target.childId
    ? catalog.map((g) => g.id === parent.id ? { ...g, children: g.children.filter((c) => c.id !== item.id) } : g)
    : catalog.filter((g) => g.id !== parent.id);
  if (!isCategoryCatalog(result)) throw new Error('收入和支出至少各保留一个可用大类，请先新增或恢复其他大类');
  return result;
}

export function categoryUsageCount(records: TransactionRecord[], catalog: CategoryGroup[], target: CategoryTarget) {
  const { parent, item } = getCategoryTarget(catalog, target);
  return records.filter((r) => r.type === parent.type && recordCategoryGroup(r) === parent.name
    && (!target.childId || r.category === item.name)).length;
}

export function remapCategorySelection(previous: CategoryGroup[], next: CategoryGroup[], type: TransactionType, selection: CategorySelection): CategorySelection {
  const oldParent = previous.find((g) => g.type === type && g.name === recordCategoryGroup(selection));
  const parent = next.find((g) => g.id === oldParent?.id);
  if (!parent || !oldParent) return visibleCategorySelection(next, type, selection);
  const oldChild = oldParent.children.find((c) => c.name === selection.category);
  const child = parent.children.find((c) => c.id === oldChild?.id);
  return visibleCategorySelection(next, type, { category: child?.name ?? parent.name, categoryGroup: parent.name });
}

export function toggleCategoryVisibility(catalog: CategoryGroup[], groupId: string, childId?: string): CategoryGroup[] {
  const result = catalog.map((g) => g.id !== groupId ? g : childId
    ? { ...g, children: g.children.map((c) => c.id === childId ? { ...c, hidden: !c.hidden } : c) }
    : { ...g, hidden: !g.hidden });
  if (!isCategoryCatalog(result)) throw new Error('收入和支出至少各保留一个大类');
  return result;
}

export function moveCategory(catalog: CategoryGroup[], groupId: string, direction: -1 | 1): CategoryGroup[] {
  const index = catalog.findIndex((g) => g.id === groupId);
  if (index < 0) return catalog;
  const sameType = catalog.map((g, i) => g.type === catalog[index].type ? i : -1).filter((i) => i >= 0);
  const next = sameType[sameType.indexOf(index) + direction];
  if (next === undefined) return catalog;
  const result = [...catalog];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

export function recordCategoryGroup(record: Pick<TransactionRecord, 'category' | 'categoryGroup'>) {
  return record.categoryGroup || record.category;
}

export function categoryCaption(record: Pick<TransactionRecord, 'category' | 'categoryGroup'>) {
  return record.categoryGroup && record.categoryGroup !== record.category
    ? `${record.categoryGroup} · ${record.category}` : record.category;
}

export function categoryIconName(catalog: CategoryGroup[], type: TransactionType, selection: CategorySelection) {
  return catalog.find((g) => g.type === type && g.name === recordCategoryGroup(selection))?.icon ?? 'other';
}

export function visibleCategorySelection(catalog: CategoryGroup[], type: TransactionType, selection: CategorySelection): CategorySelection {
  const parent = catalog.find((g) => g.type === type && g.name === recordCategoryGroup(selection));
  if (parent && !parent.hidden) {
    if (selection.category === parent.name || parent.children.some((c) => !c.hidden && c.name === selection.category)) return selection;
    return { category: parent.name, categoryGroup: parent.name };
  }
  const fallback = catalog.find((g) => g.type === type && !g.hidden);
  return fallback ? { category: fallback.name, categoryGroup: fallback.name } : selection;
}

export function totalByCategory(records: TransactionRecord[], parent?: string): [string, number][] {
  const cents = new Map<string, number>();
  records.filter((r) => r.type === 'expense' && (!parent || recordCategoryGroup(r) === parent)).forEach((r) => {
    const key = parent ? r.category : recordCategoryGroup(r);
    cents.set(key, (cents.get(key) ?? 0) + Math.round(r.amount * 100));
  });
  return [...cents.entries()].map(([key, value]): [string, number] => [key, value / 100]).sort((a, b) => b[1] - a[1]);
}
