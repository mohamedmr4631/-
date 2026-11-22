import {
  DEFAULT_HR_POLICY,
  SCHEMA_LIMITS,
  type AttendanceLog,
  type AttendanceRequest,
  type AttendanceRequestStatus,
  type AttendanceRequestType,
  type Branch,
  type BranchSettings,
  type Employee,
} from '../types/attendance';

export interface EffectiveHrPolicy {
  branchId: string | null;
  branchName: string;
  allowedIp: string;
  geoEnabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  shiftName: string | null;
  shiftStart: string;
  shiftEnd: string | null;
  graceMinutes: number;
  maxBreakMinutes: number;
  targetDailyHours: number;
  hourlyRate: number | null;
}

export function toLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveEmployeeBranch(
  emp: Employee | null | undefined,
  branches: Branch[] = []
): Branch | null {
  if (!emp?.branchId) return null;
  return branches.find((b) => b.id === emp.branchId) ?? null;
}

export function getEmployeePolicy(
  emp: Employee | null | undefined,
  branchSettings: BranchSettings,
  branches: Branch[] = []
): EffectiveHrPolicy {
  const assignedBranch = resolveEmployeeBranch(emp, branches);
  const assignedShift =
    assignedBranch && emp?.shiftId
      ? assignedBranch.shifts.find((s) => s.id === emp.shiftId) ?? null
      : null;

  const rawShiftStart =
    emp?.shiftStart ||
    assignedShift?.startTime ||
    assignedBranch?.shiftStart ||
    branchSettings.shiftStart ||
    DEFAULT_HR_POLICY.SHIFT_START;
  const shiftStart = SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(rawShiftStart)
    ? rawShiftStart
    : DEFAULT_HR_POLICY.SHIFT_START;

  const rawShiftEnd = emp?.shiftEnd || assignedShift?.endTime || null;
  const shiftEnd =
    rawShiftEnd && SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(rawShiftEnd)
      ? rawShiftEnd
      : null;

  const rawGrace =
    typeof emp?.graceMinutes === 'number'
      ? emp.graceMinutes
      : typeof assignedBranch?.graceMinutes === 'number'
        ? assignedBranch.graceMinutes
        : typeof branchSettings.graceMinutes === 'number'
          ? branchSettings.graceMinutes
          : DEFAULT_HR_POLICY.GRACE_MINUTES;
  const graceMinutes = Math.min(240, Math.max(0, Math.round(rawGrace)));

  const rawMaxBreak =
    typeof emp?.maxBreakMinutes === 'number'
      ? emp.maxBreakMinutes
      : typeof assignedBranch?.maxBreakMinutes === 'number'
        ? assignedBranch.maxBreakMinutes
        : typeof branchSettings.maxBreakMinutes === 'number'
          ? branchSettings.maxBreakMinutes
          : DEFAULT_HR_POLICY.MAX_BREAK_MINUTES;
  const maxBreakMinutes = Math.min(240, Math.max(1, Math.round(rawMaxBreak)));

  const rawTargetHours =
    typeof emp?.targetDailyHours === 'number'
      ? emp.targetDailyHours
      : typeof assignedBranch?.targetDailyHours === 'number'
        ? assignedBranch.targetDailyHours
        : typeof branchSettings.targetDailyHours === 'number'
          ? branchSettings.targetDailyHours
          : DEFAULT_HR_POLICY.TARGET_DAILY_HOURS;
  const targetDailyHours = Math.min(24, Math.max(1, Number(rawTargetHours)));

  const hourlyRate =
    typeof emp?.hourlyRate === 'number' && emp.hourlyRate >= 0
      ? emp.hourlyRate
      : null;

  return {
    branchId: assignedBranch?.id ?? emp?.branchId ?? null,
    branchName:
      assignedBranch?.name ?? emp?.branchName ?? branchSettings.branchName,
    allowedIp: assignedBranch
      ? assignedBranch.allowedIp
      : branchSettings.allowedIp,
    geoEnabled: Boolean(
      assignedBranch?.geoEnabled &&
        typeof assignedBranch.lat === 'number' &&
        typeof assignedBranch.lng === 'number'
    ),
    lat: assignedBranch?.lat ?? null,
    lng: assignedBranch?.lng ?? null,
    radiusMeters:
      typeof assignedBranch?.radiusMeters === 'number'
        ? assignedBranch.radiusMeters
        : DEFAULT_HR_POLICY.RADIUS_METERS,
    shiftName: assignedShift?.name ?? emp?.shiftName ?? null,
    shiftStart,
    shiftEnd,
    graceMinutes,
    maxBreakMinutes,
    targetDailyHours,
    hourlyRate,
  };
}

export function getShiftStartMsForDate(dateYYYYMMDD: string, shiftStartHHMM: string): number {
  const safeTime = SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(shiftStartHHMM)
    ? shiftStartHHMM
    : DEFAULT_HR_POLICY.SHIFT_START;
  const [hh, mm] = safeTime.split(':').map(Number);
  const [y, m, d] = dateYYYYMMDD.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

export function computeLateMinutes(
  checkInMs: number,
  shiftStartHHMM: string,
  graceMinutes: number
): number {
  const dateKey = toLocalDateInput(new Date(checkInMs));
  const shiftStartMs = getShiftStartMsForDate(dateKey, shiftStartHHMM);
  const diffMin = Math.floor((checkInMs - shiftStartMs) / 60_000);
  if (diffMin <= graceMinutes) return 0;
  return diffMin;
}

export function computeBreakOverageMinutes(
  totalBreakMs: number,
  maxBreakMinutes: number
): number {
  const allowedMs = maxBreakMinutes * 60_000;
  if (totalBreakMs <= allowedMs) return 0;
  return Math.max(1, Math.floor((totalBreakMs - allowedMs) / 60_000));
}

export function formatSignedHoursDiff(diffHours: number): string {
  const rounded = Math.round(diffHours * 100) / 100;
  if (Math.abs(rounded) < 0.01) return '0.00';
  return rounded > 0 ? `+${rounded.toFixed(2)}` : rounded.toFixed(2);
}

const REQ_TYPE_LABELS: Record<AttendanceRequestType, string> = {
  missed_check_in: 'إضافة دخول منسي',
  missed_check_out: 'إضافة خروج منسي',
  late_excuse: 'استئذان تأخر',
  early_leave: 'استئذان خروج مبكر',
  leave: 'طلب إجازة',
};

export function getAttendanceRequestTypeLabelAr(type: AttendanceRequestType): string {
  return REQ_TYPE_LABELS[type] ?? type;
}

const REQ_STATUS_LABELS: Record<AttendanceRequestStatus, string> = {
  pending: 'قيد المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
};

export function getAttendanceRequestStatusLabelAr(status: AttendanceRequestStatus): string {
  return REQ_STATUS_LABELS[status] ?? status;
}

export interface LiveEmployeeInsights {
  policy: EffectiveHrPolicy;
  liveBreakMs: number;
  netWorkMs: number;
  breakOverageMinutes: number;
  isBreakExceeded: boolean;
  hasCheckedInToday: boolean;
  todayFirstCheckInMs: number | null;
  lateMinutes: number;
  isAbsent: boolean;
  hasApprovedLeaveToday: boolean;
  hasApprovedLateExcuseToday: boolean;
}

export function computeLiveEmployeeInsights(
  emp: Employee,
  branchSettings: BranchSettings,
  logs: AttendanceLog[],
  attendanceRequests: AttendanceRequest[],
  nowMs: number,
  branches: Branch[] = []
): LiveEmployeeInsights {
  const policy = getEmployeePolicy(emp, branchSettings, branches);
  const todayStr = toLocalDateInput(new Date(nowMs));

  const baseBreak = emp.totalBreakMs || 0;
  const liveBreakMs =
    emp.status === 'break' && emp.lastBreakStart
      ? baseBreak + Math.max(0, nowMs - emp.lastBreakStart)
      : baseBreak;

  let netWorkMs = 0;
  if (emp.status === 'working' || emp.status === 'break') {
    if (emp.lastCheckIn) {
      netWorkMs = Math.max(0, nowMs - emp.lastCheckIn - liveBreakMs);
    }
  } else if (emp.lastCheckIn) {
    if (typeof emp.lastCheckOut === 'number' && emp.lastCheckOut >= emp.lastCheckIn) {
      netWorkMs = Math.max(0, emp.lastCheckOut - emp.lastCheckIn - liveBreakMs);
    } else {
      const matchingCheckOut = logs.find(
        (l) =>
          l.employeeId === emp.id &&
          l.action === 'check_out' &&
          l.timestamp &&
          l.timestamp.toMillis() >= emp.lastCheckIn!
      );
      if (matchingCheckOut?.timestamp) {
        netWorkMs = Math.max(
          0,
          matchingCheckOut.timestamp.toMillis() - emp.lastCheckIn - liveBreakMs
        );
      }
    }
  }

  const breakOverageMinutes = computeBreakOverageMinutes(
    liveBreakMs,
    policy.maxBreakMinutes
  );
  const isBreakExceeded = breakOverageMinutes > 0;

  let todayFirstCheckInMs: number | null = null;
  if (emp.lastCheckIn && toLocalDateInput(new Date(emp.lastCheckIn)) === todayStr) {
    todayFirstCheckInMs = emp.lastCheckIn;
  }
  logs.forEach((l) => {
    if (l.employeeId === emp.id && l.action === 'check_in' && l.timestamp) {
      const t = l.timestamp.toMillis();
      if (toLocalDateInput(new Date(t)) === todayStr) {
        if (todayFirstCheckInMs === null || t < todayFirstCheckInMs) {
          todayFirstCheckInMs = t;
        }
      }
    }
  });

  const hasCheckedInToday = todayFirstCheckInMs !== null || emp.status !== 'out';

  const hasApprovedLeaveToday = attendanceRequests.some(
    (r) =>
      r.employeeId === emp.id &&
      r.status === 'approved' &&
      r.type === 'leave' &&
      r.targetDate === todayStr
  );

  const hasApprovedLateExcuseToday = attendanceRequests.some(
    (r) =>
      r.employeeId === emp.id &&
      r.status === 'approved' &&
      r.type === 'late_excuse' &&
      r.targetDate === todayStr
  );

  const lateMinutes =
    todayFirstCheckInMs !== null && !hasApprovedLateExcuseToday
      ? computeLateMinutes(todayFirstCheckInMs, policy.shiftStart, policy.graceMinutes)
      : 0;

  const shiftDeadlineMs =
    getShiftStartMsForDate(todayStr, policy.shiftStart) + policy.graceMinutes * 60_000;
  const isAbsent =
    emp.isActive &&
    !hasCheckedInToday &&
    !hasApprovedLeaveToday &&
    nowMs > shiftDeadlineMs;

  return {
    policy,
    liveBreakMs,
    netWorkMs,
    breakOverageMinutes,
    isBreakExceeded,
    hasCheckedInToday,
    todayFirstCheckInMs,
    lateMinutes,
    isAbsent,
    hasApprovedLeaveToday,
    hasApprovedLateExcuseToday,
  };
}
