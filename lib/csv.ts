import { TransactionRecord } from './db';

const CSV_HEADERS = ['日期', '类型', '金额', '分类', '账户', '备注', '创建时间', '记录ID', '更新时间'] as const;

function quoteCsvCell(value: string | number) {
  const text = String(value);
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildRecordsCsv(records: TransactionRecord[]) {
  const rows = records.map((record) => [
    record.date,
    record.type === 'expense' ? '支出' : '收入',
    record.amount.toFixed(2),
    record.category,
    record.account,
    record.note,
    record.createdAt,
    record.id,
    record.updatedAt ?? '',
  ]);
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(quoteCsvCell).join(',')).join('\r\n')}`;
}

function parseCsvRows(source: string) {
  const text = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV 引号不完整');
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function restoreFormulaSafeText(value: string) {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function validIsoDateTime(value: string) {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function parseRecordsCsv(source: string): TransactionRecord[] {
  const rows = parseCsvRows(source);
  if (rows.length === 0) throw new Error('CSV 为空');

  const headers = rows[0].map((value) => value.trim());
  const column = (name: string, required = true) => {
    const index = headers.indexOf(name);
    if (required && index < 0) throw new Error(`缺少“${name}”列`);
    return index;
  };
  const indexes = {
    date: column('日期'),
    type: column('类型'),
    amount: column('金额'),
    category: column('分类'),
    account: column('账户'),
    note: column('备注'),
    createdAt: column('创建时间'),
    id: column('记录ID', false),
    updatedAt: column('更新时间', false),
  };

  const ids = new Set<string>();
  return rows.slice(1).map((values, rowIndex) => {
    const get = (index: number) => index < 0 ? '' : (values[index] ?? '').trim();
    const date = get(indexes.date);
    const rawType = get(indexes.type);
    const type = rawType === '支出' || rawType === 'expense'
      ? 'expense'
      : rawType === '收入' || rawType === 'income' ? 'income' : null;
    const amount = Number(get(indexes.amount).replaceAll(',', ''));
    const category = restoreFormulaSafeText(get(indexes.category));
    const account = restoreFormulaSafeText(get(indexes.account));
    const note = restoreFormulaSafeText(get(indexes.note));
    const createdAtValue = get(indexes.createdAt);
    const updatedAtValue = get(indexes.updatedAt);
    const suppliedId = get(indexes.id);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !type || !Number.isFinite(amount) || amount <= 0 || !category || !account) {
      throw new Error(`第 ${rowIndex + 2} 行内容无效`);
    }

    const id = suppliedId && !ids.has(suppliedId) ? suppliedId : crypto.randomUUID();
    ids.add(id);
    return {
      id,
      date,
      type,
      amount: Math.round(amount * 100) / 100,
      category,
      account,
      note,
      createdAt: validIsoDateTime(createdAtValue) ? createdAtValue : new Date().toISOString(),
      updatedAt: validIsoDateTime(updatedAtValue) ? updatedAtValue : undefined,
    };
  });
}
