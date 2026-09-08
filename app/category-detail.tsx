'use client';

import { useEffect, useRef } from 'react';
import { recordCategoryGroup, totalByCategory } from '@/lib/categories';
import type { TransactionRecord } from '@/lib/db';

const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CategoryDetail({ group, month, records, onClose, onEdit }: {
  group: string; month: string; records: TransactionRecord[]; onClose: () => void; onEdit: (record: TransactionRecord) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const historyKey = useRef('');
  const active = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    historyKey.current ||= crypto.randomUUID();
    if (window.history.state?.categoryDetailKey !== historyKey.current) {
      window.history.pushState({ ...window.history.state, categoryDetailKey: historyKey.current }, '', `#stats/${encodeURIComponent(group)}`);
    }
    active.current = true;
    const onPop = () => { active.current = false; closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); document.body.style.overflow = oldOverflow; el?.close(); };
  }, [group]);
  const close = () => { if (active.current) window.history.back(); active.current = false; onClose(); };
  const matching = records.filter((r) => r.type === 'expense' && recordCategoryGroup(r) === group);
  const total = matching.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) / 100;
  const breakdown = totalByCategory(records, group);

  return <dialog className="category-dialog" ref={dialog} aria-labelledby="category-detail-title" onCancel={(e) => { e.preventDefault(); close(); }}>
    <div className="category-page">
      <header className="category-page-header"><button className="icon-button" aria-label="返回月度统计" onClick={close}>‹</button><h2 id="category-detail-title">{group}明细</h2><span /></header>
      <div className="category-page-scroll">
        <section className="category-detail-summary"><p>{month.replace('-', ' 年 ')} 月 · {group}支出</p><strong>¥{money(total)}</strong><small>{matching.length} 笔账单 · {breakdown.length} 个分类</small></section>
        <section className="category-detail-section"><h3>子分类分布</h3>{breakdown.map(([name, amount]) => <div key={name} className="category-detail-row"><span>{name}<small>{total ? (amount / total * 100).toFixed(1) : '0'}%</small></span><b>¥{money(amount)}</b></div>)}{!breakdown.length && <p>这个月还没有相关账单。</p>}</section>
        <section className="category-detail-section"><h3>全部账单</h3>{matching.map((record) => <div key={record.id} className="category-detail-row"><span>{record.note || record.category}<small>{record.date} · {record.category} · {record.account}</small></span><div className="category-detail-record-action"><b>¥{money(record.amount)}</b><button onClick={() => { close(); onEdit(record); }}>编辑</button></div></div>)}</section>
      </div>
    </div>
  </dialog>;
}
