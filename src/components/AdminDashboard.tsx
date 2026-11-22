import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  Check,
  CheckCircle2,
  Clock,
  Coffee,
  Crosshair,
  Download,
  FileCheck2,
  FileSpreadsheet,
  History,
  KeyRound,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Trash2,
  Unlink,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DEFAULT_HR_POLICY,
  SCHEMA_LIMITS,
  type AttendanceLog,
  type AttendanceRequest,
  type Branch,
  type BranchSettings,
  type BranchShift,
  type BreakRequest,
  type Employee,
  type EmployeeStatus,
  type SessionUser,
  type UserRole,
} from '../types/attendance';
import {
  computeBreakOverageMinutes,
  computeLateMinutes,
  computeLiveEmployeeInsights,
  formatSignedHoursDiff,
  getAttendanceRequestTypeLabelAr,
  getEmployeePolicy,
  toLocalDateInput,
} from '../utils/attendanceMetrics';
import {
  exportLogsToCsv,
  exportPeriodDailyCsv,
  exportPeriodDetailedCsv,
  exportPeriodReportCsv,
  exportSummaryCsv,
  formatDateTimeAr,
  formatDurationAr,
  formatTimestampAr,
  getActionLabelAr,
  hashEmployeePin,
  type PeriodDailyRow,
  type PeriodDetailedRow,
  type PeriodReportRow,
} from '../utils/crypto';
import { getCurrentBranchLocation } from '../utils/location';
import { StatusText } from './StatusText';

type PeriodReportMode = 'summary' | 'daily' | 'detailed';

interface AdminDashboardProps {
  currentUser: SessionUser;
  authToken: string;
  employees: Employee[];
  employeesLoading: boolean;
  branchSettings: BranchSettings;
  branches: Branch[];
  currentIp: string;
  breakRequests: BreakRequest[];
  attendanceRequests: AttendanceRequest[];
  logs: AttendanceLog[];
  logsLoading: boolean;
}

export function AdminDashboard({
  currentUser,
  authToken,
  employees,
  employeesLoading,
  branchSettings,
  branches,
  currentIp,
  breakRequests,
  attendanceRequests,
  logs,
  logsLoading,
}: AdminDashboardProps) {
  // حسابات الدخول المدارة عبر /api/users
  const [accounts, setAccounts] = useState<SessionUser[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [newUserBranchId, setNewUserBranchId] = useState('');
  const [newUserShiftId, setNewUserShiftId] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountFeedback, setAccountFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [editingPassUserId, setEditingPassUserId] = useState<string | null>(null);
  const [editingPassValue, setEditingPassValue] = useState('');
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // إدارة الفروع والشيفتات والموقع الجغرافي (GPS)
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [brName, setBrName] = useState('');
  const [brAllowedIp, setBrAllowedIp] = useState('');
  const [brGeoEnabled, setBrGeoEnabled] = useState(false);
  const [brLat, setBrLat] = useState('');
  const [brLng, setBrLng] = useState('');
  const [brRadiusMeters, setBrRadiusMeters] = useState(
    String(DEFAULT_HR_POLICY.RADIUS_METERS)
  );
  const [brShiftStart, setBrShiftStart] = useState<string>(DEFAULT_HR_POLICY.SHIFT_START);
  const [brGraceMinutes, setBrGraceMinutes] = useState(
    String(DEFAULT_HR_POLICY.GRACE_MINUTES)
  );
  const [brMaxBreakMinutes, setBrMaxBreakMinutes] = useState(
    String(DEFAULT_HR_POLICY.MAX_BREAK_MINUTES)
  );
  const [brTargetDailyHours, setBrTargetDailyHours] = useState(
    String(DEFAULT_HR_POLICY.TARGET_DAILY_HOURS)
  );
  const [brShifts, setBrShifts] = useState<BranchShift[]>([
    {
      id: 'shift_morning',
      name: 'الشيفت الصباحي',
      startTime: '09:00',
      endTime: '17:00',
    },
  ]);
  const [draftShiftName, setDraftShiftName] = useState('');
  const [draftShiftStart, setDraftShiftStart] = useState('16:00');
  const [draftShiftEnd, setDraftShiftEnd] = useState('00:00');
  const [capturingBranchGps, setCapturingBranchGps] = useState(false);
  const [savingBranch, setSavingBranch] = useState(false);
  const [confirmDeleteBranchId, setConfirmDeleteBranchId] = useState<string | null>(null);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);
  const [branchFeedback, setBranchFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // مراجعة طلبات البريك
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // مراجعة طلبات تعديل السجل والاستئذان والإجازات
  const [busyAttReqId, setBusyAttReqId] = useState<string | null>(null);
  const [attRequestFeedback, setAttRequestFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // إعدادات الفرع الافتراضي وقفل الـ IP وسياسة الدوام
  const [branchNameInput, setBranchNameInput] = useState(branchSettings.branchName);
  const [allowedIpInput, setAllowedIpInput] = useState(branchSettings.allowedIp);
  const [shiftStartInput, setShiftStartInput] = useState(
    branchSettings.shiftStart ?? DEFAULT_HR_POLICY.SHIFT_START
  );
  const [graceMinutesInput, setGraceMinutesInput] = useState(
    String(branchSettings.graceMinutes ?? DEFAULT_HR_POLICY.GRACE_MINUTES)
  );
  const [maxBreakMinutesInput, setMaxBreakMinutesInput] = useState(
    String(branchSettings.maxBreakMinutes ?? DEFAULT_HR_POLICY.MAX_BREAK_MINUTES)
  );
  const [targetDailyHoursInput, setTargetDailyHoursInput] = useState(
    String(branchSettings.targetDailyHours ?? DEFAULT_HR_POLICY.TARGET_DAILY_HOURS)
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // تعديل فرع وشيفت وسياسة وراتب موظف محدد
  const [editingHrEmp, setEditingHrEmp] = useState<Employee | null>(null);
  const [empBranchId, setEmpBranchId] = useState('');
  const [empShiftId, setEmpShiftId] = useState('');
  const [empShiftStart, setEmpShiftStart] = useState('');
  const [empGraceMinutes, setEmpGraceMinutes] = useState('');
  const [empMaxBreakMinutes, setEmpMaxBreakMinutes] = useState('');
  const [empTargetDailyHours, setEmpTargetDailyHours] = useState('');
  const [empHourlyRate, setEmpHourlyRate] = useState('');
  const [savingHrEmp, setSavingHrEmp] = useState(false);

  // فلاتر دليل الموظفين والإجراءات السريعة
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EmployeeStatus>('all');
  const [editingPinEmpId, setEditingPinEmpId] = useState<string | null>(null);
  const [editingPinValue, setEditingPinValue] = useState('');
  const [confirmDeleteEmpId, setConfirmDeleteEmpId] = useState<string | null>(null);
  const [busyEmpId, setBusyEmpId] = useState<string | null>(null);
  const [asyncError, setAsyncError] = useState<Error | null>(null);

  // تقارير الفترات الزمنية (ملخص / يومي / تفصيلي)
  const [reportMode, setReportMode] = useState<PeriodReportMode>('summary');
  const [reportEmpSearch, setReportEmpSearch] = useState('');
  const [reportEmployeeId, setReportEmployeeId] = useState<string>('all');
  const [reportFromDate, setReportFromDate] = useState(() => {
    const now = new Date();
    return toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [reportToDate, setReportToDate] = useState(() => toLocalDateInput(new Date()));
  const [periodReportLoading, setPeriodReportLoading] = useState(false);
  const [generatedReportMode, setGeneratedReportMode] =
    useState<PeriodReportMode>('summary');
  const [periodReportRows, setPeriodReportRows] = useState<PeriodReportRow[] | null>(
    null
  );
  const [periodDailyRows, setPeriodDailyRows] = useState<PeriodDailyRow[] | null>(null);
  const [periodDetailedRows, setPeriodDetailedRows] = useState<
    PeriodDetailedRow[] | null
  >(null);
  const [periodReportFeedback, setPeriodReportFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  if (asyncError) {
    throw asyncError;
  }

  useEffect(() => {
    setBranchNameInput(branchSettings.branchName);
    setAllowedIpInput(branchSettings.allowedIp);
    setShiftStartInput(branchSettings.shiftStart ?? DEFAULT_HR_POLICY.SHIFT_START);
    setGraceMinutesInput(
      String(branchSettings.graceMinutes ?? DEFAULT_HR_POLICY.GRACE_MINUTES)
    );
    setMaxBreakMinutesInput(
      String(branchSettings.maxBreakMinutes ?? DEFAULT_HR_POLICY.MAX_BREAK_MINUTES)
    );
    setTargetDailyHoursInput(
      String(branchSettings.targetDailyHours ?? DEFAULT_HR_POLICY.TARGET_DAILY_HOURS)
    );
  }, [
    branchSettings.branchName,
    branchSettings.allowedIp,
    branchSettings.shiftStart,
    branchSettings.graceMinutes,
    branchSettings.maxBreakMinutes,
    branchSettings.targetDailyHours,
  ]);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401 || res.status === 403) {
        setAccountFeedback({
          ok: false,
          text: 'انتهت صلاحية الجلسة أو لا تملك صلاحية عرض الحسابات.',
        });
        return;
      }
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = (await res.json()) as { users?: SessionUser[] };
      setAccounts(Array.isArray(data.users) ? data.users : []);
    } catch {
      setAccountFeedback({ ok: false, text: 'تعذر تحميل قائمة حسابات الدخول.' });
    } finally {
      setAccountsLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const employeeInsightsMap = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof computeLiveEmployeeInsights>
    >();
    employees.forEach((emp) => {
      map.set(
        emp.id,
        computeLiveEmployeeInsights(
          emp,
          branchSettings,
          logs,
          attendanceRequests,
          nowTick,
          branches
        )
      );
    });
    return map;
  }, [employees, branchSettings, logs, attendanceRequests, nowTick, branches]);

  const getEmployeeMetrics = useCallback(
    (emp: Employee) => {
      const insights = employeeInsightsMap.get(emp.id);
      if (insights) {
        return {
          liveBreakMs: insights.liveBreakMs,
          netWorkMs: insights.netWorkMs,
          insights,
        };
      }
      const fallback = computeLiveEmployeeInsights(
        emp,
        branchSettings,
        logs,
        attendanceRequests,
        nowTick,
        branches
      );
      return {
        liveBreakMs: fallback.liveBreakMs,
        netWorkMs: fallback.netWorkMs,
        insights: fallback,
      };
    },
    [employeeInsightsMap, branchSettings, logs, attendanceRequests, nowTick, branches]
  );

  const selectedNewUserBranch = useMemo(
    () => branches.find((b) => b.id === newUserBranchId) ?? null,
    [branches, newUserBranchId]
  );

  const selectedModalBranch = useMemo(
    () => branches.find((b) => b.id === empBranchId) ?? null,
    [branches, empBranchId]
  );

  const employeeByIdMap = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((e) => map.set(e.id, e));
    return map;
  }, [employees]);

  const pendingBreakRequests = useMemo(
    () => breakRequests.filter((r) => r.status === 'pending'),
    [breakRequests]
  );

  const pendingAttendanceRequests = useMemo(
    () => attendanceRequests.filter((r) => r.status === 'pending'),
    [attendanceRequests]
  );

  const breakOverageEmployees = useMemo(
    () =>
      employees.filter((e) => {
        if (!e.isActive) return false;
        const ins = employeeInsightsMap.get(e.id);
        return Boolean(ins?.isBreakExceeded);
      }),
    [employees, employeeInsightsMap]
  );

  const absentEmployees = useMemo(
    () =>
      employees.filter((e) => {
        if (!e.isActive) return false;
        return Boolean(employeeInsightsMap.get(e.id)?.isAbsent);
      }),
    [employees, employeeInsightsMap]
  );

  const stats = useMemo(() => {
    const active = employees.filter((e) => e.isActive);
    return {
      total: active.length,
      working: active.filter((e) => e.status === 'working').length,
      onBreak: active.filter((e) => e.status === 'break').length,
      out: active.filter((e) => e.status === 'out').length,
    };
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees
      .filter((emp) => {
        if (statusFilter !== 'all' && emp.status !== statusFilter) return false;
        if (
          q &&
          !emp.name.toLowerCase().includes(q) &&
          !emp.roleTitle.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [employees, searchQuery, statusFilter]);

  const handleExportSummary = () => {
    const statusMap: Record<EmployeeStatus, string> = {
      working: 'على رأس العمل',
      break: 'في بريك',
      out: 'خارج الدوام',
    };
    const rows = filteredEmployees.map((emp) => {
      const { liveBreakMs, netWorkMs } = getEmployeeMetrics(emp);
      return {
        name: emp.name,
        roleTitle: emp.roleTitle,
        statusLabel: statusMap[emp.status],
        totalBreakFormatted: formatDurationAr(liveBreakMs),
        netWorkFormatted: formatDurationAr(netWorkMs),
        deviceStatus: emp.deviceId ? 'مرتبط بجوال' : 'غير مرتبط',
      };
    });
    exportSummaryCsv(rows);
  };

  const reportEmployeeOptions = useMemo(() => {
    const q = reportEmpSearch.trim().toLowerCase();
    return employees
      .filter((emp) => {
        if (!q) return true;
        return (
          emp.name.toLowerCase().includes(q) ||
          emp.roleTitle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [employees, reportEmpSearch]);

  const applyDatePreset = (preset: 'today' | 'week' | 'month') => {
    const today = new Date();
    const toStr = toLocalDateInput(today);
    if (preset === 'today') {
      setReportFromDate(toStr);
      setReportToDate(toStr);
    } else if (preset === 'week') {
      const start = new Date(today);
      start.setDate(today.getDate() - 6);
      setReportFromDate(toLocalDateInput(start));
      setReportToDate(toStr);
    } else {
      setReportFromDate(
        toLocalDateInput(new Date(today.getFullYear(), today.getMonth(), 1))
      );
      setReportToDate(toStr);
    }
    setPeriodReportFeedback(null);
  };

  const handleGeneratePeriodReport = async (downloadCsv: boolean) => {
    setPeriodReportFeedback(null);

    if (!reportFromDate || !reportToDate) {
      setPeriodReportFeedback({
        ok: false,
        text: 'يرجى تحديد تاريخ البداية وتاريخ النهاية.',
      });
      return;
    }

    const startDate = new Date(`${reportFromDate}T00:00:00`);
    const endDate = new Date(`${reportToDate}T23:59:59.999`);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate.getTime() > endDate.getTime()
    ) {
      setPeriodReportFeedback({
        ok: false,
        text: 'تاريخ البداية يجب أن يكون قبل أو مساوياً لتاريخ النهاية.',
      });
      return;
    }

    const trimmedSearch = reportEmpSearch.trim().toLowerCase();
    let targetIds: Set<string> | null = null;
    let employeeFileSuffix: string | undefined;
    let scopeLabel = 'جميع الموظفين';

    if (reportEmployeeId !== 'all') {
      targetIds = new Set([reportEmployeeId]);
      const chosen = employees.find((e) => e.id === reportEmployeeId);
      if (chosen) {
        employeeFileSuffix = chosen.name;
        scopeLabel = chosen.name;
      }
    } else if (trimmedSearch.length > 0) {
      if (reportEmployeeOptions.length === 0) {
        setPeriodReportFeedback({
          ok: false,
          text: 'لا يوجد موظف مطابق لاسم البحث المحدد.',
        });
        return;
      }
      targetIds = new Set(reportEmployeeOptions.map((e) => e.id));
      if (reportEmployeeOptions.length === 1) {
        employeeFileSuffix = reportEmployeeOptions[0].name;
        scopeLabel = reportEmployeeOptions[0].name;
      } else {
        scopeLabel = `نتائج البحث (${reportEmployeeOptions.length} موظف)`;
      }
    }

    setPeriodReportLoading(true);
    try {
      const startTs = Timestamp.fromDate(startDate);
      const endTs = Timestamp.fromDate(endDate);
      const collectedLogs: AttendanceLog[] = [];
      let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
      const PAGE_SIZE = 50;
      const MAX_PAGES = 200;
      let hitPageCap = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const logsPageQuery: Query<DocumentData> = lastDoc
          ? query(
              collection(db, 'attendance_logs'),
              where('timestamp', '>=', startTs),
              where('timestamp', '<=', endTs),
              orderBy('timestamp', 'asc'),
              startAfter(lastDoc),
              limit(PAGE_SIZE)
            )
          : query(
              collection(db, 'attendance_logs'),
              where('timestamp', '>=', startTs),
              where('timestamp', '<=', endTs),
              orderBy('timestamp', 'asc'),
              limit(PAGE_SIZE)
            );

        const snap: QuerySnapshot<DocumentData> = await getDocs(logsPageQuery);
        snap.docs.forEach((d) => {
          collectedLogs.push({
            id: d.id,
            ...(d.data() as Omit<AttendanceLog, 'id'>),
          });
        });

        if (snap.docs.length < PAGE_SIZE) {
          break;
        }
        if (page === MAX_PAGES - 1) {
          hitPageCap = true;
        }
        lastDoc = snap.docs[snap.docs.length - 1];
      }

      const filteredLogs = targetIds
        ? collectedLogs.filter((l) => targetIds!.has(l.employeeId))
        : collectedLogs;

      const employeeMap = new Map<string, Employee>();
      employees.forEach((e) => employeeMap.set(e.id, e));

      setGeneratedReportMode(reportMode);
      const capWarning = hitPageCap ? ' (تنبيه: تم الوصول للحد الأقصى لصفحات السجل)' : '';

      if (reportMode === 'detailed') {
        const detailedRows: PeriodDetailedRow[] = filteredLogs
          .filter((l) => Boolean(l.timestamp))
          .map((log) => {
            const d = log.timestamp!.toDate();
            return {
              id: log.id,
              date: toLocalDateInput(d),
              timeFormatted: formatTimestampAr(d),
              dateTimeFormatted: formatDateTimeAr(d),
              employeeId: log.employeeId,
              employeeName: log.employeeName,
              action: log.action,
              actionLabel: getActionLabelAr(log.action),
              ip: log.ip || '—',
              deviceId: log.deviceId || '—',
            };
          });

        setPeriodDetailedRows(detailedRows);
        setPeriodDailyRows(null);
        setPeriodReportRows(null);

        if (downloadCsv) {
          exportPeriodDetailedCsv(
            detailedRows,
            reportFromDate,
            reportToDate,
            employeeFileSuffix
          );
        }

        setPeriodReportFeedback({
          ok: true,
          text: `${downloadCsv ? 'تم توليد وتصدير' : 'تم عرض'} الحركة التفصيلية (${scopeLabel}) من ${reportFromDate} إلى ${reportToDate} (${detailedRows.length} حركة)${capWarning}.`,
        });
        return;
      }

      if (reportMode === 'daily') {
        interface DailyBucket {
          date: string;
          employeeId: string;
          name: string;
          roleTitle: string;
          firstCheckInMs: number | null;
          lastCheckOutMs: number | null;
          completedShifts: number;
          breakCount: number;
          totalBreakMs: number;
          totalNetWorkMs: number;
        }
        interface EmpShiftState {
          activeCheckInMs: number | null;
          activeShiftDay: string | null;
          activeBreakStartMs: number | null;
          shiftBreakMs: number;
        }

        const dailyBuckets = new Map<string, DailyBucket>();
        const shiftStates = new Map<string, EmpShiftState>();

        const getBucket = (
          dateKey: string,
          empId: string,
          fallbackName: string
        ): DailyBucket => {
          const key = `${empId}__${dateKey}`;
          const existing = dailyBuckets.get(key);
          if (existing) return existing;
          const emp = employeeMap.get(empId);
          const created: DailyBucket = {
            date: dateKey,
            employeeId: empId,
            name: emp?.name || fallbackName,
            roleTitle: emp?.roleTitle || '',
            firstCheckInMs: null,
            lastCheckOutMs: null,
            completedShifts: 0,
            breakCount: 0,
            totalBreakMs: 0,
            totalNetWorkMs: 0,
          };
          dailyBuckets.set(key, created);
          return created;
        };

        const getShiftState = (empId: string): EmpShiftState => {
          const existing = shiftStates.get(empId);
          if (existing) return existing;
          const created: EmpShiftState = {
            activeCheckInMs: null,
            activeShiftDay: null,
            activeBreakStartMs: null,
            shiftBreakMs: 0,
          };
          shiftStates.set(empId, created);
          return created;
        };

        filteredLogs.forEach((log) => {
          if (!log.timestamp) return;
          const t = log.timestamp.toMillis();
          const logDay = toLocalDateInput(new Date(t));
          const state = getShiftState(log.employeeId);

          if (log.action === 'check_in') {
            state.activeCheckInMs = t;
            state.activeShiftDay = logDay;
            state.activeBreakStartMs = null;
            state.shiftBreakMs = 0;
            const bucket = getBucket(logDay, log.employeeId, log.employeeName);
            if (bucket.firstCheckInMs === null || t < bucket.firstCheckInMs) {
              bucket.firstCheckInMs = t;
            }
          } else if (log.action === 'break_start') {
            const targetDay = state.activeShiftDay ?? logDay;
            const bucket = getBucket(targetDay, log.employeeId, log.employeeName);
            if (state.activeBreakStartMs === null) {
              state.activeBreakStartMs = t;
              bucket.breakCount += 1;
            }
          } else if (log.action === 'break_end') {
            if (state.activeBreakStartMs !== null) {
              const breakDuration = Math.max(0, t - state.activeBreakStartMs);
              const targetDay =
                state.activeShiftDay ??
                toLocalDateInput(new Date(state.activeBreakStartMs));
              const bucket = getBucket(targetDay, log.employeeId, log.employeeName);
              bucket.totalBreakMs += breakDuration;
              state.shiftBreakMs += breakDuration;
              state.activeBreakStartMs = null;
            }
          } else if (log.action === 'check_out') {
            const targetDay = state.activeShiftDay ?? logDay;
            const bucket = getBucket(targetDay, log.employeeId, log.employeeName);
            if (bucket.lastCheckOutMs === null || t > bucket.lastCheckOutMs) {
              bucket.lastCheckOutMs = t;
            }
            if (state.activeBreakStartMs !== null) {
              const breakDuration = Math.max(0, t - state.activeBreakStartMs);
              bucket.totalBreakMs += breakDuration;
              state.shiftBreakMs += breakDuration;
              state.activeBreakStartMs = null;
            }
            if (state.activeCheckInMs !== null) {
              const gross = Math.max(0, t - state.activeCheckInMs);
              const net = Math.max(0, gross - state.shiftBreakMs);
              bucket.totalNetWorkMs += net;
              bucket.completedShifts += 1;
              state.activeCheckInMs = null;
              state.activeShiftDay = null;
              state.shiftBreakMs = 0;
            }
          }
        });

        const nowMs = Date.now();
        const rangeCoversNow = endDate.getTime() >= nowMs - 60_000;
        if (rangeCoversNow) {
          shiftStates.forEach((state, empId) => {
            const emp = employeeMap.get(empId);
            if (
              emp &&
              (emp.status === 'working' || emp.status === 'break') &&
              state.activeCheckInMs !== null &&
              state.activeShiftDay !== null
            ) {
              const bucket = getBucket(state.activeShiftDay, empId, emp.name);
              let openBreak = state.shiftBreakMs;
              if (state.activeBreakStartMs !== null) {
                const liveBreakSlice = Math.max(0, nowMs - state.activeBreakStartMs);
                bucket.totalBreakMs += liveBreakSlice;
                openBreak += liveBreakSlice;
              }
              const liveGross = Math.max(0, nowMs - state.activeCheckInMs);
              bucket.totalNetWorkMs += Math.max(0, liveGross - openBreak);
            }
          });
        }

        const approvedLateExcuseKeys = new Set(
          attendanceRequests
            .filter((r) => r.status === 'approved' && r.type === 'late_excuse')
            .map((r) => `${r.employeeId}__${r.targetDate}`)
        );

        const dailyRows: PeriodDailyRow[] = Array.from(dailyBuckets.values())
          .sort((a, b) => {
            const dateCmp = a.date.localeCompare(b.date);
            if (dateCmp !== 0) return dateCmp;
            return a.name.localeCompare(b.name, 'ar');
          })
          .map((b) => {
            const emp = employeeMap.get(b.employeeId);
            const policy = getEmployeePolicy(emp, branchSettings, branches);
            const isExcused = approvedLateExcuseKeys.has(
              `${b.employeeId}__${b.date}`
            );
            const lateMinutes =
              b.firstCheckInMs !== null && !isExcused
                ? computeLateMinutes(
                    b.firstCheckInMs,
                    policy.shiftStart,
                    policy.graceMinutes
                  )
                : 0;
            const breakOverageMinutes = computeBreakOverageMinutes(
              b.totalBreakMs,
              policy.maxBreakMinutes
            );
            const netHours = b.totalNetWorkMs / 3_600_000;
            const overtimeDiff = netHours - policy.targetDailyHours;
            const estimatedPayFormatted =
              policy.hourlyRate !== null
                ? (netHours * policy.hourlyRate).toFixed(2)
                : '—';

            return {
              rowKey: `${b.employeeId}__${b.date}`,
              date: b.date,
              employeeId: b.employeeId,
              name: b.name,
              roleTitle: b.roleTitle,
              firstCheckInFormatted: b.firstCheckInMs
                ? formatTimestampAr(b.firstCheckInMs)
                : '—',
              lastCheckOutFormatted: b.lastCheckOutMs
                ? formatTimestampAr(b.lastCheckOutMs)
                : 'مستمر',
              completedShifts: b.completedShifts,
              breakCount: b.breakCount,
              totalBreakMs: b.totalBreakMs,
              totalBreakFormatted: formatDurationAr(b.totalBreakMs),
              breakOverageMinutes,
              lateMinutes,
              totalNetWorkMs: b.totalNetWorkMs,
              netWorkFormatted: formatDurationAr(b.totalNetWorkMs),
              netWorkDecimalHours: netHours.toFixed(2),
              overtimeDiffFormatted: formatSignedHoursDiff(overtimeDiff),
              estimatedPayFormatted,
            };
          });

        setPeriodDailyRows(dailyRows);
        setPeriodReportRows(null);
        setPeriodDetailedRows(null);

        if (downloadCsv) {
          exportPeriodDailyCsv(
            dailyRows,
            reportFromDate,
            reportToDate,
            employeeFileSuffix
          );
        }

        setPeriodReportFeedback({
          ok: true,
          text: `${downloadCsv ? 'تم توليد وتصدير' : 'تم عرض'} الحركة التجميعية اليومية (${scopeLabel}) من ${reportFromDate} إلى ${reportToDate} (${dailyRows.length} يوم/سجل)${capWarning}.`,
        });
        return;
      }

      interface Accumulator {
        employeeId: string;
        name: string;
        roleTitle: string;
        activeCheckInMs: number | null;
        activeShiftDay: string | null;
        activeBreakStartMs: number | null;
        shiftBreakMs: number;
        totalBreakMs: number;
        totalNetWorkMs: number;
        completedShifts: number;
        breakCount: number;
        daysSet: Set<string>;
        dailyFirstCheckIn: Map<string, number>;
        dailyBreakMs: Map<string, number>;
      }

      const accumulators = new Map<string, Accumulator>();
      const getOrCreateAcc = (empId: string, fallbackName: string): Accumulator => {
        const existing = accumulators.get(empId);
        if (existing) return existing;
        const emp = employeeMap.get(empId);
        const created: Accumulator = {
          employeeId: empId,
          name: emp?.name || fallbackName,
          roleTitle: emp?.roleTitle || '',
          activeCheckInMs: null,
          activeShiftDay: null,
          activeBreakStartMs: null,
          shiftBreakMs: 0,
          totalBreakMs: 0,
          totalNetWorkMs: 0,
          completedShifts: 0,
          breakCount: 0,
          daysSet: new Set<string>(),
          dailyFirstCheckIn: new Map<string, number>(),
          dailyBreakMs: new Map<string, number>(),
        };
        accumulators.set(empId, created);
        return created;
      };

      employees
        .filter((e) => (targetIds ? targetIds.has(e.id) : e.isActive))
        .forEach((e) => {
          getOrCreateAcc(e.id, e.name);
        });

      filteredLogs.forEach((log) => {
        if (!log.timestamp) return;
        const t = log.timestamp.toMillis();
        const logDay = toLocalDateInput(new Date(t));
        const acc = getOrCreateAcc(log.employeeId, log.employeeName);

        if (log.action === 'check_in') {
          acc.activeCheckInMs = t;
          acc.activeShiftDay = logDay;
          acc.activeBreakStartMs = null;
          acc.shiftBreakMs = 0;
          acc.daysSet.add(logDay);
          const prevFirst = acc.dailyFirstCheckIn.get(logDay);
          if (prevFirst === undefined || t < prevFirst) {
            acc.dailyFirstCheckIn.set(logDay, t);
          }
        } else if (log.action === 'break_start') {
          if (acc.activeBreakStartMs === null) {
            acc.activeBreakStartMs = t;
            acc.breakCount += 1;
          }
        } else if (log.action === 'break_end') {
          if (acc.activeBreakStartMs !== null) {
            const breakDuration = Math.max(0, t - acc.activeBreakStartMs);
            const bDay =
              acc.activeShiftDay ??
              toLocalDateInput(new Date(acc.activeBreakStartMs));
            acc.totalBreakMs += breakDuration;
            acc.shiftBreakMs += breakDuration;
            acc.dailyBreakMs.set(bDay, (acc.dailyBreakMs.get(bDay) ?? 0) + breakDuration);
            acc.activeBreakStartMs = null;
          }
        } else if (log.action === 'check_out') {
          if (acc.activeBreakStartMs !== null) {
            const breakDuration = Math.max(0, t - acc.activeBreakStartMs);
            const bDay = acc.activeShiftDay ?? logDay;
            acc.totalBreakMs += breakDuration;
            acc.shiftBreakMs += breakDuration;
            acc.dailyBreakMs.set(bDay, (acc.dailyBreakMs.get(bDay) ?? 0) + breakDuration);
            acc.activeBreakStartMs = null;
          }
          if (acc.activeCheckInMs !== null) {
            const gross = Math.max(0, t - acc.activeCheckInMs);
            const net = Math.max(0, gross - acc.shiftBreakMs);
            acc.totalNetWorkMs += net;
            acc.completedShifts += 1;
            acc.activeCheckInMs = null;
            acc.activeShiftDay = null;
            acc.shiftBreakMs = 0;
          }
        }
      });

      const nowMs = Date.now();
      const rangeCoversNow = endDate.getTime() >= nowMs - 60_000;
      if (rangeCoversNow) {
        accumulators.forEach((acc) => {
          const emp = employeeMap.get(acc.employeeId);
          if (
            emp &&
            (emp.status === 'working' || emp.status === 'break') &&
            acc.activeCheckInMs !== null
          ) {
            let openBreak = acc.shiftBreakMs;
            if (acc.activeBreakStartMs !== null) {
              const liveBreakSlice = Math.max(0, nowMs - acc.activeBreakStartMs);
              const bDay = acc.activeShiftDay ?? toLocalDateInput(new Date(nowMs));
              acc.totalBreakMs += liveBreakSlice;
              acc.dailyBreakMs.set(
                bDay,
                (acc.dailyBreakMs.get(bDay) ?? 0) + liveBreakSlice
              );
              openBreak += liveBreakSlice;
            }
            const liveGross = Math.max(0, nowMs - acc.activeCheckInMs);
            acc.totalNetWorkMs += Math.max(0, liveGross - openBreak);
          }
        });
      }

      const approvedLateExcuseKeys = new Set(
        attendanceRequests
          .filter((r) => r.status === 'approved' && r.type === 'late_excuse')
          .map((r) => `${r.employeeId}__${r.targetDate}`)
      );

      const rows: PeriodReportRow[] = Array.from(accumulators.values())
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        .map((acc) => {
          const emp = employeeMap.get(acc.employeeId);
          const policy = getEmployeePolicy(emp, branchSettings, branches);

          let totalLateMinutes = 0;
          acc.dailyFirstCheckIn.forEach((firstMs, dateKey) => {
            if (!approvedLateExcuseKeys.has(`${acc.employeeId}__${dateKey}`)) {
              totalLateMinutes += computeLateMinutes(
                firstMs,
                policy.shiftStart,
                policy.graceMinutes
              );
            }
          });

          let breakOverageDays = 0;
          acc.dailyBreakMs.forEach((dayBreakMs) => {
            if (computeBreakOverageMinutes(dayBreakMs, policy.maxBreakMinutes) > 0) {
              breakOverageDays += 1;
            }
          });

          const netHours = acc.totalNetWorkMs / 3_600_000;
          const expectedHours = acc.daysSet.size * policy.targetDailyHours;
          const overtimeDiff = netHours - expectedHours;
          const estimatedPayFormatted =
            policy.hourlyRate !== null
              ? (netHours * policy.hourlyRate).toFixed(2)
              : '—';

          return {
            employeeId: acc.employeeId,
            name: acc.name,
            roleTitle: acc.roleTitle,
            attendanceDays: acc.daysSet.size,
            completedShifts: acc.completedShifts,
            breakCount: acc.breakCount,
            totalBreakMs: acc.totalBreakMs,
            totalBreakFormatted: formatDurationAr(acc.totalBreakMs),
            breakOverageDays,
            totalLateMinutes,
            totalNetWorkMs: acc.totalNetWorkMs,
            netWorkFormatted: formatDurationAr(acc.totalNetWorkMs),
            netWorkDecimalHours: netHours.toFixed(2),
            overtimeDiffFormatted: formatSignedHoursDiff(overtimeDiff),
            estimatedPayFormatted,
          };
        });

      setPeriodReportRows(rows);
      setPeriodDailyRows(null);
      setPeriodDetailedRows(null);

      if (downloadCsv) {
        exportPeriodReportCsv(
          rows,
          reportFromDate,
          reportToDate,
          employeeFileSuffix
        );
      }

      setPeriodReportFeedback({
        ok: true,
        text: `${downloadCsv ? 'تم توليد وتصدير' : 'تم عرض'} التقرير الشامل (${scopeLabel}) من ${reportFromDate} إلى ${reportToDate} (${rows.length} موظف، ${filteredLogs.length} حركة)${capWarning}.`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.LIST, 'attendance_logs');
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setPeriodReportLoading(false);
    }
  };

  const handleReviewBreakRequest = async (
    req: BreakRequest,
    decision: 'approved' | 'rejected'
  ) => {
    setRequestFeedback(null);
    setBusyRequestId(req.id);

    try {
      const emp = employees.find((e) => e.id === req.employeeId);
      const reviewerName = currentUser.username.slice(0, 80);

      if (decision === 'approved') {
        if (!emp || emp.status !== 'working') {
          setRequestFeedback({
            ok: false,
            text: `تعذر الموافقة: الموظف "${req.employeeName}" ليس على رأس العمل حالياً.`,
          });
          return;
        }

        const batch = writeBatch(db);
        const reqRef = doc(db, 'break_requests', req.id);
        const empRef = doc(db, 'employees', emp.id);
        const logRef = doc(collection(db, 'attendance_logs'));

        batch.update(reqRef, {
          status: 'approved',
          reviewedAt: serverTimestamp(),
          reviewedBy: reviewerName,
          notified: false,
          updatedAt: serverTimestamp(),
        });

        batch.update(empRef, {
          status: 'break',
          lastBreakStart: Date.now(),
          updatedAt: serverTimestamp(),
        });

        const safeIp = SCHEMA_LIMITS.IP_PATTERN.test(currentIp)
          ? currentIp.slice(0, SCHEMA_LIMITS.IP_MAX)
          : '';

        batch.set(logRef, {
          employeeId: emp.id,
          employeeName: emp.name.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
          action: 'break_start',
          ip: safeIp,
          deviceId: (emp.deviceId || 'admin_approved').slice(0, SCHEMA_LIMITS.DEVICE_ID_MAX),
          createdByUid: currentUser.id,
          timestamp: serverTimestamp(),
        });

        await batch.commit();
        setRequestFeedback({
          ok: true,
          text: `تم التصديق على بريك "${req.employeeName}" وإرسال إشعار الموافقة فوراً.`,
        });
      } else {
        await updateDoc(doc(db, 'break_requests', req.id), {
          status: 'rejected',
          reviewedAt: serverTimestamp(),
          reviewedBy: reviewerName,
          notified: false,
          updatedAt: serverTimestamp(),
        });
        setRequestFeedback({
          ok: true,
          text: `تم رفض طلب البريك المقدم من "${req.employeeName}".`,
        });
      }
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `break_requests/${req.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleReviewAttendanceRequest = async (
    req: AttendanceRequest,
    decision: 'approved' | 'rejected'
  ) => {
    setAttRequestFeedback(null);
    setBusyAttReqId(req.id);
    try {
      const reviewerName = currentUser.username.slice(0, 80);
      const reqRef = doc(db, 'attendance_requests', req.id);

      if (decision === 'rejected') {
        await updateDoc(reqRef, {
          status: 'rejected',
          reviewedAt: serverTimestamp(),
          reviewedBy: reviewerName,
          notified: false,
          updatedAt: serverTimestamp(),
        });
        setAttRequestFeedback({
          ok: true,
          text: `تم رفض طلب "${req.employeeName}" (${getAttendanceRequestTypeLabelAr(req.type)}).`,
        });
        return;
      }

      const emp = employees.find((e) => e.id === req.employeeId);
      const batch = writeBatch(db);

      batch.update(reqRef, {
        status: 'approved',
        reviewedAt: serverTimestamp(),
        reviewedBy: reviewerName,
        notified: false,
        updatedAt: serverTimestamp(),
      });

      if (
        (req.type === 'missed_check_in' || req.type === 'missed_check_out') &&
        typeof req.targetTimestampMs === 'number'
      ) {
        const logRef = doc(collection(db, 'attendance_logs'));
        const action = req.type === 'missed_check_in' ? 'check_in' : 'check_out';
        const safeIp = SCHEMA_LIMITS.IP_PATTERN.test(currentIp)
          ? currentIp.slice(0, SCHEMA_LIMITS.IP_MAX)
          : '';

        batch.set(logRef, {
          employeeId: req.employeeId,
          employeeName: (emp?.name || req.employeeName).slice(
            0,
            SCHEMA_LIMITS.EMP_NAME_MAX
          ),
          action,
          ip: safeIp,
          deviceId: 'manual_adjustment',
          createdByUid: currentUser.id,
          manualRequestId: req.id,
          timestamp: Timestamp.fromMillis(req.targetTimestampMs),
        });

        const todayStr = toLocalDateInput(new Date());
        if (emp) {
          if (
            req.type === 'missed_check_in' &&
            req.targetDate === todayStr &&
            emp.status === 'out' &&
            (!emp.lastCheckIn || emp.lastCheckIn < req.targetTimestampMs)
          ) {
            batch.update(doc(db, 'employees', emp.id), {
              status: 'working',
              lastCheckIn: req.targetTimestampMs,
              lastCheckOut: null,
              lastBreakStart: null,
              totalBreakMs: 0,
              updatedAt: serverTimestamp(),
            });
          } else if (
            req.type === 'missed_check_out' &&
            (emp.status === 'working' || emp.status === 'break') &&
            emp.lastCheckIn !== null &&
            toLocalDateInput(new Date(emp.lastCheckIn)) === req.targetDate &&
            req.targetTimestampMs >= emp.lastCheckIn
          ) {
            batch.update(doc(db, 'employees', emp.id), {
              status: 'out',
              lastCheckOut: req.targetTimestampMs,
              lastBreakStart: null,
              updatedAt: serverTimestamp(),
            });
          }
        }
      }

      await batch.commit();
      setAttRequestFeedback({
        ok: true,
        text: `تم اعتماد طلب "${req.employeeName}" (${getAttendanceRequestTypeLabelAr(req.type)}) وتحديث السجل بنجاح.`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `attendance_requests/${req.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyAttReqId(null);
    }
  };

  const handleCreateUserAccount = async () => {
    setAccountFeedback(null);
    const cleanUsername = newUsername.trim().slice(0, SCHEMA_LIMITS.USERNAME_MAX);
    const cleanRoleTitle = newRoleTitle.trim().slice(0, SCHEMA_LIMITS.ROLE_TITLE_MAX);

    if (cleanUsername.length < SCHEMA_LIMITS.USERNAME_MIN) {
      setAccountFeedback({
        ok: false,
        text: 'اسم المستخدم يجب أن يكون حرفين على الأقل.',
      });
      return;
    }

    if (
      newPassword.length < SCHEMA_LIMITS.PASSWORD_MIN ||
      newPassword.length > SCHEMA_LIMITS.PASSWORD_MAX
    ) {
      setAccountFeedback({
        ok: false,
        text: `كلمة المرور يجب أن تكون بين ${SCHEMA_LIMITS.PASSWORD_MIN} و ${SCHEMA_LIMITS.PASSWORD_MAX} أحرف.`,
      });
      return;
    }

    setCreatingAccount(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          username: cleanUsername,
          password: newPassword,
          role: newRole,
          roleTitle: cleanRoleTitle || (newRole === 'admin' ? 'مدير' : 'موظف'),
        }),
      });

      const data = (await res.json()) as { user?: SessionUser; error?: string };
      if (!res.ok || !data.user) {
        setAccountFeedback({
          ok: false,
          text: data.error ?? 'تعذر إنشاء الحساب.',
        });
        return;
      }

      const createdUser = data.user;
      const pinSeed = newPassword.slice(0, SCHEMA_LIMITS.PIN_MAX).padEnd(4, '0');
      const pinHash = await hashEmployeePin(createdUser.employeeId, pinSeed);

      const selectedBranch =
        branches.find((b) => b.id === newUserBranchId) ?? null;
      const selectedShift =
        selectedBranch?.shifts.find((s) => s.id === newUserShiftId) ?? null;

      try {
        await setDoc(doc(db, 'employees', createdUser.employeeId), {
          name: createdUser.username.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
          roleTitle: (
            cleanRoleTitle || (createdUser.role === 'admin' ? 'مدير' : 'موظف')
          ).slice(0, SCHEMA_LIMITS.ROLE_TITLE_MAX),
          pinHash,
          deviceId: null,
          branchId: selectedBranch?.id ?? null,
          branchName: selectedBranch?.name ?? null,
          shiftId: selectedShift?.id ?? null,
          shiftName: selectedShift?.name ?? null,
          shiftStart: selectedShift?.startTime ?? null,
          shiftEnd: selectedShift?.endTime ?? null,
          graceMinutes: null,
          maxBreakMinutes: null,
          targetDailyHours: null,
          hourlyRate: null,
          status: 'out' satisfies EmployeeStatus,
          isActive: true,
          totalBreakMs: 0,
          lastCheckIn: null,
          lastBreakStart: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setAccountFeedback({
          ok: true,
          text: `تم إنشاء حساب "${createdUser.username}"${
            selectedBranch ? ` وتعيينه في "${selectedBranch.name}"` : ''
          } بنجاح.`,
        });
      } catch {
        setAccountFeedback({
          ok: false,
          text: `تم إنشاء حساب الدخول "${createdUser.username}" لكن تعذر إنشاء ملف الموظف في قاعدة البيانات؛ أعد المحاولة.`,
        });
      }

      setNewUsername('');
      setNewPassword('');
      setNewRoleTitle('');
      setNewUserBranchId('');
      setNewUserShiftId('');
      await loadAccounts();
    } catch {
      setAccountFeedback({
        ok: false,
        text: 'حدث خطأ في الاتصال أثناء إنشاء الحساب.',
      });
    } finally {
      setCreatingAccount(false);
    }
  };

  // --- إدارة الفروع والشيفتات ---
  const resetBranchEditor = () => {
    setEditingBranch(null);
    setBrName('');
    setBrAllowedIp('');
    setBrGeoEnabled(false);
    setBrLat('');
    setBrLng('');
    setBrRadiusMeters(String(DEFAULT_HR_POLICY.RADIUS_METERS));
    setBrShiftStart(DEFAULT_HR_POLICY.SHIFT_START);
    setBrGraceMinutes(String(DEFAULT_HR_POLICY.GRACE_MINUTES));
    setBrMaxBreakMinutes(String(DEFAULT_HR_POLICY.MAX_BREAK_MINUTES));
    setBrTargetDailyHours(String(DEFAULT_HR_POLICY.TARGET_DAILY_HOURS));
    setBrShifts([
      {
        id: 'shift_morning',
        name: 'الشيفت الصباحي',
        startTime: '09:00',
        endTime: '17:00',
      },
    ]);
    setDraftShiftName('');
    setDraftShiftStart('16:00');
    setDraftShiftEnd('00:00');
  };

  const openEditBranch = (branch: Branch) => {
    setBranchFeedback(null);
    setEditingBranch(branch);
    setBrName(branch.name);
    setBrAllowedIp(branch.allowedIp ?? '');
    setBrGeoEnabled(Boolean(branch.geoEnabled));
    setBrLat(branch.lat !== null && branch.lat !== undefined ? String(branch.lat) : '');
    setBrLng(branch.lng !== null && branch.lng !== undefined ? String(branch.lng) : '');
    setBrRadiusMeters(String(branch.radiusMeters ?? DEFAULT_HR_POLICY.RADIUS_METERS));
    setBrShiftStart(branch.shiftStart || DEFAULT_HR_POLICY.SHIFT_START);
    setBrGraceMinutes(String(branch.graceMinutes ?? DEFAULT_HR_POLICY.GRACE_MINUTES));
    setBrMaxBreakMinutes(
      String(branch.maxBreakMinutes ?? DEFAULT_HR_POLICY.MAX_BREAK_MINUTES)
    );
    setBrTargetDailyHours(
      String(branch.targetDailyHours ?? DEFAULT_HR_POLICY.TARGET_DAILY_HOURS)
    );
    setBrShifts(Array.isArray(branch.shifts) ? [...branch.shifts] : []);
  };

  const handleCaptureBranchGps = async () => {
    setBranchFeedback(null);
    setCapturingBranchGps(true);
    try {
      const fix = await getCurrentBranchLocation();
      setBrLat(fix.lat.toFixed(6));
      setBrLng(fix.lng.toFixed(6));
      setBrGeoEnabled(true);
      setBranchFeedback({
        ok: true,
        text: `تم التقاط إحداثيات موقعك الحالي بنجاح (الدقة ±${fix.accuracyMeters} متر).`,
      });
    } catch (err) {
      setBranchFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'تعذر التقاط موقع GPS الحالي من المتصفح.',
      });
    } finally {
      setCapturingBranchGps(false);
    }
  };

  const handleAddDraftShift = () => {
    setBranchFeedback(null);
    if (brShifts.length >= SCHEMA_LIMITS.MAX_SHIFTS_PER_BRANCH) {
      setBranchFeedback({
        ok: false,
        text: `الحد الأقصى للشيفتات في الفرع الواحد هو ${SCHEMA_LIMITS.MAX_SHIFTS_PER_BRANCH}.`,
      });
      return;
    }
    const cleanName = draftShiftName.trim().slice(0, SCHEMA_LIMITS.SHIFT_NAME_MAX);
    if (!cleanName) {
      setBranchFeedback({ ok: false, text: 'أدخل اسم الشيفت (مثال: الشيفت المسائي).' });
      return;
    }
    if (
      !SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(draftShiftStart) ||
      !SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(draftShiftEnd)
    ) {
      setBranchFeedback({ ok: false, text: 'يرجى تحديد وقت البداية والنهاية للشيفت.' });
      return;
    }
    const id = `sh_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setBrShifts((prev) => [
      ...prev,
      {
        id,
        name: cleanName,
        startTime: draftShiftStart,
        endTime: draftShiftEnd,
      },
    ]);
    setDraftShiftName('');
  };

  const handleRemoveShift = (shiftId: string) => {
    setBrShifts((prev) => prev.filter((s) => s.id !== shiftId));
  };

  const handleSaveBranch = async () => {
    setBranchFeedback(null);
    const cleanName = brName.trim().slice(0, SCHEMA_LIMITS.BRANCH_NAME_MAX);
    if (!cleanName) {
      setBranchFeedback({ ok: false, text: 'يرجى إدخال اسم الفرع.' });
      return;
    }

    const cleanIp = brAllowedIp.trim().slice(0, SCHEMA_LIMITS.IP_MAX);
    if (cleanIp.length > 0 && !SCHEMA_LIMITS.IP_PATTERN.test(cleanIp)) {
      setBranchFeedback({ ok: false, text: 'صيغة عنوان IP للفرع غير صحيحة.' });
      return;
    }

    const parsedLat = brLat.trim() === '' ? null : Number(brLat);
    const parsedLng = brLng.trim() === '' ? null : Number(brLng);
    if (brGeoEnabled && (parsedLat === null || parsedLng === null)) {
      setBranchFeedback({
        ok: false,
        text: 'عند تفعيل التحقق الجغرافي يجب إدخال خطوط الطول والعرض أو التقاط موقعك.',
      });
      return;
    }
    if (
      parsedLat !== null &&
      (Number.isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90)
    ) {
      setBranchFeedback({ ok: false, text: 'قيمة خط العرض (Latitude) غير صالحة.' });
      return;
    }
    if (
      parsedLng !== null &&
      (Number.isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180)
    ) {
      setBranchFeedback({ ok: false, text: 'قيمة خط الطول (Longitude) غير صالحة.' });
      return;
    }

    const parsedRadius = Number(brRadiusMeters);
    if (Number.isNaN(parsedRadius) || parsedRadius < 10 || parsedRadius > 5000) {
      setBranchFeedback({
        ok: false,
        text: 'نطاق المسافة المسموح (GPS) يجب أن يكون بين 10 و 5000 متر.',
      });
      return;
    }

    if (!SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(brShiftStart)) {
      setBranchFeedback({ ok: false, text: 'وقت بداية الدوام الافتراضي غير صحيح.' });
      return;
    }
    const parsedGrace = Number(brGraceMinutes);
    if (Number.isNaN(parsedGrace) || parsedGrace < 0 || parsedGrace > 240) {
      setBranchFeedback({ ok: false, text: 'فترة السماح يجب أن تكون بين 0 و 240.' });
      return;
    }
    const parsedBreak = Number(brMaxBreakMinutes);
    if (Number.isNaN(parsedBreak) || parsedBreak < 1 || parsedBreak > 240) {
      setBranchFeedback({ ok: false, text: 'مدة البريك المسموحة بين 1 و 240 دقيقة.' });
      return;
    }
    const parsedHours = Number(brTargetDailyHours);
    if (Number.isNaN(parsedHours) || parsedHours < 1 || parsedHours > 24) {
      setBranchFeedback({ ok: false, text: 'ساعات العمل اليومية بين 1 و 24 ساعة.' });
      return;
    }

    setSavingBranch(true);
    try {
      const targetRef = editingBranch
        ? doc(db, 'branches', editingBranch.id)
        : doc(collection(db, 'branches'));

      await setDoc(targetRef, {
        name: cleanName,
        allowedIp: cleanIp,
        geoEnabled: brGeoEnabled,
        lat: parsedLat,
        lng: parsedLng,
        radiusMeters: Math.round(parsedRadius),
        shiftStart: brShiftStart,
        graceMinutes: Math.round(parsedGrace),
        maxBreakMinutes: Math.round(parsedBreak),
        targetDailyHours: parsedHours,
        shifts: brShifts.slice(0, SCHEMA_LIMITS.MAX_SHIFTS_PER_BRANCH),
        isActive: true,
        createdAt: editingBranch?.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.id,
      });

      setBranchFeedback({
        ok: true,
        text: editingBranch
          ? `تم تحديث بيانات فرع "${cleanName}" وشيفتاته بنجاح.`
          : `تمت إضافة فرع "${cleanName}" وشيفتاته بنجاح.`,
      });
      resetBranchEditor();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'branches');
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setSavingBranch(false);
    }
  };

  const handleDeleteBranch = async (branchId: string) => {
    setBranchFeedback(null);
    setBusyBranchId(branchId);
    try {
      await deleteDoc(doc(db, 'branches', branchId));
      if (editingBranch?.id === branchId) {
        resetBranchEditor();
      }
      setConfirmDeleteBranchId(null);
      setBranchFeedback({ ok: true, text: 'تم حذف الفرع بنجاح.' });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `branches/${branchId}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyBranchId(null);
    }
  };

  const handleUpdateUserPassword = async (userId: string) => {
    setAccountFeedback(null);
    if (
      editingPassValue.length < SCHEMA_LIMITS.PASSWORD_MIN ||
      editingPassValue.length > SCHEMA_LIMITS.PASSWORD_MAX
    ) {
      setAccountFeedback({
        ok: false,
        text: `كلمة المرور الجديدة يجب أن تكون بين ${SCHEMA_LIMITS.PASSWORD_MIN} و ${SCHEMA_LIMITS.PASSWORD_MAX} أحرف.`,
      });
      return;
    }

    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password: editingPassValue }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setAccountFeedback({
          ok: false,
          text: data.error ?? 'تعذر تحديث كلمة المرور.',
        });
        return;
      }

      setEditingPassUserId(null);
      setEditingPassValue('');
      setAccountFeedback({ ok: true, text: 'تم تحديث كلمة المرور بنجاح.' });
    } catch {
      setAccountFeedback({ ok: false, text: 'تعذر الاتصال بالخادم لتحديث كلمة المرور.' });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteUserAccount = async (userId: string) => {
    setAccountFeedback(null);
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setAccountFeedback({
          ok: false,
          text: data.error ?? 'تعذر حذف الحساب.',
        });
        return;
      }

      setConfirmDeleteUserId(null);
      setAccounts((prev) => prev.filter((u) => u.id !== userId));
      setAccountFeedback({ ok: true, text: 'تم حذف الحساب بنجاح.' });
    } catch {
      setAccountFeedback({ ok: false, text: 'تعذر الاتصال بالخادم أثناء حذف الحساب.' });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSaveBranchSettings = async () => {
    setSettingsFeedback(null);
    const cleanBranch = branchNameInput.trim().slice(0, 80);
    const cleanIp = allowedIpInput.trim().slice(0, SCHEMA_LIMITS.IP_MAX);
    const cleanShiftStart = shiftStartInput.trim();
    const parsedGrace = Number(graceMinutesInput);
    const parsedMaxBreak = Number(maxBreakMinutesInput);
    const parsedTargetHours = Number(targetDailyHoursInput);

    if (cleanIp.length > 0 && !SCHEMA_LIMITS.IP_PATTERN.test(cleanIp)) {
      setSettingsFeedback({
        ok: false,
        text: 'صيغة عنوان IP غير صحيحة.',
      });
      return;
    }

    if (!SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(cleanShiftStart)) {
      setSettingsFeedback({
        ok: false,
        text: 'صيغة وقت بداية الدوام غير صحيحة (مثال: 09:00).',
      });
      return;
    }

    if (Number.isNaN(parsedGrace) || parsedGrace < 0 || parsedGrace > 240) {
      setSettingsFeedback({
        ok: false,
        text: 'فترة السماح يجب أن تكون بين 0 و 240 دقيقة.',
      });
      return;
    }

    if (Number.isNaN(parsedMaxBreak) || parsedMaxBreak < 1 || parsedMaxBreak > 240) {
      setSettingsFeedback({
        ok: false,
        text: 'مدة البريك المسموحة يجب أن تكون بين 1 و 240 دقيقة.',
      });
      return;
    }

    if (
      Number.isNaN(parsedTargetHours) ||
      parsedTargetHours < 1 ||
      parsedTargetHours > 24
    ) {
      setSettingsFeedback({
        ok: false,
        text: 'ساعات العمل المستهدفة يجب أن تكون بين 1 و 24 ساعة.',
      });
      return;
    }

    setSettingsSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'branch'),
        {
          branchName: cleanBranch || 'الفرع الرئيسي',
          allowedIp: cleanIp,
          shiftStart: cleanShiftStart,
          graceMinutes: Math.round(parsedGrace),
          maxBreakMinutes: Math.round(parsedMaxBreak),
          targetDailyHours: parsedTargetHours,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.id,
        },
        { merge: true }
      );
      setSettingsFeedback({
        ok: true,
        text: 'تم حفظ إعدادات شبكة الفرع وسياسة الدوام والبريك بنجاح.',
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'settings/branch');
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setSettingsSaving(false);
    }
  };

  const openEmployeeHrModal = (emp: Employee) => {
    setEditingHrEmp(emp);
    setEmpBranchId(emp.branchId ?? '');
    setEmpShiftId(emp.shiftId ?? '');
    setEmpShiftStart(emp.shiftStart ?? '');
    setEmpGraceMinutes(
      typeof emp.graceMinutes === 'number' ? String(emp.graceMinutes) : ''
    );
    setEmpMaxBreakMinutes(
      typeof emp.maxBreakMinutes === 'number' ? String(emp.maxBreakMinutes) : ''
    );
    setEmpTargetDailyHours(
      typeof emp.targetDailyHours === 'number' ? String(emp.targetDailyHours) : ''
    );
    setEmpHourlyRate(
      typeof emp.hourlyRate === 'number' ? String(emp.hourlyRate) : ''
    );
  };

  const handleSaveEmployeeHr = async () => {
    if (!editingHrEmp) return;
    const cleanShift = empShiftStart.trim();
    if (cleanShift && !SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(cleanShift)) {
      setAccountFeedback({ ok: false, text: 'وقت بداية الدوام غير صالح.' });
      return;
    }
    const graceVal = empGraceMinutes.trim() === '' ? null : Number(empGraceMinutes);
    if (graceVal !== null && (Number.isNaN(graceVal) || graceVal < 0 || graceVal > 240)) {
      setAccountFeedback({ ok: false, text: 'فترة السماح يجب أن تكون بين 0 و 240.' });
      return;
    }
    const maxBreakVal =
      empMaxBreakMinutes.trim() === '' ? null : Number(empMaxBreakMinutes);
    if (
      maxBreakVal !== null &&
      (Number.isNaN(maxBreakVal) || maxBreakVal < 1 || maxBreakVal > 240)
    ) {
      setAccountFeedback({ ok: false, text: 'مدة البريك يجب أن تكون بين 1 و 240.' });
      return;
    }
    const targetHoursVal =
      empTargetDailyHours.trim() === '' ? null : Number(empTargetDailyHours);
    if (
      targetHoursVal !== null &&
      (Number.isNaN(targetHoursVal) || targetHoursVal < 1 || targetHoursVal > 24)
    ) {
      setAccountFeedback({ ok: false, text: 'الساعات المستهدفة يجب أن تكون بين 1 و 24.' });
      return;
    }
    const rateVal = empHourlyRate.trim() === '' ? null : Number(empHourlyRate);
    if (rateVal !== null && (Number.isNaN(rateVal) || rateVal < 0 || rateVal > 100000)) {
      setAccountFeedback({ ok: false, text: 'قيمة أجر الساعة غير صالحة.' });
      return;
    }

    const chosenBranch = branches.find((b) => b.id === empBranchId) ?? null;
    const chosenShift =
      chosenBranch?.shifts.find((s) => s.id === empShiftId) ?? null;

    setSavingHrEmp(true);
    try {
      await updateDoc(doc(db, 'employees', editingHrEmp.id), {
        branchId: chosenBranch?.id ?? null,
        branchName: chosenBranch?.name ?? null,
        shiftId: chosenShift?.id ?? null,
        shiftName: chosenShift?.name ?? null,
        shiftStart: cleanShift || chosenShift?.startTime || null,
        shiftEnd: chosenShift?.endTime ?? null,
        graceMinutes: graceVal !== null ? Math.round(graceVal) : null,
        maxBreakMinutes: maxBreakVal !== null ? Math.round(maxBreakVal) : null,
        targetDailyHours: targetHoursVal,
        hourlyRate: rateVal,
        updatedAt: serverTimestamp(),
      });
      setAccountFeedback({
        ok: true,
        text: `تم حفظ الفرع والشيفت وإعدادات الأجر للموظف "${editingHrEmp.name}".`,
      });
      setEditingHrEmp(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `employees/${editingHrEmp.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setSavingHrEmp(false);
    }
  };

  const handleUnbindDevice = async (emp: Employee) => {
    setBusyEmpId(emp.id);
    try {
      await updateDoc(doc(db, 'employees', emp.id), {
        deviceId: null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `employees/${emp.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyEmpId(null);
    }
  };

  const handleSaveEmployeePin = async (emp: Employee) => {
    const cleanPin = editingPinValue.trim();
    if (
      cleanPin.length < SCHEMA_LIMITS.PIN_MIN ||
      cleanPin.length > SCHEMA_LIMITS.PIN_MAX
    ) {
      setAccountFeedback({
        ok: false,
        text: `رمز PIN يجب أن يكون بين ${SCHEMA_LIMITS.PIN_MIN} و ${SCHEMA_LIMITS.PIN_MAX} أرقام/أحرف.`,
      });
      return;
    }

    setBusyEmpId(emp.id);
    try {
      const pinHash = await hashEmployeePin(emp.id, cleanPin);
      await updateDoc(doc(db, 'employees', emp.id), {
        pinHash,
        updatedAt: serverTimestamp(),
      });
      setEditingPinEmpId(null);
      setEditingPinValue('');
      setAccountFeedback({ ok: true, text: `تم تحديث رمز PIN للموظف "${emp.name}".` });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `employees/${emp.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyEmpId(null);
    }
  };

  const handleDeleteEmployee = async (empId: string) => {
    setBusyEmpId(empId);
    try {
      await deleteDoc(doc(db, 'employees', empId));
      setConfirmDeleteEmpId(null);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, `employees/${empId}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setBusyEmpId(null);
    }
  };

  const ipMatchesBranch =
    !branchSettings.allowedIp ||
    (currentIp && currentIp.trim() === branchSettings.allowedIp.trim());

  return (
    <div dir="rtl" className="space-y-6 text-slate-900">
      {/* بطاقات الإحصاء اللحظية */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>إجمالي الموظفين</span>
            <Users className="h-4 w-4 text-[#3292a6]" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{stats.total}</div>
        </div>

        <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-emerald-700">على رأس العمل</div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-700">{stats.working}</div>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-amber-700">في بريك</div>
          <div className="mt-2 text-2xl font-extrabold text-amber-700">{stats.onBreak}</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">خارج الدوام</div>
          <div className="mt-2 text-2xl font-extrabold text-slate-700">{stats.out}</div>
        </div>
      </div>

      {/* تنبيهات تجاوز البريك أو الغياب */}
      {(breakOverageEmployees.length > 0 || absentEmployees.length > 0) && (
        <div className="space-y-2.5">
          {breakOverageEmployees.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-950">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                <span>
                  تنبيه تجاوز مدة البريك المسموحة ({breakOverageEmployees.length}):{' '}
                  {breakOverageEmployees
                    .map((e) => {
                      const over = employeeInsightsMap.get(e.id)?.breakOverageMinutes ?? 0;
                      return `${e.name} (+${over} د)`;
                    })
                    .join('، ')}
                </span>
              </div>
            </div>
          )}

          {absentEmployees.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-950">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-rose-700 shrink-0" />
                <span>
                  موظفون لم يسجلوا دخولاً بعد انتهاء فترة السماح اليوم ({absentEmployees.length}):{' '}
                  {absentEmployees.map((e) => e.name).join('، ')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* طلبات البريك المعلقة */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <Coffee className="h-5 w-5 text-[#3292a6]" />
            <span>طلبات البريك المعلقة ({pendingBreakRequests.length})</span>
          </h2>
        </div>

        {requestFeedback && (
          <div
            className={`mb-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              requestFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {requestFeedback.text}
          </div>
        )}

        {pendingBreakRequests.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد طلبات بريك بانتظار الاعتماد حالياً.</p>
        ) : (
          <div className="space-y-2.5">
            {pendingBreakRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f2eadc] bg-[#fcfaf5] p-3.5"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">{req.employeeName}</div>
                  <div className="text-xs text-slate-500">
                    {req.reason ? `السبب: ${req.reason}` : 'طلب بريك اعتيادي'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyRequestId === req.id}
                    onClick={() => void handleReviewBreakRequest(req, 'approved')}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#3292a6] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    <span>موافقة</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyRequestId === req.id}
                    onClick={() => void handleReviewBreakRequest(req, 'rejected')}
                    className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    <span>رفض</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* طلبات تعديل السجل المنسي والاستئذان والإجازات */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <FileCheck2 className="h-5 w-5 text-[#3292a6]" />
            <span>
              طلبات تعديل السجل المنسي والاستئذان والإجازات ({pendingAttendanceRequests.length})
            </span>
          </h2>
        </div>

        {attRequestFeedback && (
          <div
            className={`mb-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              attRequestFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {attRequestFeedback.text}
          </div>
        )}

        {pendingAttendanceRequests.length === 0 ? (
          <p className="text-sm text-slate-500">
            لا توجد طلبات تعديل سجل أو استئذان أو إجازة قيد المراجعة حالياً.
          </p>
        ) : (
          <div className="space-y-2.5">
            {pendingAttendanceRequests.map((req) => (
              <div
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f2eadc] bg-[#fcfaf5] p-3.5"
              >
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                    <span>{req.employeeName}</span>
                    <span className="rounded-lg bg-[#e9f7fd] px-2 py-0.5 text-xs text-[#1e606e]">
                      {getAttendanceRequestTypeLabelAr(req.type)}
                    </span>
                    <span className="font-mono text-xs text-slate-600" dir="ltr">
                      {req.targetDate} {req.targetTime || ''}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">السبب: {req.reason}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyAttReqId === req.id}
                    onClick={() => void handleReviewAttendanceRequest(req, 'approved')}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#3292a6] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    <span>اعتماد</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAttReqId === req.id}
                    onClick={() => void handleReviewAttendanceRequest(req, 'rejected')}
                    className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    <span>رفض</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* إدارة الفروع والشيفتات والموقع الجغرافي */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <Building2 className="h-5 w-5 text-[#3292a6]" />
            <span>إدارة الفروع والشيفتات والنطاق الجغرافي ({branches.length})</span>
          </h2>
          {editingBranch && (
            <button
              type="button"
              onClick={resetBranchEditor}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              إلغاء التعديل وإنشاء فرع جديد
            </button>
          )}
        </div>

        <div className="rounded-xl border border-sky-100 bg-[#f8fcff] p-4 space-y-4">
          <div className="text-xs font-extrabold text-[#1e606e]">
            {editingBranch ? `تعديل فرع: ${editingBranch.name}` : 'إضافة فرع جديد وإعداداته'}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                اسم الفرع
              </label>
              <input
                type="text"
                value={brName}
                onChange={(e) => setBrName(e.target.value)}
                placeholder="مثال: فرع الرياض الرئيسي"
                className="w-full rounded-xl border border-sky-100 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                IP الشبكة للفرع (اختياري)
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={brAllowedIp}
                  onChange={(e) => setBrAllowedIp(e.target.value)}
                  placeholder="اتركه فارغاً لأي شبكة"
                  dir="ltr"
                  className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#3292a6]"
                />
                {currentIp && (
                  <button
                    type="button"
                    onClick={() => setBrAllowedIp(currentIp)}
                    title="استخدام IP الحالي"
                    className="shrink-0 rounded-xl border border-sky-200 bg-[#e9f7fd] px-2.5 text-[11px] font-bold text-[#1e606e] hover:bg-[#d7f0fb]"
                  >
                    IP الحالي
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                بداية الدوام الافتراضية
              </label>
              <input
                type="time"
                value={brShiftStart}
                onChange={(e) => setBrShiftStart(e.target.value)}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#3292a6]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                حد البريك المسموح (دقائق)
              </label>
              <input
                type="number"
                min={1}
                max={240}
                value={brMaxBreakMinutes}
                onChange={(e) => setBrMaxBreakMinutes(e.target.value)}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#3292a6]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                ساعات العمل اليومية
              </label>
              <input
                type="number"
                min={1}
                max={24}
                step={0.5}
                value={brTargetDailyHours}
                onChange={(e) => setBrTargetDailyHours(e.target.value)}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#3292a6]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">
                فترة السماح للتأخير (دقائق)
              </label>
              <input
                type="number"
                min={0}
                max={240}
                value={brGraceMinutes}
                onChange={(e) => setBrGraceMinutes(e.target.value)}
                className="w-full rounded-xl border border-sky-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#3292a6]"
              />
            </div>
          </div>

          {/* إعداد الموقع الجغرافي GPS للفرع */}
          <div className="rounded-xl border border-sky-100 bg-white p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={brGeoEnabled}
                  onChange={(e) => setBrGeoEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#3292a6]"
                />
                <MapPin className="h-4 w-4 text-[#3292a6]" />
                <span>تفعيل قفل الموقع الجغرافي (GPS Geofence) لهذا الفرع</span>
              </label>

              <button
                type="button"
                disabled={capturingBranchGps}
                onClick={() => void handleCaptureBranchGps()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-[#e9f7fd] px-3 py-2 text-xs font-bold text-[#1e606e] hover:bg-[#d7f0fb] disabled:opacity-50"
              >
                <Crosshair className="h-3.5 w-3.5" />
                <span>
                  {capturingBranchGps ? 'جاري تحديد الموقع...' : 'التقاط موقعي الحالي (GPS)'}
                </span>
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  خط العرض (Latitude)
                </label>
                <input
                  type="number"
                  step="any"
                  value={brLat}
                  onChange={(e) => setBrLat(e.target.value)}
                  placeholder="24.713600"
                  dir="ltr"
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  خط الطول (Longitude)
                </label>
                <input
                  type="number"
                  step="any"
                  value={brLng}
                  onChange={(e) => setBrLng(e.target.value)}
                  placeholder="46.675300"
                  dir="ltr"
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  نصف قطر النطاق المسموح (متر)
                </label>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={brRadiusMeters}
                  onChange={(e) => setBrRadiusMeters(e.target.value)}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
            </div>
          </div>

          {/* إدارة شيفتات الفرع */}
          <div className="rounded-xl border border-sky-100 bg-white p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-slate-800">
                الشيفتات الخاصة بالفرع ({brShifts.length})
              </span>
              <span className="text-[11px] text-slate-500">
                حدّد كل شيفت من الساعة كم إلى الساعة كم
              </span>
            </div>

            {brShifts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {brShifts.map((sh) => (
                  <div
                    key={sh.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-sky-100 bg-[#fcfaf5] px-3 py-1.5 text-xs"
                  >
                    <span className="font-bold text-slate-800">{sh.name}</span>
                    <span className="font-mono text-slate-600" dir="ltr">
                      {sh.startTime}–{sh.endTime}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveShift(sh.id)}
                      aria-label={`حذف ${sh.name}`}
                      className="rounded p-0.5 text-rose-600 hover:bg-rose-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-12 items-end">
              <div className="sm:col-span-5">
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  اسم الشيفت
                </label>
                <input
                  type="text"
                  value={draftShiftName}
                  onChange={(e) => setDraftShiftName(e.target.value)}
                  placeholder="مثال: الشيفت المسائي"
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  من الساعة
                </label>
                <input
                  type="time"
                  value={draftShiftStart}
                  onChange={(e) => setDraftShiftStart(e.target.value)}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-[11px] font-bold text-slate-500">
                  إلى الساعة
                </label>
                <input
                  type="time"
                  value={draftShiftEnd}
                  onChange={(e) => setDraftShiftEnd(e.target.value)}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddDraftShift}
                  className="w-full min-h-[40px] inline-flex items-center justify-center gap-1 rounded-xl border border-sky-200 bg-[#e9f7fd] px-3 py-2 text-xs font-bold text-[#1e606e] hover:bg-[#d7f0fb]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>إضافة شيفت</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={savingBranch}
              onClick={() => void handleSaveBranch()}
              className="min-h-[42px] rounded-xl bg-[#3292a6] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
            >
              {savingBranch
                ? 'جاري الحفظ...'
                : editingBranch
                  ? 'حفظ تعديلات الفرع'
                  : 'إضافة الفرع وحفظ الإعدادات'}
            </button>
          </div>
        </div>

        {branchFeedback && (
          <div
            className={`mt-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              branchFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {branchFeedback.text}
          </div>
        )}

        {/* قائمة الفروع المسجلة */}
        {branches.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {branches.map((br) => (
              <div
                key={br.id}
                className="rounded-xl border border-sky-100 bg-[#fcfaf5] p-3.5 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-slate-900">
                      {br.name}
                    </span>
                    <span className="rounded-lg bg-[#e9f7fd] px-2 py-0.5 text-[11px] font-bold text-[#1e606e]">
                      {br.geoEnabled
                        ? `GPS مفعّل (${br.radiusMeters}م)`
                        : 'GPS غير مفروض'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span>IP: {br.allowedIp || 'أي شبكة'}</span>
                    <span>البريك: {br.maxBreakMinutes} د</span>
                    <span>الدوام: {br.targetDailyHours} س</span>
                  </div>
                  {br.shifts && br.shifts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {br.shifts.map((s) => (
                        <span
                          key={s.id}
                          className="rounded-md border border-sky-100 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                        >
                          {s.name}: {s.startTime}–{s.endTime}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-sky-100/70 pt-2">
                  <button
                    type="button"
                    onClick={() => openEditBranch(br)}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-bold text-[#1e606e] hover:bg-sky-50"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>تعديل</span>
                  </button>
                  {confirmDeleteBranchId === br.id ? (
                    <button
                      type="button"
                      disabled={busyBranchId === br.id}
                      onClick={() => void handleDeleteBranch(br.id)}
                      className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white"
                    >
                      تأكيد الحذف
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteBranchId(br.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>حذف</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* إعدادات شبكة الفرع وقفل الـ IP وسياسة الدوام */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <Shield className="h-5 w-5 text-[#3292a6]" />
            <span>إعدادات الفرع والشبكة وسياسة الدوام</span>
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              ipMatchesBranch
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-800'
            }`}
          >
            IP الحالي: {currentIp || 'غير متاح'}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">اسم الفرع</label>
            <input
              type="text"
              value={branchNameInput}
              onChange={(e) => setBranchNameInput(e.target.value)}
              placeholder="مثال: فرع الرياض"
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              عنوان IP المسموح للشبكة (اتركه فارغاً للسماح بأي شبكة)
            </label>
            <input
              type="text"
              value={allowedIpInput}
              onChange={(e) => setAllowedIpInput(e.target.value)}
              placeholder="مثال: 185.x.x.x"
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              بداية الدوام (shiftStart)
            </label>
            <input
              type="time"
              value={shiftStartInput}
              onChange={(e) => setShiftStartInput(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              فترة السماح للتأخير (دقائق)
            </label>
            <input
              type="number"
              min={0}
              max={240}
              value={graceMinutesInput}
              onChange={(e) => setGraceMinutesInput(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              حد البريك المسموح (دقائق)
            </label>
            <input
              type="number"
              min={1}
              max={240}
              value={maxBreakMinutesInput}
              onChange={(e) => setMaxBreakMinutesInput(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">
              ساعات العمل اليومية المستهدفة
            </label>
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={targetDailyHoursInput}
              onChange={(e) => setTargetDailyHoursInput(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={settingsSaving}
            onClick={() => void handleSaveBranchSettings()}
            className="rounded-xl bg-[#3292a6] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
          >
            {settingsSaving ? 'جاري الحفظ...' : 'حفظ إعدادات الفرع والدوام'}
          </button>
          {currentIp && (
            <button
              type="button"
              onClick={() => setAllowedIpInput(currentIp)}
              className="rounded-xl border border-sky-200 bg-[#e9f7fd] px-3.5 py-2.5 text-xs font-bold text-[#1e606e] hover:bg-[#d7f0fb]"
            >
              اعتماد IP الحالي ({currentIp})
            </button>
          )}
        </div>

        {settingsFeedback && (
          <div
            className={`mt-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              settingsFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {settingsFeedback.text}
          </div>
        )}
      </div>

      {/* تقارير الفترات الزمنية وتصدير CSV */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <CalendarRange className="h-5 w-5 text-[#3292a6]" />
            <span>تجميع ساعات العمل والبريك وتقارير CSV</span>
          </h2>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => applyDatePreset('today')}
              className="rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-sky-50"
            >
              اليوم
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('week')}
              className="rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-sky-50"
            >
              آخر 7 أيام
            </button>
            <button
              type="button"
              onClick={() => applyDatePreset('month')}
              className="rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-sky-50"
            >
              الشهر الحالي
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">من تاريخ</label>
            <input
              type="date"
              value={reportFromDate}
              onChange={(e) => setReportFromDate(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">إلى تاريخ</label>
            <input
              type="date"
              value={reportToDate}
              onChange={(e) => setReportToDate(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">نوع التقرير</label>
            <select
              value={reportMode}
              onChange={(e) => setReportMode(e.target.value as PeriodReportMode)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
            >
              <option value="summary">ملخص تراكمي للفترة</option>
              <option value="daily">تفصيل يومي لكل موظف</option>
              <option value="detailed">سجل الحركات التفصيلي</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-600">تحديد موظف</label>
            <select
              value={reportEmployeeId}
              onChange={(e) => setReportEmployeeId(e.target.value)}
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
            >
              <option value="all">جميع الموظفين</option>
              {reportEmployeeOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={reportEmpSearch}
              onChange={(e) => setReportEmpSearch(e.target.value)}
              placeholder="بحث باسم الموظف أو المسمى للتقرير..."
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] py-2 pr-9 pl-3 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={periodReportLoading}
              onClick={() => void handleGeneratePeriodReport(false)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#3292a6] bg-[#e9f7fd] px-4 py-2.5 text-xs font-bold text-[#1e606e] hover:bg-[#d7f0fb] disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>{periodReportLoading ? 'جاري الحساب...' : 'معاينة التقرير'}</span>
            </button>
            <button
              type="button"
              disabled={periodReportLoading}
              onClick={() => void handleGeneratePeriodReport(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#3292a6] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              <span>تصدير CSV</span>
            </button>
          </div>
        </div>

        {periodReportFeedback && (
          <div
            className={`mt-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              periodReportFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {periodReportFeedback.text}
          </div>
        )}

        {/* معاينة نتائج التقرير */}
        {generatedReportMode === 'summary' && periodReportRows && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">الموظف</th>
                  <th className="p-2.5 font-extrabold">أيام الحضور</th>
                  <th className="p-2.5 font-extrabold">التأخير (د)</th>
                  <th className="p-2.5 font-extrabold">إجمالي البريك</th>
                  <th className="p-2.5 font-extrabold">صافي العمل</th>
                  <th className="p-2.5 font-extrabold">إضافي / فرق</th>
                  <th className="p-2.5 font-extrabold">الراتب التقديري</th>
                </tr>
              </thead>
              <tbody>
                {periodReportRows.map((r) => (
                  <tr
                    key={r.employeeId}
                    className={`border-b border-sky-50 ${
                      r.breakOverageDays > 0 ? 'bg-amber-50/70' : ''
                    }`}
                  >
                    <td className="p-2.5 font-bold">{r.name}</td>
                    <td className="p-2.5">{r.attendanceDays}</td>
                    <td className="p-2.5">
                      {r.totalLateMinutes > 0 ? (
                        <span className="font-bold text-amber-800">
                          {r.totalLateMinutes} د
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="p-2.5">
                      <span>{r.totalBreakFormatted}</span>
                      {r.breakOverageDays > 0 && (
                        <span className="mr-1.5 text-[11px] font-bold text-rose-700">
                          (تجاوز {r.breakOverageDays} يوم)
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-bold text-[#267484]">
                      {r.netWorkFormatted} ({r.netWorkDecimalHours}h)
                    </td>
                    <td className="p-2.5 font-mono" dir="ltr">
                      <span
                        className={
                          r.overtimeDiffFormatted.startsWith('+')
                            ? 'font-bold text-emerald-700'
                            : r.overtimeDiffFormatted.startsWith('-')
                              ? 'font-bold text-rose-700'
                              : 'text-slate-600'
                        }
                      >
                        {r.overtimeDiffFormatted}h
                      </span>
                    </td>
                    <td className="p-2.5 font-bold">{r.estimatedPayFormatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {generatedReportMode === 'daily' && periodDailyRows && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">التاريخ</th>
                  <th className="p-2.5 font-extrabold">الموظف</th>
                  <th className="p-2.5 font-extrabold">أول دخول</th>
                  <th className="p-2.5 font-extrabold">آخر خروج</th>
                  <th className="p-2.5 font-extrabold">تأخير</th>
                  <th className="p-2.5 font-extrabold">البريك</th>
                  <th className="p-2.5 font-extrabold">صافي العمل</th>
                  <th className="p-2.5 font-extrabold">إضافي / فرق</th>
                  <th className="p-2.5 font-extrabold">الراتب</th>
                </tr>
              </thead>
              <tbody>
                {periodDailyRows.map((d) => (
                  <tr
                    key={d.rowKey}
                    className={`border-b border-sky-50 ${
                      d.breakOverageMinutes > 0 ? 'bg-amber-50/70' : ''
                    }`}
                  >
                    <td className="p-2.5">{d.date}</td>
                    <td className="p-2.5 font-bold">{d.name}</td>
                    <td className="p-2.5">{d.firstCheckInFormatted}</td>
                    <td className="p-2.5">{d.lastCheckOutFormatted}</td>
                    <td className="p-2.5">
                      {d.lateMinutes > 0 ? (
                        <span className="font-bold text-amber-800">
                          {d.lateMinutes} د
                        </span>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="p-2.5">
                      <span>{d.totalBreakFormatted}</span>
                      {d.breakOverageMinutes > 0 && (
                        <span className="mr-1 text-[11px] font-bold text-rose-700">
                          (+{d.breakOverageMinutes} د)
                        </span>
                      )}
                    </td>
                    <td className="p-2.5 font-bold text-[#267484]">
                      {d.netWorkFormatted}
                    </td>
                    <td className="p-2.5 font-mono" dir="ltr">
                      <span
                        className={
                          d.overtimeDiffFormatted.startsWith('+')
                            ? 'font-bold text-emerald-700'
                            : d.overtimeDiffFormatted.startsWith('-')
                              ? 'font-bold text-rose-700'
                              : 'text-slate-600'
                        }
                      >
                        {d.overtimeDiffFormatted}h
                      </span>
                    </td>
                    <td className="p-2.5 font-bold">{d.estimatedPayFormatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {generatedReportMode === 'detailed' && periodDetailedRows && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">الموظف</th>
                  <th className="p-2.5 font-extrabold">الحركة</th>
                  <th className="p-2.5 font-extrabold">الوقت</th>
                  <th className="p-2.5 font-extrabold">IP</th>
                </tr>
              </thead>
              <tbody>
                {periodDetailedRows.map((row) => (
                  <tr key={row.id} className="border-b border-sky-50">
                    <td className="p-2.5 font-bold">{row.employeeName}</td>
                    <td className="p-2.5">{row.actionLabel}</td>
                    <td className="p-2.5">{row.dateTimeFormatted}</td>
                    <td className="p-2.5">{row.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* إدارة حسابات الدخول والموظفين */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <UserPlus className="h-5 w-5 text-[#3292a6]" />
            <span>إضافة حساب جديد وإدارة الحسابات</span>
          </h2>
          <button
            type="button"
            onClick={() => void loadAccounts()}
            className="inline-flex items-center gap-1 rounded-xl border border-sky-100 bg-[#fcfaf5] px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-sky-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>تحديث</span>
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="اسم المستخدم"
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="كلمة المرور"
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
          />
          <input
            type="text"
            value={newRoleTitle}
            onChange={(e) => setNewRoleTitle(e.target.value)}
            placeholder="المسمى الوظيفي (اختياري)"
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
          >
            <option value="user">موظف</option>
            <option value="admin">مدير</option>
          </select>
          <select
            value={newUserBranchId}
            onChange={(e) => {
              setNewUserBranchId(e.target.value);
              setNewUserShiftId('');
            }}
            aria-label="الفرع التابع له الموظف"
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6]"
          >
            <option value="">الفرع الافتراضي العام</option>
            {branches.map((br) => (
              <option key={br.id} value={br.id}>
                فرع: {br.name}
              </option>
            ))}
          </select>
          <select
            value={newUserShiftId}
            onChange={(e) => setNewUserShiftId(e.target.value)}
            disabled={!selectedNewUserBranch || selectedNewUserBranch.shifts.length === 0}
            aria-label="الشيفت التابع له الموظف"
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3.5 py-2.5 text-sm outline-none focus:border-[#3292a6] disabled:opacity-60"
          >
            <option value="">
              {selectedNewUserBranch
                ? `افتراضي الفرع (${selectedNewUserBranch.shiftStart})`
                : 'اختر الفرع أولاً للشيفت'}
            </option>
            {selectedNewUserBranch?.shifts.map((sh) => (
              <option key={sh.id} value={sh.id}>
                {sh.name} ({sh.startTime} - {sh.endTime})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={creatingAccount}
          onClick={() => void handleCreateUserAccount()}
          className="mt-3 min-h-[42px] rounded-xl bg-[#3292a6] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
        >
          {creatingAccount ? 'جاري الإنشاء...' : 'إنشاء الحساب وربطه بالموظف'}
        </button>

        {accountFeedback && (
          <div
            className={`mt-3 rounded-xl px-4 py-2.5 text-xs font-bold ${
              accountFeedback.ok
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {accountFeedback.text}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          {accountsLoading ? (
            <p className="text-xs text-slate-500">جاري تحميل الحسابات...</p>
          ) : (
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">المستخدم</th>
                  <th className="p-2.5 font-extrabold">الدور</th>
                  <th className="p-2.5 font-extrabold">الفرع / الشيفت</th>
                  <th className="p-2.5 font-extrabold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => {
                  const linkedEmp = employeeByIdMap.get(acc.employeeId);
                  const policy = getEmployeePolicy(linkedEmp, branchSettings, branches);
                  return (
                  <tr key={acc.id} className="border-b border-sky-50">
                    <td className="p-2.5 font-bold">{acc.username}</td>
                    <td className="p-2.5">{acc.role === 'admin' ? 'مدير' : 'موظف'}</td>
                    <td className="p-2.5 text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {policy.branchName}
                      </span>
                      {policy.shiftName ? ` · ${policy.shiftName}` : ''}
                    </td>
                    <td className="p-2.5">
                      {editingPassUserId === acc.id ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="password"
                            value={editingPassValue}
                            onChange={(e) => setEditingPassValue(e.target.value)}
                            placeholder="كلمة مرور جديدة"
                            className="w-36 rounded-lg border border-sky-200 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            disabled={busyUserId === acc.id}
                            onClick={() => void handleUpdateUserPassword(acc.id)}
                            className="rounded-lg bg-[#3292a6] px-2.5 py-1 text-xs font-bold text-white"
                          >
                            حفظ
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPassUserId(null);
                              setEditingPassValue('');
                            }}
                            className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700"
                          >
                            إلغاء
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingPassUserId(acc.id);
                              setEditingPassValue('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-sky-50"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            <span>تغيير كلمة المرور</span>
                          </button>
                          {acc.id !== currentUser.id &&
                            (confirmDeleteUserId === acc.id ? (
                              <button
                                type="button"
                                disabled={busyUserId === acc.id}
                                onClick={() => void handleDeleteUserAccount(acc.id)}
                                className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white"
                              >
                                تأكيد الحذف
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUserId(acc.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>حذف</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* دليل الموظفين والحالة اللحظية */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <CheckCircle2 className="h-5 w-5 text-[#3292a6]" />
            <span>دليل الموظفين والحالة اللحظية</span>
          </h2>
          <button
            type="button"
            onClick={handleExportSummary}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#3292a6] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#267484]"
          >
            <Download className="h-4 w-4" />
            <span>تصدير ملخص الحالة (CSV)</span>
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2.5">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث عن موظف..."
              className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] py-2 pr-9 pl-3 text-sm outline-none focus:border-[#3292a6]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | EmployeeStatus)}
            className="rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
          >
            <option value="all">جميع الحالات</option>
            <option value="working">على رأس العمل</option>
            <option value="break">في بريك</option>
            <option value="out">خارج الدوام</option>
          </select>
        </div>

        {employeesLoading ? (
          <p className="text-xs text-slate-500">جاري تحميل بيانات الموظفين...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">الموظف</th>
                  <th className="p-2.5 font-extrabold">الحالة</th>
                  <th className="p-2.5 font-extrabold">الدوام / الالتزام</th>
                  <th className="p-2.5 font-extrabold">البريك</th>
                  <th className="p-2.5 font-extrabold">صافي العمل</th>
                  <th className="p-2.5 font-extrabold">الجهاز</th>
                  <th className="p-2.5 font-extrabold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => {
                  const { liveBreakMs, netWorkMs, insights } =
                    getEmployeeMetrics(emp);
                  return (
                    <tr
                      key={emp.id}
                      className={`border-b border-sky-50 ${
                        insights.isBreakExceeded
                          ? 'bg-amber-50/80'
                          : insights.isAbsent
                            ? 'bg-rose-50/40'
                            : ''
                      }`}
                    >
                      <td className="p-2.5">
                        <div className="font-bold">{emp.name}</div>
                        <div className="text-xs text-slate-500">
                          {emp.roleTitle} · {insights.policy.branchName}
                          {insights.policy.shiftName ? ` (${insights.policy.shiftName})` : ''}
                          {insights.policy.hourlyRate !== null
                            ? ` · ${insights.policy.hourlyRate}/س`
                            : ''}
                        </div>
                      </td>
                      <td className="p-2.5">
                        <StatusText status={emp.status} />
                      </td>
                      <td className="p-2.5 text-xs">
                        {insights.hasApprovedLeaveToday ? (
                          <span className="font-bold text-teal-700">إجازة معتمدة</span>
                        ) : insights.isAbsent ? (
                          <span className="font-bold text-rose-700">
                            غائب ({insights.policy.shiftStart})
                          </span>
                        ) : insights.lateMinutes > 0 ? (
                          <span className="font-bold text-amber-800">
                            متأخر {insights.lateMinutes} د
                          </span>
                        ) : insights.hasCheckedInToday ? (
                          <span className="font-semibold text-emerald-700">
                            في الموعد ({insights.policy.shiftStart})
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            الدوام {insights.policy.shiftStart}
                          </span>
                        )}
                      </td>
                      <td className="p-2.5">
                        <span
                          className={
                            insights.isBreakExceeded
                              ? 'font-bold text-rose-700'
                              : ''
                          }
                        >
                          {formatDurationAr(liveBreakMs)}
                        </span>
                        {insights.isBreakExceeded && (
                          <div className="text-[11px] font-bold text-rose-700">
                            تجاوز (+{insights.breakOverageMinutes} د)
                          </div>
                        )}
                      </td>
                      <td className="p-2.5 font-bold text-[#267484]">
                        {formatDurationAr(netWorkMs)}
                      </td>
                      <td className="p-2.5">{emp.deviceId ? 'مرتبط' : 'غير مرتبط'}</td>
                      <td className="p-2.5">
                        {editingPinEmpId === emp.id ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="text"
                              value={editingPinValue}
                              onChange={(e) => setEditingPinValue(e.target.value)}
                              placeholder="PIN جديد"
                              className="w-24 rounded-lg border border-sky-200 px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={busyEmpId === emp.id}
                              onClick={() => void handleSaveEmployeePin(emp)}
                              className="rounded-lg bg-[#3292a6] px-2.5 py-1 text-xs font-bold text-white"
                            >
                              حفظ
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPinEmpId(null);
                                setEditingPinValue('');
                              }}
                              className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEmployeeHrModal(emp)}
                              className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-[#e9f7fd] px-2.5 py-1 text-xs font-bold text-[#1e606e] hover:bg-[#d7f0fb]"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                              <span>الدوام والأجر</span>
                            </button>
                            {emp.deviceId && (
                              <button
                                type="button"
                                disabled={busyEmpId === emp.id}
                                onClick={() => void handleUnbindDevice(emp)}
                                className="inline-flex items-center gap-1 rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-sky-50"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                                <span>فك الربط</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPinEmpId(emp.id);
                                setEditingPinValue('');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-sky-100 bg-[#fcfaf5] px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-sky-50"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>PIN</span>
                            </button>
                            {confirmDeleteEmpId === emp.id ? (
                              <button
                                type="button"
                                disabled={busyEmpId === emp.id}
                                onClick={() => void handleDeleteEmployee(emp.id)}
                                className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-bold text-white"
                              >
                                تأكيد
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteEmpId(emp.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* سجل الحركات المباشر */}
      <div className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-900">
            <History className="h-5 w-5 text-[#3292a6]" />
            <span>سجل الحركات المباشر</span>
          </h2>
          <button
            type="button"
            onClick={() => exportLogsToCsv(logs)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#3292a6] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#267484]"
          >
            <Download className="h-4 w-4" />
            <span>تصدير السجل (CSV)</span>
          </button>
        </div>

        {logsLoading ? (
          <p className="text-xs text-slate-500">جاري تحميل سجل الحركات...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#e9f7fd] text-slate-800">
                  <th className="p-2.5 font-extrabold">الموظف</th>
                  <th className="p-2.5 font-extrabold">الحركة</th>
                  <th className="p-2.5 font-extrabold">الفرع / GPS</th>
                  <th className="p-2.5 font-extrabold">الوقت</th>
                  <th className="p-2.5 font-extrabold">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-sky-50">
                    <td className="p-2.5 font-bold">{log.employeeName}</td>
                    <td className="p-2.5">{getActionLabelAr(log.action)}</td>
                    <td className="p-2.5 text-xs">
                      <div>{log.branchName || '—'}</div>
                      {typeof log.distanceMeters === 'number' && (
                        <div className="text-[11px] font-bold text-[#267484]">
                          {log.distanceMeters}م
                        </div>
                      )}
                    </td>
                    <td className="p-2.5">
                      {log.timestamp ? formatDateTimeAr(log.timestamp.toDate()) : '—'}
                    </td>
                    <td className="p-2.5">{log.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* نافذة تخصيص دوام وأجر موظف */}
      {editingHrEmp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-sky-100 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-sky-100 pb-3">
              <h3 className="text-base font-extrabold text-slate-900">
                إعدادات الدوام والأجر: {editingHrEmp.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingHrEmp(null)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              اترك الحقل فارغاً لاستخدام الإعداد الافتراضي للفرع تلقائياً.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  الفرع التابع له
                </label>
                <select
                  value={empBranchId}
                  onChange={(e) => {
                    setEmpBranchId(e.target.value);
                    setEmpShiftId('');
                  }}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                >
                  <option value="">الفرع الافتراضي العام</option>
                  {branches.map((br) => (
                    <option key={br.id} value={br.id}>
                      {br.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  الشيفت
                </label>
                <select
                  value={empShiftId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setEmpShiftId(id);
                    const sh = selectedModalBranch?.shifts.find((s) => s.id === id);
                    if (sh) {
                      setEmpShiftStart(sh.startTime);
                    }
                  }}
                  disabled={!selectedModalBranch || selectedModalBranch.shifts.length === 0}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6] disabled:opacity-60"
                >
                  <option value="">
                    {selectedModalBranch ? 'افتراضي الفرع' : 'اختر الفرع أولاً'}
                  </option>
                  {selectedModalBranch?.shifts.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} ({sh.startTime} - {sh.endTime})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  بداية الدوام ({selectedModalBranch?.shiftStart ?? branchSettings.shiftStart ?? DEFAULT_HR_POLICY.SHIFT_START})
                </label>
                <input
                  type="time"
                  value={empShiftStart}
                  onChange={(e) => setEmpShiftStart(e.target.value)}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  فترة السماح (دقائق)
                </label>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={empGraceMinutes}
                  onChange={(e) => setEmpGraceMinutes(e.target.value)}
                  placeholder={`افتراضي: ${branchSettings.graceMinutes ?? DEFAULT_HR_POLICY.GRACE_MINUTES}`}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  حد البريك (دقائق)
                </label>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={empMaxBreakMinutes}
                  onChange={(e) => setEmpMaxBreakMinutes(e.target.value)}
                  placeholder={`افتراضي: ${branchSettings.maxBreakMinutes ?? DEFAULT_HR_POLICY.MAX_BREAK_MINUTES}`}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  ساعات العمل اليومية المستهدفة
                </label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={0.5}
                  value={empTargetDailyHours}
                  onChange={(e) => setEmpTargetDailyHours(e.target.value)}
                  placeholder={`افتراضي: ${branchSettings.targetDailyHours ?? DEFAULT_HR_POLICY.TARGET_DAILY_HOURS}`}
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  أجر الساعة (hourlyRate) لاحتساب الراتب التقديري في التقارير
                </label>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={0.5}
                  value={empHourlyRate}
                  onChange={(e) => setEmpHourlyRate(e.target.value)}
                  placeholder="اختياري — مثال: 25"
                  className="w-full rounded-xl border border-sky-100 bg-[#f8fcff] px-3 py-2 text-sm outline-none focus:border-[#3292a6]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingHrEmp(null)}
                className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={savingHrEmp}
                onClick={() => void handleSaveEmployeeHr()}
                className="rounded-xl bg-[#3292a6] px-4 py-2 text-xs font-bold text-white hover:bg-[#267484] disabled:opacity-50"
              >
                {savingHrEmp ? 'جاري الحفظ...' : 'حفظ التخصيص'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}