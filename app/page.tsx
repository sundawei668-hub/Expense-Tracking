'use client';

import { ChangeEvent, FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoCsvSetting,
  clearAutoCsvSetting,
  clearRememberedSession,
  clearRecords,
  getAutoCsvSetting,
  getAllRecords,
  getRememberedSession,
  lockDatabase,
  removeRecord,
  replaceRecords,
  saveAutoCsvSetting,
  saveRememberedSession,
  saveRecord,
  TransactionRecord,
  TransactionType,
  unlockDatabase,
  WritableFileHandle,
} from '@/lib/db';
import {
  createEncryptedBackup,
  createLocalAccount,
  decryptEncryptedBackup,
  EncryptedBackupFile,
  getLocalAccount,
  isEncryptedBackupFile,
  saveLocalAccount,
  verifyLocalAccount,
  verifyLocalAccountKey,
} from '@/lib/crypto';
import { buildRecordsCsv, parseRecordsCsv } from '@/lib/csv';

type Tab = 'add' | 'records' | 'stats' | 'settings';
type AuthState = 'checking' | 'setup' | 'locked' | 'unlocked';
type AutoCsvStatus = 'checking' | 'unsupported' | 'off' | 'ready' | 'permission' | 'error';
type AutoCsvSyncResult = 'saved' | 'daily-pending' | 'daily-current' | 'off' | 'permission' | 'failed';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface AutoCsvWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    startIn?: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<WritableFileHandle>;
}

const expenseCategories = [
  ['餐饮', '🥢'], ['交通', '🚇'], ['购物', '🛍'], ['居家', '⌂'],
  ['娱乐', '♪'], ['医疗', '✚'], ['教育', '书'], ['子女', '子'], ['其他', '•••'],
] as const;

const incomeCategories = [
  ['工资', '薪'], ['奖金', '奖'], ['理财', '↗'], ['报销', '票'], ['兼职', '工'], ['其他', '•••'],
] as const;

const accounts = ['微信支付', '支付宝', '银行卡', '现金', '信用卡'];
const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const DAILY_CSV_ENABLED_KEY = 'yi-ben-zhang-daily-csv-enabled';
const DAILY_CSV_LAST_DATE_KEY = 'yi-ben-zhang-daily-csv-last-date';

const categoryIcon = new Map<string, string>([...expenseCategories, ...incomeCategories]);

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonth() {
  return localDate().slice(0, 7);
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const today = localDate();
  if (value === today) return '今天';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === localDate(yesterday)) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}

async function writeRecordsCsv(handle: WritableFileHandle, records: TransactionRecord[]) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([buildRecordsCsv(records)], { type: 'text/csv;charset=utf-8' }));
  await writable.close();
}

function savedTimeLabel(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return '尚未保存';
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isValidRecordList(value: unknown): value is TransactionRecord[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((record) => {
    if (!record || typeof record !== 'object') return false;
    const item = record as Partial<TransactionRecord>;
    return typeof item.id === 'string' && item.id.length > 0
      && !ids.has(item.id) && Boolean(ids.add(item.id))
      && typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      && localDate(new Date(`${item.date}T00:00:00`)) === item.date
      && (item.type === 'expense' || item.type === 'income')
      && Number.isFinite(item.amount) && Number(item.amount) > 0
      && typeof item.category === 'string' && item.category.length > 0
      && typeof item.account === 'string' && item.account.length > 0
      && typeof item.note === 'string'
      && typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))
      && (item.updatedAt === undefined || (typeof item.updatedAt === 'string' && !Number.isNaN(Date.parse(item.updatedAt))));
  });
}

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('add');
  const [records, setRecords] = useState<TransactionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState('');
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('餐饮');
  const [account, setAccount] = useState(accounts[0]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(localDate());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [pendingBackup, setPendingBackup] = useState<EncryptedBackupFile | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [autoCsvSetting, setAutoCsvSetting] = useState<AutoCsvSetting | null>(null);
  const [autoCsvStatus, setAutoCsvStatus] = useState<AutoCsvStatus>('checking');
  const [autoCsvBusy, setAutoCsvBusy] = useState(false);
  const [dailyCsvEnabled, setDailyCsvEnabled] = useState(false);
  const [dailyCsvLastDate, setDailyCsvLastDate] = useState('');
  const [csvDownloadUrl, setCsvDownloadUrl] = useState('');
  const restoreInput = useRef<HTMLInputElement>(null);
  const csvRestoreInput = useRef<HTMLInputElement>(null);

  const refreshRecords = async () => {
    const latestRecords = await getAllRecords();
    setRecords(latestRecords);
    return latestRecords;
  };

  useEffect(() => {
    let cancelled = false;
    const initializeAccount = async () => {
      const accountConfig = getLocalAccount();
      if (!accountConfig) {
        if (!cancelled) setAuthState('setup');
        return;
      }

      setLoginName(accountConfig.username);
      try {
        const remembered = await getRememberedSession();
        if (
          remembered
          && remembered.username === accountConfig.username
          && remembered.expiresAt > Date.now()
          && await verifyLocalAccountKey(accountConfig, remembered.key)
        ) {
          await unlockDatabase(remembered.key);
          if (!cancelled) setAuthState('unlocked');
          return;
        }
        if (remembered) await clearRememberedSession();
      } catch {
        await clearRememberedSession().catch(() => undefined);
      }
      if (!cancelled) setAuthState('locked');
    };

    void initializeAccount();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authState !== 'unlocked') return;

    refreshRecords()
      .catch(() => showToast('本地账本读取失败，请刷新重试'))
      .finally(() => setReady(true));

    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      const serviceWorkerPath = new URL('sw.js', document.baseURI).pathname;
      navigator.serviceWorker.register(serviceWorkerPath).catch(() => undefined);
    }

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshRecords().catch(() => undefined);
      }
    };
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [authState]);

  useEffect(() => {
    if (authState !== 'unlocked') return;
    setDailyCsvEnabled(window.localStorage.getItem(DAILY_CSV_ENABLED_KEY) === '1');
    setDailyCsvLastDate(window.localStorage.getItem(DAILY_CSV_LAST_DATE_KEY) ?? '');
  }, [authState]);

  useEffect(() => {
    if (authState !== 'unlocked') {
      setCsvDownloadUrl('');
      return;
    }
    const url = URL.createObjectURL(new Blob([buildRecordsCsv(records)], { type: 'text/csv;charset=utf-8' }));
    setCsvDownloadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [authState, records]);

  useEffect(() => {
    if (authState !== 'unlocked') return;
    let cancelled = false;
    const loadAutoCsv = async () => {
      if (typeof (window as AutoCsvWindow).showSaveFilePicker !== 'function') {
        if (!cancelled) setAutoCsvStatus('unsupported');
        return;
      }
      try {
        const setting = await getAutoCsvSetting();
        if (cancelled) return;
        setAutoCsvSetting(setting);
        if (!setting) {
          setAutoCsvStatus('off');
          return;
        }
        const permission = await setting.handle.queryPermission({ mode: 'readwrite' });
        if (!cancelled) setAutoCsvStatus(permission === 'granted' ? 'ready' : 'permission');
      } catch {
        if (!cancelled) setAutoCsvStatus('error');
      }
    };
    void loadAutoCsv();
    return () => { cancelled = true; };
  }, [authState]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError('');
    try {
      const normalizedName = loginName.trim().toLowerCase();
      if (normalizedName.length < 2) {
        setLoginError('账号至少需要 2 个字符');
      } else if (authState === 'setup') {
        if (loginPassword.length < 10) {
          setLoginError('密码至少需要 10 个字符');
          return;
        }
        if (loginPassword !== confirmPassword) {
          setLoginError('两次输入的密码不一致');
          return;
        }
        const { config, key } = await createLocalAccount(normalizedName, loginPassword);
        saveLocalAccount(config);
        try {
          await unlockDatabase(key);
        } catch (error) {
          setAuthState('locked');
          throw error;
        }
        await saveRememberedSession(config.username, key, Date.now() + REMEMBER_DURATION_MS)
          .catch(() => showToast('本机不支持30天免登录'));
      } else {
        const key = await verifyLocalAccount(normalizedName, loginPassword);
        if (!key) {
          setLoginError('账号或密码不正确');
          return;
        }
        await unlockDatabase(key);
        await saveRememberedSession(normalizedName, key, Date.now() + REMEMBER_DURATION_MS)
          .catch(() => showToast('本机不支持30天免登录'));
      }
      setLoginPassword('');
      setConfirmPassword('');
      setAuthState('unlocked');
    } catch {
      setLoginError('加密账本无法打开，请确认浏览器支持本地加密');
    } finally {
      setLoginBusy(false);
    }
  };

  const logout = async () => {
    try {
      await clearRememberedSession();
    } catch {
      showToast('退出失败，请稍后重试');
      return;
    }
    lockDatabase();
    setRecords([]);
    setReady(false);
    setTab('add');
    setAuthState('locked');
  };

  const monthRecords = useMemo(
    () => records.filter((record) => record.date.startsWith(month)),
    [records, month],
  );

  const monthIncome = monthRecords
    .filter((record) => record.type === 'income')
    .reduce((sum, record) => sum + record.amount, 0);
  const monthExpense = monthRecords
    .filter((record) => record.type === 'expense')
    .reduce((sum, record) => sum + record.amount, 0);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      const monthMatches = !month || record.date.startsWith(month);
      const searchable = `${record.category} ${record.account} ${record.note}`.toLowerCase();
      return monthMatches && (!term || searchable.includes(term));
    });
  }, [records, month, search]);

  const categoryTotals = useMemo(() => {
    const totals = new Map<string, number>();
    monthRecords
      .filter((record) => record.type === 'expense')
      .forEach((record) => totals.set(record.category, (totals.get(record.category) ?? 0) + record.amount));
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthRecords]);

  const resetForm = () => {
    setAmount('');
    setNote('');
    setDate(localDate());
    setEditingId(null);
  };

  const changeType = (nextType: TransactionType) => {
    setType(nextType);
    setCategory(nextType === 'expense' ? expenseCategories[0][0] : incomeCategories[0][0]);
  };

  const syncAutoCsv = async (latestRecords: TransactionRecord[]): Promise<AutoCsvSyncResult> => {
    try {
      const setting = autoCsvSetting ?? await getAutoCsvSetting();
      if (!setting) {
        const dailyEnabled = dailyCsvEnabled || window.localStorage.getItem(DAILY_CSV_ENABLED_KEY) === '1';
        if (!dailyEnabled) return 'off';
        const lastDate = window.localStorage.getItem(DAILY_CSV_LAST_DATE_KEY) ?? dailyCsvLastDate;
        return lastDate === localDate() ? 'daily-current' : 'daily-pending';
      }
      setAutoCsvSetting(setting);
      const permission = await setting.handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const dailyEnabled = dailyCsvEnabled || window.localStorage.getItem(DAILY_CSV_ENABLED_KEY) === '1';
        if (dailyEnabled) {
          const lastDate = window.localStorage.getItem(DAILY_CSV_LAST_DATE_KEY) ?? dailyCsvLastDate;
          return lastDate === localDate() ? 'daily-current' : 'daily-pending';
        }
        setAutoCsvStatus('permission');
        return 'permission';
      }
      await writeRecordsCsv(setting.handle, latestRecords);
      const savedSetting = await saveAutoCsvSetting(setting.handle, new Date().toISOString());
      setAutoCsvSetting(savedSetting);
      setAutoCsvStatus('ready');
      return 'saved';
    } catch {
      setAutoCsvStatus('error');
      return 'failed';
    }
  };

  const autoCsvToast = (successMessage: string, result: AutoCsvSyncResult) => {
    if (result === 'daily-pending') {
      showToast(`${successMessage}；请到设置点“保存今天 CSV”`);
    } else {
      showToast(result === 'permission' || result === 'failed'
        ? `${successMessage}，但自动 CSV 未更新`
        : successMessage);
    }
  };

  const handleDailyCsvDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!csvDownloadUrl) {
      event.preventDefault();
      showToast('账本还在准备，请稍后再点一次');
      return;
    }
    const today = localDate();
    window.localStorage.setItem(DAILY_CSV_ENABLED_KEY, '1');
    window.localStorage.setItem(DAILY_CSV_LAST_DATE_KEY, today);
    setDailyCsvEnabled(true);
    setDailyCsvLastDate(today);
    showToast('已交给华为浏览器下载，请立即查看下载管理');
  };

  const handleCsvDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!csvDownloadUrl) {
      event.preventDefault();
      showToast('账本还在准备，请稍后再点一次');
      return;
    }
    showToast('已交给浏览器下载，请立即查看下载管理');
  };

  const disableDailyCsv = () => {
    window.localStorage.removeItem(DAILY_CSV_ENABLED_KEY);
    setDailyCsvEnabled(false);
    showToast('每日 CSV 自动备份已关闭');
  };

  const chooseAutoCsvFile = async () => {
    const pickerWindow = window as AutoCsvWindow;
    if (typeof pickerWindow.showSaveFilePicker !== 'function') {
      setAutoCsvStatus('unsupported');
      showToast('当前浏览器不支持固定 CSV 自动保存');
      return;
    }
    setAutoCsvBusy(true);
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: '一本账_自动保存.csv',
        startIn: 'documents',
        types: [{ description: 'CSV 表格', accept: { 'text/csv': ['.csv'] } }],
      });
      const latestRecords = await getAllRecords();
      await writeRecordsCsv(handle, latestRecords);
      const savedSetting = await saveAutoCsvSetting(handle, new Date().toISOString());
      setAutoCsvSetting(savedSetting);
      setAutoCsvStatus('ready');
      showToast('自动 CSV 已开启并完成首次保存');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setAutoCsvStatus('error');
      showToast('自动 CSV 开启失败，请重新选择文件');
    } finally {
      setAutoCsvBusy(false);
    }
  };

  const authorizeAndSyncAutoCsv = async () => {
    if (!autoCsvSetting) return;
    setAutoCsvBusy(true);
    try {
      const permission = await autoCsvSetting.handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        setAutoCsvStatus('permission');
        showToast('未获得 CSV 文件写入权限');
        return;
      }
      const latestRecords = await getAllRecords();
      const result = await syncAutoCsv(latestRecords);
      showToast(result === 'saved' ? 'CSV 已更新' : 'CSV 更新失败，请重新选择文件');
    } catch {
      setAutoCsvStatus('error');
      showToast('CSV 更新失败，请重新选择文件');
    } finally {
      setAutoCsvBusy(false);
    }
  };

  const stopAutoCsv = async () => {
    setAutoCsvBusy(true);
    try {
      await clearAutoCsvSetting();
      setAutoCsvSetting(null);
      setAutoCsvStatus('off');
      showToast('自动 CSV 已关闭，原文件仍保留');
    } catch {
      showToast('关闭失败，请稍后重试');
    } finally {
      setAutoCsvBusy(false);
    }
  };

  const submitRecord = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('请先输入正确的金额');
      return;
    }

    const existing = editingId ? records.find((record) => record.id === editingId) : undefined;
    const record: TransactionRecord = {
      id: editingId ?? crypto.randomUUID(),
      date,
      type,
      amount: Math.round(value * 100) / 100,
      category,
      account,
      note: note.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: editingId ? new Date().toISOString() : undefined,
    };

    try {
      await saveRecord(record);
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      autoCsvToast(editingId ? '账单已更新' : '已经记下这笔账', csvResult);
      resetForm();
    } catch {
      showToast('保存失败，请稍后重试');
    }
  };

  const editRecord = (record: TransactionRecord) => {
    setEditingId(record.id);
    setType(record.type);
    setAmount(String(record.amount));
    setCategory(record.category);
    setAccount(record.account);
    setNote(record.note);
    setDate(record.date);
    setTab('add');
  };

  const deleteRecord = async (record: TransactionRecord) => {
    if (!window.confirm(`确定删除“${record.note || record.category}”这笔账吗？`)) return;
    try {
      await removeRecord(record.id);
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      autoCsvToast('账单已删除', csvResult);
    } catch {
      showToast('删除失败，请稍后重试');
    }
  };

  const restoreCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('too-large');
      const restoredRecords = parseRecordsCsv(await file.text());
      if (!restoredRecords.length || !isValidRecordList(restoredRecords)) throw new Error('invalid');
      if (!window.confirm(`CSV 中有 ${restoredRecords.length} 笔账，将覆盖当前账本，是否继续？`)) return;
      await replaceRecords(restoredRecords);
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      autoCsvToast('CSV 恢复成功', csvResult);
    } catch {
      showToast('CSV 无法恢复，请确认文件来自一本账');
    }
  };

  const exportBackup = async () => {
    try {
      const latestRecords = await getAllRecords();
      setRecords(latestRecords);
      const backup = await createEncryptedBackup(latestRecords);
      downloadFile(`一本账加密备份_${localDate()}.json`, JSON.stringify(backup, null, 2), 'application/json');
      showToast('已发起加密备份下载，请到下载管理查看');
    } catch {
      showToast('备份失败，请稍后重试');
    }
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('too-large');
      const parsed = JSON.parse(await file.text()) as unknown;
      if (isEncryptedBackupFile(parsed)) {
        setPendingBackup(parsed);
        setRestorePassword('');
        setRestoreError('');
        return;
      }
      const legacy = parsed as { version?: number; records?: unknown };
      if (legacy.version !== 1 || !isValidRecordList(legacy.records)) throw new Error('invalid');
      if (!window.confirm(`这是旧版明文备份，共 ${legacy.records.length} 笔账。恢复后会自动加密，是否继续？`)) return;
      await replaceRecords(legacy.records);
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      autoCsvToast('旧版备份已恢复并加密', csvResult);
    } catch {
      showToast('这不是有效的一本账备份文件');
    }
  };

  const confirmEncryptedRestore = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingBackup) return;
    setRestoreBusy(true);
    setRestoreError('');
    try {
      const restoredRecords = await decryptEncryptedBackup(pendingBackup, restorePassword);
      if (!isValidRecordList(restoredRecords)) throw new Error('invalid');
      if (!window.confirm(`备份中有 ${restoredRecords.length} 笔账，将覆盖当前账本，是否继续？`)) return;
      await replaceRecords(restoredRecords);
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      setPendingBackup(null);
      setRestorePassword('');
      autoCsvToast('加密备份恢复成功', csvResult);
    } catch {
      setRestoreError('密码不正确，或备份文件已经损坏');
    } finally {
      setRestoreBusy(false);
    }
  };

  const eraseAll = async () => {
    if (!records.length) return;
    if (!window.confirm('确定清空全部账单吗？清空前建议先导出完整备份。')) return;
    try {
      await clearRecords();
      const latestRecords = await refreshRecords();
      const csvResult = await syncAutoCsv(latestRecords);
      autoCsvToast('账本已清空', csvResult);
    } catch {
      showToast('清空失败，请稍后重试');
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') showToast('已经添加到手机桌面');
    setInstallPrompt(null);
  };

  const categories = type === 'expense' ? expenseCategories : incomeCategories;
  const maximumCategory = categoryTotals[0]?.[1] ?? 1;

  if (authState === 'checking') {
    return <main className="auth-shell"><div className="auth-loading">正在打开一本账…</div></main>;
  }

  if (authState === 'locked' || authState === 'setup') {
    const isSetup = authState === 'setup';
    return (
      <main className="auth-shell">
        <section className="login-card" aria-labelledby="login-title">
          <span className="login-mark">账</span>
          <p className="eyebrow">本地加密账本</p>
          <h1 id="login-title">{isSetup ? '设置本地账户' : '解锁一本账'}</h1>
          <p className="login-intro">{isSetup ? '账户只保存在这台设备，用于加密你的账目。' : '输入本机账户密码，解密并打开账本。'}</p>
          <form onSubmit={submitLogin}>
            <label>
              <span>账号</span>
              <input
                autoComplete="username"
                autoCapitalize="none"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
                placeholder="请输入账号"
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="请输入密码"
                required
              />
            </label>
            {isSetup && (
              <label>
                <span>确认密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                  required
                />
              </label>
            )}
            {loginError && <p className="login-error" role="alert">{loginError}</p>}
            <button type="submit" disabled={loginBusy}>{loginBusy ? '正在处理…' : isSetup ? '创建并加密账本' : '解锁账本'}</button>
          </form>
          {isSetup && <p className="setup-warning">请把密码保存在安全位置。密码不会上传，也无法找回；忘记密码将无法恢复账目。</p>}
          <p className="login-privacy">AES-256 本地加密 · 密码不会上传 · 本机保持解锁30天</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="phone-stage">
        <div className="screen-scroll">
          <header className="topbar">
            <div>
              <p className="eyebrow">{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
              <h1>{tab === 'add' ? `你好，${getLocalAccount()?.username ?? '你'}` : tab === 'records' ? '收支明细' : tab === 'stats' ? '月度统计' : '账本设置'}</h1>
            </div>
            <button className="avatar" aria-label="进入设置" onClick={() => setTab('settings')}>账</button>
          </header>

          {tab === 'add' && (
            <>
              <section className="month-card" aria-label="本月收支概览">
                <div>
                  <p>本月结余</p>
                  <strong>¥ {money(monthIncome - monthExpense)}</strong>
                </div>
                <div className="month-stats">
                  <span><i className="income-dot" />收入 ¥{money(monthIncome)}</span>
                  <span><i className="expense-dot" />支出 ¥{money(monthExpense)}</span>
                </div>
              </section>

              <form className="entry-card" onSubmit={submitRecord}>
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">{editingId ? '修改账单' : '快速记录'}</p>
                    <h2>{editingId ? '编辑这一笔' : '记一笔'}</h2>
                  </div>
                  <div className="type-switch" aria-label="收支类型">
                    <button type="button" className={type === 'expense' ? 'active' : ''} onClick={() => changeType('expense')}>支出</button>
                    <button type="button" className={type === 'income' ? 'active' : ''} onClick={() => changeType('income')}>收入</button>
                  </div>
                </div>

                <label className="amount-field">
                  <span>¥</span>
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="金额"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                  />
                </label>

                <div className="categories" aria-label="选择分类">
                  {categories.map(([name, icon]) => (
                    <button
                      type="button"
                      key={name}
                      className={category === name ? 'category active' : 'category'}
                      onClick={() => setCategory(name)}
                    >
                      <span className={name === '其他' ? 'more-dots' : undefined}>{icon}</span>{name}
                    </button>
                  ))}
                </div>

                <div className="entry-details">
                  <label>
                    <span>◫</span><b>账户</b>
                    <select value={account} onChange={(event) => setAccount(event.target.value)}>
                      {accounts.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>◷</span><b>日期</b>
                    <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  </label>
                  <label>
                    <span>✎</span><b>备注</b>
                    <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="写点什么…" maxLength={80} />
                  </label>
                </div>

                <button className="save-button" type="submit">
                  {editingId ? '保存修改' : `保存这笔${type === 'expense' ? '支出' : '收入'}`}
                </button>
                {editingId && <button type="button" className="cancel-button" onClick={resetForm}>取消修改</button>}
                <p className="local-note">数据仅保存在你的设备中</p>
              </form>
            </>
          )}

          {tab === 'records' && (
            <section className="page-panel">
              <div className="filter-row">
                <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索分类、账户或备注" /></label>
                <input className="month-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              </div>
              <div className="mini-summary">
                <span>收入 <b className="income-text">+¥{money(monthIncome)}</b></span>
                <span>支出 <b>-¥{money(monthExpense)}</b></span>
              </div>
              {!ready ? (
                <div className="empty-state"><span>⌛</span><h3>正在打开账本</h3></div>
              ) : filteredRecords.length === 0 ? (
                <div className="empty-state"><span>册</span><h3>这里还没有账单</h3><p>记下第一笔之后，明细会按时间出现在这里。</p><button onClick={() => setTab('add')}>去记一笔</button></div>
              ) : (
                <div className="record-list">
                  {filteredRecords.map((record) => (
                    <article className="record-item" key={record.id}>
                      <div className={`record-icon ${record.type}`}>{categoryIcon.get(record.category) ?? '•'}</div>
                      <div className="record-copy">
                        <strong>{record.note || record.category}</strong>
                        <span>{dateLabel(record.date)} · {record.category} · {record.account}</span>
                      </div>
                      <div className="record-actions">
                        <b className={record.type}>{record.type === 'expense' ? '-' : '+'}¥{money(record.amount)}</b>
                        <span><button onClick={() => editRecord(record)}>编辑</button><button onClick={() => deleteRecord(record)}>删除</button></span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'stats' && (
            <section className="page-panel stats-panel">
              <div className="section-title-row">
                <div><p className="eyebrow">分类统计</p><h2>{month.replace('-', '年')}月</h2></div>
                <input className="month-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              </div>
              <div className="stat-cards">
                <article><span>本月收入</span><strong className="income-text">¥{money(monthIncome)}</strong></article>
                <article><span>本月支出</span><strong>¥{money(monthExpense)}</strong></article>
              </div>
              <div className="balance-strip"><span>本月结余</span><strong>¥{money(monthIncome - monthExpense)}</strong></div>
              <div className="category-chart">
                <div className="chart-heading"><h3>支出去向</h3><span>{monthRecords.filter((record) => record.type === 'expense').length} 笔</span></div>
                {categoryTotals.length === 0 ? (
                  <div className="empty-state compact"><span>◎</span><p>本月还没有支出数据</p></div>
                ) : categoryTotals.map(([name, total]) => (
                  <div className="bar-row" key={name}>
                    <span className="bar-icon">{categoryIcon.get(name) ?? '•'}</span>
                    <div><p><b>{name}</b><em>¥{money(total)}</em></p><i><span style={{ width: `${Math.max(7, (total / maximumCategory) * 100)}%` }} /></i></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === 'settings' && (
            <section className="page-panel settings-panel">
              <div className="local-card">
                <span className="shield">✓</span>
                <div><p className="eyebrow">本地加密账本</p><h2>你的数据，只属于你</h2><p>当前设备共保存 {records.length} 笔账。账目使用 AES-256 加密，不会上传服务器。</p></div>
              </div>

              <div className="setting-group">
                <h3>导出与备份</h3>
                <a className="download-action" href={csvDownloadUrl || '#'} download={`一本账_${localDate()}.csv`} onClick={handleCsvDownload}><span>表</span><div><b>导出 CSV（明文）</b><small>直接点击真实下载链接，兼容华为浏览器</small></div><em>›</em></a>
                <button onClick={() => csvRestoreInput.current?.click()}><span>入</span><div><b>从 CSV 恢复</b><small>浏览器数据被清理后，可把自动保存的账目导回来</small></div><em>›</em></button>
                <input ref={csvRestoreInput} hidden type="file" accept="text/csv,.csv" onChange={restoreCsv} />
                <button onClick={exportBackup}><span>存</span><div><b>导出加密备份</b><small>可安全保存到百度网盘，恢复时需要密码</small></div><em>›</em></button>
                <button onClick={() => restoreInput.current?.click()}><span>复</span><div><b>恢复完整备份</b><small>支持加密备份和旧版明文备份</small></div><em>›</em></button>
                <input ref={restoreInput} hidden type="file" accept="application/json,.json" onChange={restoreBackup} />
              </div>

              <div className="setting-group">
                <h3>固定 CSV 自动保存（明文）</h3>
                <div className={`auto-csv-status ${autoCsvStatus}`}>
                  <span>{autoCsvStatus === 'ready' ? '✓' : autoCsvStatus === 'unsupported' ? '×' : '表'}</span>
                  <div>
                    <b>{autoCsvStatus === 'ready'
                      ? '自动保存已开启'
                      : autoCsvStatus === 'unsupported'
                        ? '当前浏览器不支持'
                        : autoCsvStatus === 'permission'
                          ? '需要重新授权文件'
                          : autoCsvStatus === 'error'
                            ? '自动保存需要检查'
                            : autoCsvStatus === 'checking' ? '正在检查…' : '自动保存未开启'}</b>
                    <p>{autoCsvSetting
                      ? `${autoCsvSetting.handle.name} · 上次保存 ${savedTimeLabel(autoCsvSetting.lastSavedAt)}`
                      : autoCsvStatus === 'unsupported'
                        ? '请使用较新的安卓 Chrome 打开网页'
                        : '开启后，每次账目变化都会覆盖更新同一个 CSV 文件'}</p>
                  </div>
                </div>
                {autoCsvStatus !== 'unsupported' && (
                  <button
                    onClick={autoCsvSetting ? authorizeAndSyncAutoCsv : chooseAutoCsvFile}
                    disabled={autoCsvBusy || autoCsvStatus === 'checking'}
                  >
                    <span>{autoCsvSetting ? '更' : '开'}</span>
                    <div><b>{autoCsvSetting ? '立即授权并更新 CSV' : '选择 CSV 文件并开启'}</b><small>{autoCsvSetting ? '权限失效时也可点击这里恢复' : '第一次需要选择手机中的保存位置'}</small></div><em>›</em>
                  </button>
                )}
                {autoCsvSetting && (
                  <>
                    <button onClick={chooseAutoCsvFile} disabled={autoCsvBusy}><span>换</span><div><b>更换自动保存文件</b><small>选择另一个 CSV 文件作为最新副本</small></div><em>›</em></button>
                    <button onClick={stopAutoCsv} disabled={autoCsvBusy}><span>停</span><div><b>关闭自动保存</b><small>只取消自动更新，不会删除已经保存的 CSV</small></div><em>›</em></button>
                  </>
                )}
              </div>

              <div className="setting-group">
                <h3>华为浏览器每日 CSV 提醒（明文）</h3>
                <div className={`auto-csv-status ${dailyCsvEnabled ? 'ready' : 'off'}`}>
                  <span>{dailyCsvEnabled ? '✓' : '日'}</span>
                  <div>
                    <b>{dailyCsvEnabled ? '每日保存提醒已开启' : '每日保存提醒未开启'}</b>
                    <p>{dailyCsvEnabled
                      ? dailyCsvLastDate === localDate()
                        ? '今天已点击过下载；请在下载管理中确认文件存在'
                        : '今天尚未点击保存；记账后会提醒你来这里下载'
                      : '华为浏览器会拦截自动下载，因此每天提醒你直接点击保存'}</p>
                  </div>
                </div>
                <div className="install-tip">
                  <b>文件名：一本账每日备份_日期.csv</b>
                  <p>请直接点击下面的真实下载链接，然后立即到浏览器“下载管理”确认。网页不能指定华为手机的专用文件夹。</p>
                </div>
                <a
                  className="download-action"
                  href={csvDownloadUrl || '#'}
                  download={`一本账每日备份_${localDate()}.csv`}
                  onClick={handleDailyCsvDownload}
                  aria-disabled={!csvDownloadUrl}
                >
                  <span>{dailyCsvEnabled ? '下' : '开'}</span>
                  <div>
                    <b>{dailyCsvEnabled ? '保存今天 CSV' : '开启提醒并保存今天 CSV'}</b>
                    <small>{dailyCsvEnabled ? '直接下载当前完整账本，可重复点击更新' : '首次点击会同时开启每日保存提醒'}</small>
                  </div>
                  <em>›</em>
                </a>
                {dailyCsvEnabled && (
                  <button onClick={disableDailyCsv} disabled={autoCsvBusy}><span>停</span><div><b>关闭每日 CSV 备份</b><small>不会删除手机中已经下载的备份文件</small></div><em>›</em></button>
                )}
              </div>

              <div className="setting-group">
                <h3>手机使用</h3>
                {installPrompt ? (
                  <button onClick={installApp}><span>＋</span><div><b>添加到手机桌面</b><small>像普通 App 一样快速打开</small></div><em>›</em></button>
                ) : (
                  <div className="install-tip"><b>添加到桌面</b><p>在手机浏览器菜单中选择“添加到主屏幕”或“安装应用”。</p></div>
                )}
              </div>

              <div className="setting-group danger-zone">
                <h3>账本管理</h3>
                <button onClick={eraseAll} disabled={!records.length}><span>!</span><div><b>清空全部账单</b><small>此操作无法撤销，请先备份</small></div><em>›</em></button>
              </div>
              <div className="setting-group">
                <h3>账号</h3>
                <button onClick={logout}><span>退</span><div><b>退出登录</b><small>立即锁定并清除30天免登录</small></div><em>›</em></button>
              </div>
              <p className="version-note">一本账 1.6 · 本地加密 · 华为 CSV 下载修复 · 无广告 · 无追踪</p>
            </section>
          )}
        </div>

        <nav className="bottom-nav" aria-label="主要导航">
          <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}><span>＋</span>记账</button>
          <button className={tab === 'records' ? 'active' : ''} onClick={() => setTab('records')}><span>≡</span>明细</button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}><span>▥</span>统计</button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><span>⚙</span>设置</button>
        </nav>
        {toast && <div className="toast" role="status">{toast}</div>}
      </section>

      {pendingBackup && (
        <div className="restore-overlay" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <form className="restore-card" onSubmit={confirmEncryptedRestore}>
            <span className="login-mark">复</span>
            <p className="eyebrow">加密备份</p>
            <h2 id="restore-title">输入备份密码</h2>
            <p>请输入导出这个备份时使用的本地账户密码。</p>
            <label>
              <span>备份密码</span>
              <input type="password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} autoComplete="off" required autoFocus />
            </label>
            {restoreError && <p className="login-error" role="alert">{restoreError}</p>}
            <button type="submit" disabled={restoreBusy}>{restoreBusy ? '正在解密…' : '解密并恢复'}</button>
            <button type="button" className="restore-cancel" onClick={() => setPendingBackup(null)}>取消</button>
          </form>
        </div>
      )}

      <aside className="desktop-note">
        <span className="brand-mark">账</span>
        <p className="eyebrow">一本属于自己的账</p>
        <h2>每一笔，都掌握在自己手里。</h2>
        <p>无广告、无会员、本地加密。手机快速记录，数据留在设备，备份后随时带走。</p>
        <div className="privacy-pill">AES-256 加密 · 加密备份 · 离线可用</div>
      </aside>
    </main>
  );
}
