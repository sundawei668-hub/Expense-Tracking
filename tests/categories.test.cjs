const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Compile the real TypeScript modules in memory; tests never touch a user's DB.
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  module._compile(output, filename);
};
const c = require('../lib/categories.ts');
const csv = require('../lib/csv.ts');
const encryption = require('../lib/crypto.ts');
const values = new Map();
global.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
const clean = (value) => JSON.parse(JSON.stringify(value));
const makeRecord = (id, category, amount, categoryGroup, type = 'expense') => ({
  id, category, amount, ...(categoryGroup ? { categoryGroup } : {}), type,
  date: '2026-09-08', account: '支付宝', note: '', createdAt: '2026-09-08T00:00:00.000Z',
});

test('reference categories include the requested children without duplicate appliance entries', () => {
  assert.equal(c.isCategoryCatalog(c.DEFAULT_CATEGORY_GROUPS), true);
  assert.ok(c.DEFAULT_CATEGORY_GROUPS.find((g) => g.name === '交通').children.some((x) => x.name === '停车费'));
  assert.ok(c.DEFAULT_CATEGORY_GROUPS.find((g) => g.name === '医教').children.some((x) => x.name === '学费'));
  assert.equal(c.DEFAULT_CATEGORY_GROUPS.find((g) => g.name === '购物').children.filter((x) => x.name === '电器').length, 1);
});

test('same child label in different parents has different identity and totals', () => {
  let catalog = c.addCategory(c.DEFAULT_CATEGORY_GROUPS, 'expense', 'expense:餐饮', '备用', 'food');
  catalog = c.addCategory(catalog, 'expense', 'expense:交通', '备用', 'bus');
  const a = catalog.find((g) => g.name === '餐饮').children.find((x) => x.name === '备用');
  const b = catalog.find((g) => g.name === '交通').children.find((x) => x.name === '备用');
  assert.notEqual(a.id, b.id);
  const records = [makeRecord('a', '备用', 12, '餐饮'), makeRecord('b', '备用', 30, '交通')];
  assert.deepEqual(c.totalByCategory(records), [['交通', 30], ['餐饮', 12]]);
  assert.deepEqual(c.totalByCategory(records, '餐饮'), [['备用', 12]]);
});

test('reject blank, duplicate, oversized names and duplicate hidden names', () => {
  for (const name of ['', ' ', '早餐', 'x'.repeat(25)]) {
    assert.throws(() => c.addCategory(c.DEFAULT_CATEGORY_GROUPS, 'expense', 'expense:餐饮', name, 'food'));
  }
  const hidden = c.toggleCategoryVisibility(c.DEFAULT_CATEGORY_GROUPS, 'expense:餐饮', 'expense:餐饮:早餐');
  assert.throws(() => c.addCategory(hidden, 'expense', 'expense:餐饮', '早餐', 'food'));
});

test('hiding leaves old records and their icon/group unchanged and is reversible', () => {
  const record = makeRecord('old', '早餐', 10, '餐饮');
  const before = JSON.stringify(record);
  let catalog = c.toggleCategoryVisibility(c.DEFAULT_CATEGORY_GROUPS, 'expense:餐饮');
  assert.equal(catalog.find((g) => g.name === '餐饮').hidden, true);
  assert.equal(c.categoryIconName(catalog, 'expense', record), 'food');
  assert.equal(c.categoryCaption(record), '餐饮 · 早餐');
  assert.equal(JSON.stringify(record), before);
  assert.throws(() => c.addCategory(catalog, 'expense', 'expense:餐饮', '测试', 'food'));
  catalog = c.toggleCategoryVisibility(catalog, 'expense:餐饮');
  assert.equal(catalog.find((g) => g.name === '餐饮').hidden, false);
});

test('keep at least one visible parent for each transaction type', () => {
  const catalog = [c.DEFAULT_CATEGORY_GROUPS[0], c.DEFAULT_CATEGORY_GROUPS.find((g) => g.type === 'income')];
  assert.throws(() => c.toggleCategoryVisibility(catalog, catalog[0].id));
});

test('new entries fall back after hiding while a valid same-named child keeps its parent', () => {
  const selection = { category: '早餐', categoryGroup: '餐饮' };
  let catalog = c.toggleCategoryVisibility(c.DEFAULT_CATEGORY_GROUPS, 'expense:餐饮', 'expense:餐饮:早餐');
  assert.deepEqual(c.visibleCategorySelection(catalog, 'expense', selection), { category: '餐饮', categoryGroup: '餐饮' });
  catalog = c.toggleCategoryVisibility(catalog, 'expense:餐饮');
  assert.deepEqual(c.visibleCategorySelection(catalog, 'expense', selection), { category: '交通', categoryGroup: '交通' });
  assert.deepEqual(c.visibleCategorySelection(catalog, 'income', selection), { category: '工资', categoryGroup: '工资' });
});

test('rename parent and child preserve stable identities and stored history snapshots', () => {
  const source = clean(c.DEFAULT_CATEGORY_GROUPS);
  const sourceJson = JSON.stringify(source);
  const records = [makeRecord('a', '早餐', 12, '餐饮')];
  const oldCsv = csv.buildRecordsCsv(records);
  const oldTotals = c.totalByCategory(records);
  let renamed = c.renameCategory(source, { groupId: 'expense:餐饮' }, '日常吃喝', 'shopping');
  renamed = c.renameCategory(renamed, { groupId: 'expense:餐饮', childId: 'expense:餐饮:早餐' }, '早点');
  const parent = renamed.find((g) => g.id === 'expense:餐饮');
  assert.equal(parent.name, '日常吃喝');
  assert.equal(parent.icon, 'shopping');
  assert.equal(parent.children.find((x) => x.id === 'expense:餐饮:早餐').name, '早点');
  assert.equal(JSON.stringify(source), sourceJson);
  assert.equal(csv.buildRecordsCsv(records), oldCsv);
  assert.deepEqual(c.totalByCategory(records), oldTotals);
  assert.deepEqual(c.remapCategorySelection(source, renamed, 'expense', records[0]), { category: '早点', categoryGroup: '日常吃喝' });
});

test('rename prevents sibling, hidden and parent/child collisions and invalid names', () => {
  const parent = { groupId: 'expense:餐饮' };
  const child = { ...parent, childId: 'expense:餐饮:早餐' };
  for (const name of ['', ' ', '交通', '早餐', '医疗', 'x'.repeat(25), '不合法\n名称']) {
    assert.throws(() => c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, parent, name));
  }
  for (const name of ['餐饮', '午餐']) assert.throws(() => c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, child, name));
  assert.doesNotThrow(() => c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, parent, ' 工资 '));
  assert.equal(c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, parent, ' 餐饮 ')[0].name, '餐饮');
  assert.throws(() => c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, parent, '餐饮', 'invalid-icon'));
});

test('delete a child only removes that entry; deleting parent removes its children only', () => {
  const source = clean(c.DEFAULT_CATEGORY_GROUPS);
  const oldJson = JSON.stringify(source);
  const records = [makeRecord('a', '早餐', 10, '餐饮'), makeRecord('b', '停车费', 4, '交通')];
  const originalCsv = csv.buildRecordsCsv(records);
  const childDeleted = c.deleteCategory(source, { groupId: 'expense:餐饮', childId: 'expense:餐饮:早餐' });
  assert.equal(childDeleted.find((g) => g.name === '餐饮').children.length, source[0].children.length - 1);
  assert.deepEqual(childDeleted.find((g) => g.name === '交通'), source[1]);
  const parentDeleted = c.deleteCategory(source, { groupId: 'expense:餐饮' });
  assert.equal(parentDeleted.length, source.length - 1);
  assert.ok(!parentDeleted.some((g) => g.id === 'expense:餐饮'));
  assert.deepEqual(c.remapCategorySelection(source, childDeleted, 'expense', records[0]), { category: '餐饮', categoryGroup: '餐饮' });
  assert.deepEqual(c.remapCategorySelection(source, parentDeleted, 'expense', records[0]), { category: '交通', categoryGroup: '交通' });
  assert.equal(JSON.stringify(source), oldJson);
  assert.equal(csv.buildRecordsCsv(records), originalCsv);
  assert.deepEqual(c.totalByCategory(records), [['餐饮', 10], ['交通', 4]]);
});

test('delete protects the last available category and refuses stale targets', () => {
  const catalog = [c.DEFAULT_CATEGORY_GROUPS[0], c.DEFAULT_CATEGORY_GROUPS.find((g) => g.type === 'income')];
  assert.throws(() => c.deleteCategory(catalog, { groupId: catalog[0].id }));
  assert.throws(() => c.deleteCategory(catalog, { groupId: catalog[1].id }));
  assert.throws(() => c.deleteCategory(c.DEFAULT_CATEGORY_GROUPS, { groupId: 'missing' }));
  assert.throws(() => c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, { groupId: 'expense:餐饮', childId: 'missing' }, '测试'));
  assert.throws(() => c.deleteCategory(c.DEFAULT_CATEGORY_GROUPS, { groupId: 'expense:餐饮', childId: 'expense:交通:公交' }));
});

test('delete confirmation record counts are scoped by type and full parent path', () => {
  const catalog = c.addCategory(c.DEFAULT_CATEGORY_GROUPS, 'expense', 'expense:交通', '早餐', 'bus');
  const records = [makeRecord('a', '早餐', 10, '餐饮'), makeRecord('b', '餐饮', 5), makeRecord('c', '早餐', 20, '交通'), makeRecord('d', '早餐', 20, '餐饮', 'income')];
  assert.equal(c.categoryUsageCount(records, catalog, { groupId: 'expense:餐饮' }), 2);
  assert.equal(c.categoryUsageCount(records, catalog, { groupId: 'expense:餐饮', childId: 'expense:餐饮:早餐' }), 1);
});

test('renamed and deleted default categories remain changed after reload; a new category can be created', () => {
  let catalog = c.renameCategory(c.DEFAULT_CATEGORY_GROUPS, { groupId: 'expense:餐饮' }, '吃喝');
  catalog = c.deleteCategory(catalog, { groupId: 'expense:交通' });
  c.persistCategoryCatalog(catalog);
  assert.deepEqual(c.readCategoryCatalog(), catalog);
  assert.ok(!c.readCategoryCatalog().some((g) => g.id === 'expense:交通'));
  const recreated = c.addCategory(c.readCategoryCatalog(), 'expense', null, '交通', 'bus');
  assert.notEqual(recreated.find((g) => g.name === '交通').id, 'expense:交通');
  values.delete(c.CATEGORY_STORAGE_KEY);
});

test('failed persistence throws without replacing the previously saved catalog', () => {
  c.persistCategoryCatalog(c.DEFAULT_CATEGORY_GROUPS);
  const before = values.get(c.CATEGORY_STORAGE_KEY);
  const setItem = global.localStorage.setItem;
  global.localStorage.setItem = () => { throw new Error('quota'); };
  try {
    assert.throws(() => c.persistCategoryCatalog(c.deleteCategory(c.DEFAULT_CATEGORY_GROUPS, { groupId: 'expense:餐饮' })), /quota/);
    assert.equal(values.get(c.CATEGORY_STORAGE_KEY), before);
  } finally { global.localStorage.setItem = setItem; values.delete(c.CATEGORY_STORAGE_KEY); }
});

test('sorting categories preserves the catalog and keeps types independent', () => {
  const original = JSON.stringify(c.DEFAULT_CATEGORY_GROUPS);
  const moved = c.moveCategory(c.DEFAULT_CATEGORY_GROUPS, 'expense:餐饮', 1);
  assert.equal(moved[0].name, '交通');
  assert.equal(moved[1].name, '餐饮');
  assert.deepEqual(moved.filter((g) => g.type === 'income'), c.DEFAULT_CATEGORY_GROUPS.filter((g) => g.type === 'income'));
  assert.equal(JSON.stringify(c.DEFAULT_CATEGORY_GROUPS), original);
});

test('local category preferences survive reload and corrupt storage is not overwritten', () => {
  const catalog = c.toggleCategoryVisibility(c.DEFAULT_CATEGORY_GROUPS, 'expense:购物');
  c.persistCategoryCatalog(catalog);
  assert.deepEqual(c.readCategoryCatalog(), catalog);
  values.set(c.CATEGORY_STORAGE_KEY, '{bad json');
  assert.throws(() => c.readCategoryCatalog());
  assert.equal(values.get(c.CATEGORY_STORAGE_KEY), '{bad json');
  values.delete(c.CATEGORY_STORAGE_KEY);
});

test('new CSV preserves parent, old CSV without parent still loads unchanged', () => {
  const records = [makeRecord('a', '早餐', 15.8, '餐饮'), makeRecord('b', '医疗', 23)];
  records[0].note = '包含,逗号和"引号"\n第二行';
  assert.deepEqual(clean(csv.parseRecordsCsv(csv.buildRecordsCsv(records))), records);
  const oldCsv = '日期,类型,金额,分类,账户,备注,创建时间,记录ID,更新时间\r\n2026-09-08,支出,23.00,医疗,支付宝,,2026-09-08T00:00:00.000Z,b,';
  assert.deepEqual(clean(csv.parseRecordsCsv(oldCsv)), [records[1]]);
});

test('CSV formula-safe group labels round-trip without loss', () => {
  const record = makeRecord('a', '=测试', 12, '+测试大类');
  const content = csv.buildRecordsCsv([record]);
  assert.ok(content.includes("'+测试大类"));
  assert.deepEqual(clean(csv.parseRecordsCsv(content)), [record]);
});

test('legacy category names stay separate and expense sum uses whole cents', () => {
  const records = [makeRecord('a', '医疗', 0.1), makeRecord('b', '医疗', 0.2), makeRecord('c', '学费', 40, '医教'), makeRecord('d', '医疗', 70, undefined, 'income')];
  assert.deepEqual(c.totalByCategory(records), [['医教', 40], ['医疗', 0.3]]);
  assert.equal(c.categoryCaption(records[0]), '医疗');
});

test('encrypted records and new/legacy backups keep categories and reject wrong passwords', async () => {
  const password = 'test-only-password-2026';
  const { config, key } = await encryption.createLocalAccount('test-only', password);
  encryption.saveLocalAccount(config);
  encryption.activateEncryptionKey(key);
  const records = [makeRecord('a', '早餐', 12, '餐饮'), makeRecord('b', '医疗', 20)];
  let catalog = c.addCategory(c.DEFAULT_CATEGORY_GROUPS, 'expense', null, '旅行计划', 'bus');
  catalog = c.renameCategory(catalog, { groupId: 'expense:餐饮', childId: 'expense:餐饮:早餐' }, '早点');
  catalog = c.deleteCategory(catalog, { groupId: 'expense:购物' });
  const stored = await encryption.encryptStoredRecord(records[0]);
  assert.deepEqual(await encryption.decryptStoredRecord(stored), records[0]);
  const backup = await encryption.createEncryptedBackup(records, catalog);
  const restored = await encryption.decryptEncryptedBackupContents(backup, password);
  assert.deepEqual(restored.records, records);
  assert.deepEqual(restored.categories, catalog);
  assert.ok(!JSON.stringify(backup).includes('旅行计划'));
  assert.deepEqual(await encryption.decryptEncryptedBackup(backup, password), records);
  const legacy = await encryption.createEncryptedBackup(records);
  assert.equal((await encryption.decryptEncryptedBackupContents(legacy, password)).categories, undefined);
  await assert.rejects(encryption.decryptEncryptedBackupContents(backup, 'incorrect-password'));
  encryption.clearEncryptionKey();
});
