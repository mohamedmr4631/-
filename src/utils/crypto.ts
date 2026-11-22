import type { AttendanceLog } from '../types/attendance';

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashEmployeePin(employeeId: string, pin: string): Promise<string> {
  return sha256Hex(`${employeeId}:${pin.trim()}`);
}

export async function hashAdminPasscode(passcode: string): Promise<string> {
  return sha256Hex(`admin_secret:${passcode.trim()}`);
}

const DEVICE_STORAGE_KEY = 'attendance_device_id';

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!id || id.length < 8 || id.length > 80) {
      id = `dev_${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `dev_${crypto.randomUUID()}`;
  }
}

export function formatDurationAr(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (minutes > 0) {
    return `${minutes} د ${seconds} ث`;
  }
  return `${seconds} ث`;
}

export function formatTimestampAr(msOrDate: number | Date | null | undefined): string {
  if (!msOrDate) return '—';
  const d = typeof msOrDate === 'number' ? new Date(msOrDate) : msOrDate;
  return d.toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTimeAr(msOrDate: number | Date | null | undefined): string {
  if (!msOrDate) return '—';
  const d = typeof msOrDate === 'number' ? new Date(msOrDate) : msOrDate;
  return d.toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const ACTION_LABELS_AR: Record<AttendanceLog['action'], string> = {
  check_in: 'تسجيل دخول',
  break_start: 'بدء بريك',
  break_end: 'عودة من بريك',
  check_out: 'تسجيل خروج',
};

export function getActionLabelAr(action: AttendanceLog['action']): string {
  return ACTION_LABELS_AR[action] ?? action;
}

export function exportLogsToCsv(logs: AttendanceLog[]): void {
  const headers = ['الموظف', 'الحركة', 'الوقت والتاريخ', 'عنوان IP', 'معرف الجهاز'];
  const escapeCell = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const rows = logs.map((log) => {
    const timeStr = log.timestamp ? formatDateTimeAr(log.timestamp.toDate()) : '—';
    return [
      escapeCell(log.employeeName),
      escapeCell(getActionLabelAr(log.action)),
      escapeCell(timeStr),
      escapeCell(log.ip || '—'),
      escapeCell(log.deviceId || '—'),
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface EmployeeSummaryRow {
  name: string;
  roleTitle: string;
  statusLabel: string;
  totalBreakFormatted: string;
  netWorkFormatted: string;
  deviceStatus: string;
}

export function exportSummaryCsv(rowsData: EmployeeSummaryRow[]): void {
  const headers = [
    'الاسم',
    'المسمى الوظيفي',
    'الحالة',
    'إجمالي البريك',
    'صافي ساعات العمل',
    'الجهاز',
  ];
  const escapeCell = (val: string) => `"${val.replace(/"/g, '""')}"`;

  const rows = rowsData.map((row) =>
    [
      escapeCell(row.name),
      escapeCell(row.roleTitle || '—'),
      escapeCell(row.statusLabel),
      escapeCell(row.totalBreakFormatted),
      escapeCell(row.netWorkFormatted),
      escapeCell(row.deviceStatus),
    ].join(',')
  );

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hours-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface PeriodReportRow {
  employeeId: string;
  name: string;
  roleTitle: string;
  attendanceDays: number;
  completedShifts: number;
  breakCount: number;
  totalBreakMs: number;
  totalBreakFormatted: string;
  breakOverageDays: number;
  totalLateMinutes: number;
  totalNetWorkMs: number;
  netWorkFormatted: string;
  netWorkDecimalHours: string;
  overtimeDiffFormatted: string;
  estimatedPayFormatted: string;
}

export function exportPeriodReportCsv(
  rowsData: PeriodReportRow[],
  fromDate: string,
  toDate: string,
  employeeLabel?: string
): void {
  const headers = [
    'اسم الموظف',
    'المسمى الوظيفي',
    'من تاريخ',
    'إلى تاريخ',
    'أيام الحضور',
    'الورديات المكتملة',
    'مرات البريك',
    'إجمالي البريك',
    'أيام تجاوز البريك',
    'إجمالي التأخير (دقيقة)',
    'صافي ساعات العمل',
    'صافي الساعات (عشري)',
    'إضافي / فرق الساعات',
    'الراتب التقديري',
  ];
  const escapeCell = (val: string | number) =>
    `"${String(val).replace(/"/g, '""')}"`;

  const rows = rowsData.map((row) =>
    [
      escapeCell(row.name),
      escapeCell(row.roleTitle || '—'),
      escapeCell(fromDate),
      escapeCell(toDate),
      escapeCell(row.attendanceDays),
      escapeCell(row.completedShifts),
      escapeCell(row.breakCount),
      escapeCell(row.totalBreakFormatted),
      escapeCell(row.breakOverageDays),
      escapeCell(row.totalLateMinutes),
      escapeCell(row.netWorkFormatted),
      escapeCell(row.netWorkDecimalHours),
      escapeCell(row.overtimeDiffFormatted),
      escapeCell(row.estimatedPayFormatted),
    ].join(',')
  );

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = employeeLabel ? `-${employeeLabel}` : '';
  link.download = `period-report${suffix}-${fromDate}-to-${toDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface PeriodDailyRow {
  rowKey: string;
  date: string;
  employeeId: string;
  name: string;
  roleTitle: string;
  firstCheckInFormatted: string;
  lastCheckOutFormatted: string;
  completedShifts: number;
  breakCount: number;
  totalBreakMs: number;
  totalBreakFormatted: string;
  breakOverageMinutes: number;
  lateMinutes: number;
  totalNetWorkMs: number;
  netWorkFormatted: string;
  netWorkDecimalHours: string;
  overtimeDiffFormatted: string;
  estimatedPayFormatted: string;
}

export function exportPeriodDailyCsv(
  rowsData: PeriodDailyRow[],
  fromDate: string,
  toDate: string,
  employeeLabel?: string
): void {
  const headers = [
    'التاريخ',
    'اسم الموظف',
    'المسمى الوظيفي',
    'أول حضور',
    'آخر انصراف',
    'التأخير (دقيقة)',
    'مرات البريك',
    'إجمالي البريك',
    'تجاوز البريك (دقيقة)',
    'صافي ساعات العمل',
    'صافي الساعات (عشري)',
    'إضافي / فرق الساعات',
    'الراتب التقديري',
  ];
  const escapeCell = (val: string | number) =>
    `"${String(val).replace(/"/g, '""')}"`;

  const rows = rowsData.map((row) =>
    [
      escapeCell(row.date),
      escapeCell(row.name),
      escapeCell(row.roleTitle || '—'),
      escapeCell(row.firstCheckInFormatted),
      escapeCell(row.lastCheckOutFormatted),
      escapeCell(row.lateMinutes),
      escapeCell(row.breakCount),
      escapeCell(row.totalBreakFormatted),
      escapeCell(row.breakOverageMinutes),
      escapeCell(row.netWorkFormatted),
      escapeCell(row.netWorkDecimalHours),
      escapeCell(row.overtimeDiffFormatted),
      escapeCell(row.estimatedPayFormatted),
    ].join(',')
  );

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = employeeLabel ? `-${employeeLabel}` : '';
  link.download = `daily-report${suffix}-${fromDate}-to-${toDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface PeriodDetailedRow {
  id: string;
  date: string;
  timeFormatted: string;
  dateTimeFormatted: string;
  employeeId: string;
  employeeName: string;
  action: AttendanceLog['action'];
  actionLabel: string;
  ip: string;
  deviceId: string;
}

export function exportPeriodDetailedCsv(
  rowsData: PeriodDetailedRow[],
  fromDate: string,
  toDate: string,
  employeeLabel?: string
): void {
  const headers = [
    'التاريخ',
    'الوقت',
    'الموظف',
    'الحركة',
    'عنوان IP',
    'معرف الجهاز',
  ];
  const escapeCell = (val: string | number) =>
    `"${String(val).replace(/"/g, '""')}"`;

  const rows = rowsData.map((row) =>
    [
      escapeCell(row.date),
      escapeCell(row.timeFormatted),
      escapeCell(row.employeeName),
      escapeCell(row.actionLabel),
      escapeCell(row.ip),
      escapeCell(row.deviceId),
    ].join(',')
  );

  const csvContent = '\uFEFF' + [headers.map(escapeCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = employeeLabel ? `-${employeeLabel}` : '';
  link.download = `detailed-logs${suffix}-${fromDate}-to-${toDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function playNotificationChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [587.33, 880]; // D5 -> A5 gentle chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.3);
    });
  } catch {
    // Ignore audio context autoplay restrictions
  }
}
