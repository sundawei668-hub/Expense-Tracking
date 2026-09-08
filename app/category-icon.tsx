import type { CSSProperties } from 'react';

const shapes: Record<string, string> = {
  food: 'M4 10h16c0 6-3 9-8 9s-8-3-8-9Zm2-4 1-3m5 3 1-3m5 3 1-3M8 21h8',
  bus: 'M6 3h12a2 2 0 0 1 2 2v13H4V5a2 2 0 0 1 2-2ZM4 11h16M7 18v3m10-3v3M8 14h.01M16 14h.01',
  shopping: 'M2 3h3l3 12h11l3-9H6M9 20h.01M18 20h.01',
  film: 'M4 3h16v18H4ZM4 8h4m-4 8h4m8-8h4m-4 8h4M8 3v18m8-18v18',
  medical: 'M9 6V3h6v3M3 7h18v14H3ZM12 11v6m-3-3h6',
  home: 'm2 11 10-9 10 9M5 9v12h14V9M9 21v-8h6v8',
  gift: 'M3 8h18v5H3Zm2 5v8h14v-8M12 8v13M12 8C2 8 5 0 9 4Zm0 0c10 0 7-8 3-4Z',
  store: 'M3 9 5 3h14l2 6M3 9v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9ZM5 15v6h14v-6M9 21v-5h6v5',
  child: 'M9 3h6l3 4v5l-3 3H9l-3-3V7Zm-5 18v-2a5 5 0 0 1 5-4h6a5 5 0 0 1 5 4v2M9 9h.01M15 9h.01',
  wallet: 'M3 5h17v16H3ZM3 5V3h14M15 11h7v5h-7ZM18 13h.01',
  book: 'M12 5C8 2 4 2 2 3v17c4-1 7 0 10 2 3-2 6-3 10-2V3c-2-1-6-1-10 2Zm0 0v17',
  other: 'M5 12h.01M12 12h.01M19 12h.01',
};

export default function CategoryIcon({ name, className = '', style }: { name: string; className?: string; style?: CSSProperties }) {
  return <span className={`category-symbol ${className}`} style={style} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={shapes[name] ?? shapes.other} /></svg></span>;
}
