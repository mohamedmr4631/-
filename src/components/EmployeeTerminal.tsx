import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Coffee,
  Eye,
  EyeOff,
  FileCheck2,
  Hourglass,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Wifi,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DEFAULT_HR_POLICY,
  SCHEMA_LIMITS,
  type AttendanceAction,
  type AttendanceLog,
  type AttendanceRequest,
  type AttendanceRequestType,
  type Branch,
  type BranchSettings,
  type BreakRequest,
  type Employee,
  type SessionUser,
} from '../types/attendance';
import {
  computeLiveEmployeeInsights,
  getAttendanceRequestStatusLabelAr,
  getAttendanceRequestTypeLabelAr,
  toLocalDateInput,
} from '../utils/attendanceMetrics';
import {
  formatDurationAr,
  formatTimestampAr,
  getActionLabelAr,
  hashEmployeePin,
} from '../utils/crypto';
import {
  verifyEmployeeLocation,
  type LocationVerificationResult,
} from '../utils/location';
import { BranchLocationCheck } from './BranchLocationCheck';
import { StatusText } from './StatusText';

interface EmployeeTerminalProps {
  currentUser: SessionUser;
  employees: Employee[];
  employeesLoading: boolean;
  branchSettings: BranchSettings;
  branches: Branch[];
  currentIp: string;
  ipLoading: boolean;
  ipError: boolean;
  onRefreshIp: () => void;
  deviceId: string;
  recentLogs: AttendanceLog[];
  logsLoading: boolean;
  breakRequests: BreakRequest[];
  attendanceRequests: AttendanceRequest[];
}

export function EmployeeTerminal({
  currentUser,
  employees,
  employeesLoading,
  branchSettings,
  branches,
  currentIp,
  ipLoading,
  ipError,
  onRefreshIp,
  deviceId,
  recentLogs,
  logsLoading,
  breakRequests,
  attendanceRequests,
}: EmployeeTerminalProps) {
  const isAdmin = currentUser.role === 'admin';
  const [selectedEmpId, setSelectedEmpId] = useState(currentUser.employeeId);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [breakReason, setBreakReason] = useState('');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [submittingAction, setSubmittingAction] = useState<
    AttendanceAction | 'request_break' | null
  >(null);
  const [geoChecking, setGeoChecking] = useState(false);
  const [lastGeoResult, setLastGeoResult] =
    useState<LocationVerificationResult | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [asyncError, setAsyncError] = useState<Error | null>(null);

  // Secondary modal for missed punch / permission / leave requests
  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [reqType, setReqType] = useState<AttendanceRequestType>('missed_check_out');
  const [reqDate, setReqDate] = useState(() => toLocalDateInput(new Date()));
  const [reqTime, setReqTime] = useState('17:00');
  const [reqReason, setReqReason] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [reqFeedback, setReqFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  if (asyncError) {
    throw asyncError;
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeEmployees = useMemo(
    () =>
      employees
        .filter((e) => e.isActive)
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [employees]
  );

  const effectiveEmpId = isAdmin ? selectedEmpId : currentUser.employeeId;

  const selectedEmp = useMemo(
    () => activeEmployees.find((e) => e.id === effectiveEmpId) ?? null,
    [activeEmployees, effectiveEmpId]
  );

  const pendingBreakReq = useMemo(
    () =>
      selectedEmp
        ? breakRequests.find(
            (r) => r.employeeId === selectedEmp.id && r.status === 'pending'
          ) ?? null
        : null,
    [breakRequests, selectedEmp]
  );

  const activeApprovedBreakReqs = useMemo(
    () =>
      selectedEmp
        ? breakRequests.filter(
            (r) => r.employeeId === selectedEmp.id && r.status === 'approved'
          )
        : [],
    [breakRequests, selectedEmp]
  );

  const needsKioskPin =
    isAdmin && selectedEmp !== null && selectedEmp.id !== currentUser.employeeId;

  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive !== false),
    [branches]
  );

  useEffect(() => {
    if (activeBranches.length === 0) {
      setSelectedBranchId('');
      return;
    }
    const assignedBranchId = selectedEmp?.branchId;
    if (assignedBranchId && activeBranches.some((b) => b.id === assignedBranchId)) {
      setSelectedBranchId(assignedBranchId);
    } else if (
      !selectedBranchId ||
      !activeBranches.some((b) => b.id === selectedBranchId)
    ) {
      setSelectedBranchId(activeBranches[0].id);
    }
  }, [selectedEmp?.id, selectedEmp?.branchId, activeBranches, selectedBranchId]);

  const selectedBranch = useMemo(
    () =>
      activeBranches.find((b) => b.id === selectedBranchId) ??
      activeBranches[0] ??
      null,
    [activeBranches, selectedBranchId]
  );

  const liveInsights = useMemo(() => {
    if (!selectedEmp) return null;
    return computeLiveEmployeeInsights(
      selectedEmp,
      branchSettings,
      recentLogs,
      attendanceRequests,
      nowTick,
      branches
    );
  }, [selectedEmp, branchSettings, recentLogs, attendanceRequests, nowTick, branches]);

  const effectiveAllowedIp = (
    selectedBranch
      ? selectedBranch.allowedIp
      : (liveInsights?.policy.allowedIp ?? branchSettings.allowedIp)
  ).trim();
  const effectiveBranchId =
    selectedBranch?.id ?? liveInsights?.policy.branchId ?? null;
  const effectiveBranchName =
    selectedBranch?.name ??
    liveInsights?.policy.branchName ??
    branchSettings.branchName;
  const effectiveGeoLat =
    selectedBranch ? selectedBranch.lat : (liveInsights?.policy.lat ?? null);
  const effectiveGeoLng =
    selectedBranch ? selectedBranch.lng : (liveInsights?.policy.lng ?? null);
  const effectiveRadiusMeters =
    selectedBranch?.radiusMeters ??
    liveInsights?.policy.radiusMeters ??
    DEFAULT_HR_POLICY.RADIUS_METERS;
  const isGeoRequired = Boolean(
    (selectedBranch ? selectedBranch.geoEnabled : liveInsights?.policy.geoEnabled) &&
      effectiveGeoLat !== null &&
      effectiveGeoLng !== null
  );

  const isIpLockConfigured = Boolean(effectiveAllowedIp);
  const isNetworkAllowed =
    !isIpLockConfigured ||
    (Boolean(currentIp) && currentIp.trim() === effectiveAllowedIp);

  const isSecureContext =
    typeof window !== 'undefined' ? window.isSecureContext : true;

  const empAttendanceRequests = useMemo(() => {
    if (!selectedEmp) return [];
    return attendanceRequests.filter((r) => r.employeeId === selectedEmp.id);
  }, [attendanceRequests, selectedEmp]);

  const pendingAttendanceReqCount = useMemo(
    () => empAttendanceRequests.filter((r) => r.status === 'pending').length,
    [empAttendanceRequests]
  );

  const liveBreakMs = liveInsights?.liveBreakMs ?? 0;
  const liveShiftMs = liveInsights?.netWorkMs ?? 0;

  const verifyKioskAndDevice = async (): Promise<{
    ok: boolean;
    geoCheck: LocationVerificationResult | null;
  }> => {
    if (!isNetworkAllowed) {
      setFeedback({
        ok: false,
        text: `غير مسموح بالتسجيل إلا من شبكة الوايفاي المعتمدة للفرع (${effectiveBranchName}).`,
      });
      return { ok: false, geoCheck: null };
    }

    if (!selectedEmp) {
      setFeedback({ ok: false, text: 'جاري تجهيز سجل الموظف، يرجى الانتظار لحظة.' });
      return { ok: false, geoCheck: null };
    }

    if (needsKioskPin) {
      const trimmedPin = pin.trim();
      if (!trimmedPin) {
        setFeedback({ ok: false, text: 'يرجى إدخال الرقم السري (PIN) للموظف المختار.' });
        return { ok: false, geoCheck: null };
      }
      const enteredHash = await hashEmployeePin(selectedEmp.id, trimmedPin);
      if (enteredHash !== selectedEmp.pinHash) {
        setFeedback({ ok: false, text: 'الرقم السري (PIN) غير صحيح.' });
        return { ok: false, geoCheck: null };
      }
    }

    if (!isAdmin && selectedEmp.deviceId && selectedEmp.deviceId !== deviceId) {
      setFeedback({
        ok: false,
        text: 'هذا الحساب مرتبط بجوال آخر. راجع الإدارة لفك ربط الجهاز.',
      });
      return { ok: false, geoCheck: null };
    }

    if (
      isGeoRequired &&
      effectiveGeoLat !== null &&
      effectiveGeoLng !== null
    ) {
      setGeoChecking(true);
      setFeedback({
        ok: true,
        text: 'جاري التحقق من تواجدك داخل النطاق الجغرافي للفرع (GPS)...',
      });
      try {
        const geoRes = await verifyEmployeeLocation({
          branchId: effectiveBranchId ?? undefined,
          branchName: effectiveBranchName,
          lat: effectiveGeoLat,
          lng: effectiveGeoLng,
          radiusMeters: effectiveRadiusMeters,
        });
        setLastGeoResult(geoRes);
        if (!geoRes.allowed) {
          setFeedback({ ok: false, text: geoRes.message });
          return { ok: false, geoCheck: geoRes };
        }
        return { ok: true, geoCheck: geoRes };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'تعذر التحقق من موقع GPS الخاص بالفرع.';
        setFeedback({ ok: false, text: msg });
        return { ok: false, geoCheck: null };
      } finally {
        setGeoChecking(false);
      }
    }

    return { ok: true, geoCheck: null };
  };

  const handleRequestBreak = async () => {
    setFeedback(null);
    const verification = await verifyKioskAndDevice();
    if (!verification.ok || !selectedEmp) return;

    if (selectedEmp.status !== 'working') {
      setFeedback({
        ok: false,
        text: 'يجب أن تكون مسجل دخول وعلى رأس العمل قبل طلب البريك.',
      });
      return;
    }

    if (pendingBreakReq) {
      setFeedback({
        ok: false,
        text: 'لديك طلب بريك معلق بالفعل بانتظار موافقة المدير.',
      });
      return;
    }

    setSubmittingAction('request_break');
    try {
      const reqRef = doc(collection(db, 'break_requests'));
      const cleanReason = breakReason
        .trim()
        .slice(0, SCHEMA_LIMITS.BREAK_REASON_MAX);

      await setDoc(reqRef, {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
        reason: cleanReason,
        status: 'pending',
        requestedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        notified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setBreakReason('');
      setFeedback({
        ok: true,
        text: `تم إرسال طلب استئذان البريك إلى المدير — ${formatTimestampAr(Date.now())}`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, 'break_requests');
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleAction = async (action: 'check_in' | 'break_end' | 'check_out') => {
    setFeedback(null);
    const verification = await verifyKioskAndDevice();
    if (!verification.ok || !selectedEmp) return;
    const geoCheck = verification.geoCheck;

    setSubmittingAction(action);
    try {
      const nowMs = Date.now();
      const nextUpdates: {
        status: Employee['status'];
        deviceId: string;
        lastCheckIn: number | null;
        lastCheckOut?: number | null;
        lastBreakStart: number | null;
        totalBreakMs: number;
      } = {
        status: selectedEmp.status,
        deviceId: selectedEmp.deviceId || deviceId,
        lastCheckIn: selectedEmp.lastCheckIn ?? null,
        lastBreakStart: selectedEmp.lastBreakStart ?? null,
        totalBreakMs: selectedEmp.totalBreakMs || 0,
      };

      if (action === 'check_in') {
        if (selectedEmp.status === 'working' || selectedEmp.status === 'break') {
          setFeedback({ ok: false, text: 'أنت مسجل دخول بالفعل مسبقاً.' });
          setSubmittingAction(null);
          return;
        }
        nextUpdates.status = 'working';
        nextUpdates.lastCheckIn = nowMs;
        nextUpdates.lastCheckOut = null;
        nextUpdates.lastBreakStart = null;
        nextUpdates.totalBreakMs = 0;
      } else if (action === 'break_end') {
        if (selectedEmp.status !== 'break') {
          setFeedback({ ok: false, text: 'أنت لست في وضع بريك حالياً.' });
          setSubmittingAction(null);
          return;
        }
        const addedBreak = selectedEmp.lastBreakStart
          ? Math.max(0, nowMs - selectedEmp.lastBreakStart)
          : 0;
        nextUpdates.status = 'working';
        nextUpdates.totalBreakMs = (selectedEmp.totalBreakMs || 0) + addedBreak;
        nextUpdates.lastBreakStart = null;
      } else if (action === 'check_out') {
        if (selectedEmp.status === 'out') {
          setFeedback({ ok: false, text: 'أنت مسجل خروج بالفعل.' });
          setSubmittingAction(null);
          return;
        }
        if (selectedEmp.status === 'break' && selectedEmp.lastBreakStart) {
          nextUpdates.totalBreakMs =
            (selectedEmp.totalBreakMs || 0) +
            Math.max(0, nowMs - selectedEmp.lastBreakStart);
        }
        nextUpdates.status = 'out';
        nextUpdates.lastCheckOut = nowMs;
        nextUpdates.lastBreakStart = null;
      }

      const batch = writeBatch(db);
      const empRef = doc(db, 'employees', selectedEmp.id);
      const logRef = doc(collection(db, 'attendance_logs'));

      batch.update(empRef, {
        ...nextUpdates,
        updatedAt: serverTimestamp(),
      });

      const safeIp = SCHEMA_LIMITS.IP_PATTERN.test(currentIp)
        ? currentIp.slice(0, SCHEMA_LIMITS.IP_MAX)
        : '';

      batch.set(logRef, {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
        action,
        ip: safeIp,
        deviceId: deviceId.slice(0, SCHEMA_LIMITS.DEVICE_ID_MAX),
        createdByUid: currentUser.id,
        branchId: effectiveBranchId,
        branchName: effectiveBranchName.slice(0, SCHEMA_LIMITS.BRANCH_NAME_MAX),
        distanceMeters: geoCheck ? geoCheck.distanceMeters : null,
        allowedRadiusMeters: geoCheck ? geoCheck.radiusMeters : null,
        geoAccuracyMeters: geoCheck ? geoCheck.accuracyMeters : null,
        employeeCoords: geoCheck
          ? { lat: geoCheck.fix.lat, lng: geoCheck.fix.lng }
          : null,
        timestamp: serverTimestamp(),
      });

      // Mark any active approved break request as completed when returning from break or checking out
      if (action === 'break_end' || action === 'check_out') {
        activeApprovedBreakReqs.forEach((req) => {
          batch.update(doc(db, 'break_requests', req.id), {
            status: 'completed',
            notified: true,
            updatedAt: serverTimestamp(),
          });
        });
      }

      await batch.commit();

      const successLabels: Record<'check_in' | 'break_end' | 'check_out', string> = {
        check_in: 'تم تسجيل الدخول بنجاح',
        break_end: 'تم تسجيل العودة من البريك',
        check_out: 'تم تسجيل الخروج بنجاح',
      };

      const distanceSuffix = geoCheck
        ? ` في "${effectiveBranchName}" (المسافة: ${geoCheck.distanceMeters} متر)`
        : '';

      setFeedback({
        ok: true,
        text: `${successLabels[action]}${distanceSuffix} — ${formatTimestampAr(nowMs)}`,
      });
      setPin('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, `employees/${selectedEmp.id}`);
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleSubmitAttendanceRequest = async () => {
    setReqFeedback(null);
    if (!selectedEmp) {
      setReqFeedback({ ok: false, text: 'يرجى تحديد الموظف أولاً.' });
      return;
    }

    if (!SCHEMA_LIMITS.DATE_YYYYMMDD_PATTERN.test(reqDate)) {
      setReqFeedback({ ok: false, text: 'يرجى اختيار تاريخ صحيح.' });
      return;
    }

    const isMissedPunch =
      reqType === 'missed_check_in' || reqType === 'missed_check_out';
    const requiresTime = reqType !== 'leave';

    if (requiresTime && !SCHEMA_LIMITS.TIME_HHMM_PATTERN.test(reqTime)) {
      setReqFeedback({ ok: false, text: 'يرجى تحديد الوقت المطلوب بشكل صحيح.' });
      return;
    }

    const cleanReason = reqReason
      .trim()
      .slice(0, SCHEMA_LIMITS.ATTENDANCE_REQ_REASON_MAX);
    if (!cleanReason) {
      setReqFeedback({ ok: false, text: 'يرجى كتابة سبب الطلب.' });
      return;
    }

    let targetTimestampMs: number | null = null;
    if (isMissedPunch) {
      const parsed = new Date(`${reqDate}T${reqTime}:00`).getTime();
      if (Number.isNaN(parsed)) {
        setReqFeedback({ ok: false, text: 'التاريخ أو الوقت المدخل غير صالح.' });
        return;
      }
      if (parsed > Date.now()) {
        setReqFeedback({
          ok: false,
          text: 'لا يمكن طلب إضافة بصمة منسية لوقت في المستقبل.',
        });
        return;
      }
      targetTimestampMs = parsed;
    }

    setReqSubmitting(true);
    try {
      const reqRef = doc(collection(db, 'attendance_requests'));
      await setDoc(reqRef, {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
        type: reqType,
        targetDate: reqDate,
        targetTime: reqType === 'leave' ? '' : reqTime,
        targetTimestampMs,
        reason: cleanReason,
        status: 'pending',
        requestedAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        notified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setReqReason('');
      setReqFeedback({
        ok: true,
        text: 'تم إرسال الطلب إلى المدير للمراجعة بنجاح.',
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, 'attendance_requests');
      } catch (wrapped) {
        setAsyncError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    } finally {
      setReqSubmitting(false);
    }
  };

  const formattedClock = new Date(nowTick).toLocaleTimeString('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const formattedDate = new Date(nowTick).toLocaleDateString('ar-SA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Primary Column: Attendance Terminal */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-4 pb-5 border-b border-slate-200">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                  تسجيل الحضور والبريك والانصراف
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  {effectiveBranchName}
                  {liveInsights?.policy.shiftName
                    ? ` · ${liveInsights.policy.shiftName} (${liveInsights.policy.shiftStart}${
                        liveInsights.policy.shiftEnd
                          ? `–${liveInsights.policy.shiftEnd}`
                          : ''
                      })`
                    : ''}
                  {' · '}
                  {formattedDate}
                </p>
              </div>
              <div
                className="text-2xl font-semibold font-mono tabular-nums text-slate-900"
                dir="ltr"
              >
                {formattedClock}
              </div>
            </div>

            <div className="space-y-5 mt-6">
              {isAdmin ? (
                <div>
                  <label
                    htmlFor="empSelect"
                    className="block text-sm font-semibold text-slate-800 mb-2"
                  >
                    الموظف المسجّل
                  </label>
                  {employeesLoading ? (
                    <div className="h-11 w-full bg-slate-100 rounded-lg animate-pulse" />
                  ) : (
                    <select
                      id="empSelect"
                      value={selectedEmpId}
                      onChange={(e) => {
                        setSelectedEmpId(e.target.value);
                        setFeedback(null);
                      }}
                      className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                    >
                      <option value="">-- اختر الموظف --</option>
                      {activeEmployees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name}
                          {emp.roleTitle ? ` — ${emp.roleTitle}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 py-3 px-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="w-4 h-4 text-teal-700 shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {currentUser.username}
                      </div>
                      <div className="text-xs text-slate-500">
                        {currentUser.roleTitle || 'موظف'}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-teal-800">
                    حساب موثّق
                  </span>
                </div>
              )}

              {/* اختيار الفرع عندما تتوفر فروع مضافة */}
              {activeBranches.length > 0 && (
                <div>
                  <label
                    htmlFor="terminalBranchSelect"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    الفرع المسجّل عليه البصمة
                  </label>
                  <select
                    id="terminalBranchSelect"
                    value={selectedBranch?.id ?? ''}
                    onChange={(e) => {
                      setSelectedBranchId(e.target.value);
                      setLastGeoResult(null);
                      setFeedback(null);
                    }}
                    className="w-full h-11 px-3.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                  >
                    {activeBranches.map((br) => (
                      <option key={br.id} value={br.id}>
                        {br.name}
                        {br.geoEnabled ? ` (GPS ${br.radiusMeters}م)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Unboxed Selected Employee Metadata Strip */}
              <div className="py-3 px-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">الحالة الحالية:</span>
                    {selectedEmp ? (
                      <StatusText status={selectedEmp.status} />
                    ) : (
                      <span className="font-medium text-slate-500">جاري التجهيز...</span>
                    )}
                  </div>

                  {selectedEmp && (
                    <div className="flex flex-wrap items-center gap-3 tabular-nums">
                      {selectedEmp.status !== 'out' && selectedEmp.lastCheckIn && (
                        <span>
                          صافي العمل:{' '}
                          <strong className="font-mono text-slate-900">
                            {formatDurationAr(liveShiftMs)}
                          </strong>
                        </span>
                      )}
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>
                        البريك:{' '}
                        <strong
                          className={`font-mono ${
                            liveInsights?.isBreakExceeded
                              ? 'text-rose-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatDurationAr(liveBreakMs)}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                {liveInsights &&
                  (liveInsights.lateMinutes > 0 ||
                    liveInsights.isBreakExceeded ||
                    liveInsights.hasApprovedLeaveToday) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-slate-200/80">
                      {liveInsights.lateMinutes > 0 && (
                        <span className="text-[11px] font-semibold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded">
                          تأخير عن الدوام ({liveInsights.policy.shiftStart}): {liveInsights.lateMinutes} د
                        </span>
                      )}
                      {liveInsights.isBreakExceeded && (
                        <span className="text-[11px] font-semibold text-rose-800 bg-rose-100 px-2 py-0.5 rounded">
                          تجاوز مدة البريك المسموحة ({liveInsights.policy.maxBreakMinutes} د) بـ +{liveInsights.breakOverageMinutes} د
                        </span>
                      )}
                      {liveInsights.hasApprovedLeaveToday && (
                        <span className="text-[11px] font-semibold text-teal-800 bg-teal-100 px-2 py-0.5 rounded">
                          إجازة معتمدة اليوم
                        </span>
                      )}
                    </div>
                  )}
              </div>

              {/* Pending Break Request Status Notice */}
              {pendingBreakReq && (
                <div className="flex items-center justify-between gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <Hourglass className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      طلب البريك قيد المراجعة — بانتظار موافقة المدير ليبدأ البريك
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-amber-800 shrink-0">
                    {pendingBreakReq.requestedAt
                      ? formatTimestampAr(pendingBreakReq.requestedAt.toDate())
                      : 'الآن'}
                  </span>
                </div>
              )}

              {/* Optional Break Reason Input when working and no pending request */}
              {selectedEmp?.status === 'working' && !pendingBreakReq && (
                <div>
                  <label
                    htmlFor="breakReason"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    سبب الاستئذان للبريك (اختياري)
                  </label>
                  <input
                    id="breakReason"
                    type="text"
                    value={breakReason}
                    onChange={(e) => setBreakReason(e.target.value)}
                    maxLength={SCHEMA_LIMITS.BREAK_REASON_MAX}
                    placeholder="مثال: استراحة غداء / صلاة / ظرف طارئ"
                    className="w-full h-10 px-3.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                  />
                </div>
              )}

              {/* Kiosk PIN Input (only shown when Admin punches for another employee) */}
              {needsKioskPin && (
                <div>
                  <label
                    htmlFor="empPin"
                    className="block text-sm font-semibold text-slate-800 mb-2"
                  >
                    الرقم السري للموظف المختار (PIN)
                  </label>
                  <div className="relative">
                    <input
                      id="empPin"
                      type={showPin ? 'text' : 'password'}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="أدخل الرقم السري الخاص بالموظف"
                      inputMode="numeric"
                      maxLength={SCHEMA_LIMITS.PIN_MAX}
                      autoComplete="off"
                      className="w-full h-11 pl-11 pr-3.5 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((prev) => !prev)}
                      aria-label={showPin ? 'إخفاء الرقم السري' : 'إظهار الرقم السري'}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded"
                    >
                      {showPin ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons & Feedback */}
          <div className="mt-7 pt-6 border-t border-slate-200 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                disabled={
                  submittingAction !== null ||
                  geoChecking ||
                  !isNetworkAllowed ||
                  !selectedEmp ||
                  selectedEmp.status !== 'out'
                }
                onClick={() => void handleAction('check_in')}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>
                  {geoChecking
                    ? 'جاري تحديد الموقع...'
                    : submittingAction === 'check_in'
                      ? 'جاري التسجيل...'
                      : 'تسجيل دخول'}
                </span>
              </button>

              {selectedEmp?.status === 'break' ? (
                <button
                  type="button"
                  disabled={submittingAction !== null || geoChecking || !isNetworkAllowed}
                  onClick={() => void handleAction('break_end')}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  <Coffee className="w-4 h-4 shrink-0" />
                  <span>
                    {geoChecking
                      ? 'جاري تحديد الموقع...'
                      : submittingAction === 'break_end'
                        ? 'جاري التحديث...'
                        : 'العودة من البريك'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={
                    submittingAction !== null ||
                    geoChecking ||
                    !isNetworkAllowed ||
                    !selectedEmp ||
                    selectedEmp.status !== 'working' ||
                    Boolean(pendingBreakReq)
                  }
                  onClick={() => void handleRequestBreak()}
                  className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  <Coffee className="w-4 h-4 shrink-0" />
                  <span>
                    {geoChecking
                      ? 'جاري تحديد الموقع...'
                      : submittingAction === 'request_break'
                        ? 'جاري الإرسال...'
                        : pendingBreakReq
                          ? 'بانتظار موافقة المدير'
                          : 'استئذان بريك'}
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={
                  submittingAction !== null ||
                  geoChecking ||
                  !isNetworkAllowed ||
                  !selectedEmp ||
                  selectedEmp.status === 'out'
                }
                onClick={() => void handleAction('check_out')}
                className="inline-flex items-center justify-center gap-2 min-h-[48px] px-4 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>
                  {geoChecking
                    ? 'جاري تحديد الموقع...'
                    : submittingAction === 'check_out'
                      ? 'جاري التسجيل...'
                      : 'تسجيل خروج'}
                </span>
              </button>
            </div>

            {feedback && (
              <div
                role="status"
                className={`flex items-center gap-2.5 p-3.5 rounded-lg border text-sm font-medium ${
                  feedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {feedback.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Clean secondary button to keep main terminal uncluttered */}
            <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setReqFeedback(null);
                  setRequestsModalOpen(true);
                }}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <CalendarPlus className="w-4 h-4 text-teal-700 shrink-0" />
                <span>طلب تعديل سجل منسي / استئذان أو إجازة</span>
                {pendingAttendanceReqCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-900 rounded">
                    {pendingAttendanceReqCount} معلق
                  </span>
                )}
              </button>
              <span className="text-[11px] text-slate-400">
                الشيفت: {liveInsights?.policy.shiftStart ?? '09:00'}
                {liveInsights?.policy.shiftEnd ? ` - ${liveInsights.policy.shiftEnd}` : ''}
              </span>
            </div>
          </div>
        </section>

        {/* Secondary Column: Network Verification & Recent Session Activity */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <h2 className="text-base font-bold text-slate-900">
                حالة الشبكة والجهاز
              </h2>
              <button
                type="button"
                onClick={onRefreshIp}
                disabled={ipLoading}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${ipLoading ? 'animate-spin' : ''}`} />
                <span>تحديث IP</span>
              </button>
            </div>

            <dl className="divide-y divide-slate-200 text-sm">
              <div className="py-3.5 flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-slate-600">
                  <Wifi className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>عنوان الشبكة الحالي</span>
                </dt>
                <dd className="font-mono tabular-nums text-xs font-semibold text-slate-900" dir="ltr">
                  {ipLoading ? 'جاري الفحص...' : ipError ? 'غير متاح' : currentIp || '—'}
                </dd>
              </div>

              <div className="py-3.5 flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-slate-600">
                  {isNetworkAllowed ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                  )}
                  <span>نطاق الفرع المسموح</span>
                </dt>
                <dd
                  className={`text-xs font-semibold ${
                    !isIpLockConfigured
                      ? 'text-slate-700'
                      : isNetworkAllowed
                        ? 'text-emerald-700'
                        : 'text-red-700'
                  }`}
                >
                  {!isIpLockConfigured
                    ? 'مفتوح (وضع التجربة)'
                    : isNetworkAllowed
                      ? 'متصل بشبكة الفرع المعتمدة'
                      : 'خارج شبكة الفرع المحددة'}
                </dd>
              </div>

              <div className="py-3.5 flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-slate-600">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>الفرع والنطاق الجغرافي (GPS)</span>
                </dt>
                <dd className="text-xs font-semibold text-slate-800 text-left">
                  <div>{effectiveBranchName}</div>
                  <div className="text-[11px] text-slate-500">
                    {isGeoRequired
                      ? `GPS مفعّل (${liveInsights?.policy.radiusMeters ?? 50}م)`
                      : 'GPS غير مفروض'}
                    {' · '}
                    {isSecureContext ? 'HTTPS آمن' : 'اتصال غير آمن'}
                  </div>
                </dd>
              </div>

              <div className="py-3.5 flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-slate-600">
                  <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
                  <span>بصمة هذا الجهاز</span>
                </dt>
                <dd
                  className="font-mono tabular-nums text-xs text-slate-700 max-w-[160px] truncate"
                  dir="ltr"
                  title={deviceId}
                >
                  {deviceId}
                </dd>
              </div>
            </dl>

            <div className="mt-3 pt-3 border-t border-slate-100">
              <BranchLocationCheck
                branchId={effectiveBranchId ?? undefined}
                branchName={effectiveBranchName}
                geoEnabled={isGeoRequired}
                lat={effectiveGeoLat}
                lng={effectiveGeoLng}
                radiusMeters={effectiveRadiusMeters}
                lastResult={lastGeoResult}
                onVerified={(res) => setLastGeoResult(res)}
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">
                آخر الحركات المسجلة
              </h3>
              <Clock className="w-4 h-4 text-slate-400" />
            </div>

            {logsLoading ? (
              <div className="space-y-2.5">
                {[1, 2, 3].map((idx) => (
                  <div key={idx} className="h-9 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : recentLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                لم تُسجّل حركات بعد.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 text-xs">
                {recentLogs.slice(0, 5).map((log) => (
                  <li
                    key={log.id}
                    className="py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900 block truncate">
                        {log.employeeName}
                      </span>
                      <span className="text-slate-500">
                        {getActionLabelAr(log.action)}
                      </span>
                    </div>
                    <div className="text-left shrink-0 font-mono tabular-nums text-slate-600" dir="ltr">
                      {log.timestamp ? formatTimestampAr(log.timestamp.toDate()) : '—'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {/* Modal for Missed Punch / Permission / Leave Requests */}
      {requestsModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reqModalTitle"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-teal-700" />
                <h2 id="reqModalTitle" className="text-base font-bold text-slate-900">
                  الطلبات الإضافية وتعديل السجل المنسي
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRequestsModalOpen(false)}
                aria-label="إغلاق النافذة"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  نوع الطلب
                </label>
                <select
                  value={reqType}
                  onChange={(e) => setReqType(e.target.value as AttendanceRequestType)}
                  className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700"
                >
                  <option value="missed_check_in">نسيان تسجيل دخول</option>
                  <option value="missed_check_out">نسيان تسجيل خروج</option>
                  <option value="late_excuse">استئذان تأخر عن الدوام</option>
                  <option value="early_leave">استئذان خروج مبكر</option>
                  <option value="leave">طلب إجازة يومية</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    التاريخ
                  </label>
                  <input
                    type="date"
                    value={reqDate}
                    onChange={(e) => setReqDate(e.target.value)}
                    className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700"
                  />
                </div>

                {reqType !== 'leave' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      الوقت المطلوب
                    </label>
                    <input
                      type="time"
                      value={reqTime}
                      onChange={(e) => setReqTime(e.target.value)}
                      className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  السبب أو التوضيح للمدير
                </label>
                <textarea
                  rows={2}
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  maxLength={SCHEMA_LIMITS.ATTENDANCE_REQ_REASON_MAX}
                  placeholder="مثال: نسيت تسجيل الخروج بعد انتهاء الدوام / ظرف عائلي طارئ..."
                  className="w-full p-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700"
                />
              </div>

              {reqFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs font-semibold ${
                    reqFeedback.ok
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : 'bg-red-50 text-red-900 border border-red-200'
                  }`}
                >
                  {reqFeedback.text}
                </div>
              )}

              <button
                type="button"
                disabled={reqSubmitting}
                onClick={() => void handleSubmitAttendanceRequest()}
                className="w-full h-10 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {reqSubmitting ? 'جاري الإرسال...' : 'إرسال الطلب للمدير'}
              </button>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <h3 className="text-xs font-bold text-slate-700 mb-2.5">
                سجل طلباتك الأخيرة ({empAttendanceRequests.length})
              </h3>
              {empAttendanceRequests.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-3">
                  لا توجد طلبات مقدمة بعد.
                </p>
              ) : (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {empAttendanceRequests.slice(0, 10).map((req) => (
                    <li
                      key={req.id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900">
                          {getAttendanceRequestTypeLabelAr(req.type)} · {req.targetDate}
                          {req.targetTime ? ` (${req.targetTime})` : ''}
                        </div>
                        <div className="text-slate-600 truncate mt-0.5">{req.reason}</div>
                      </div>
                      <span
                        className={`shrink-0 px-2 py-0.5 rounded font-semibold ${
                          req.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : req.status === 'rejected'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {getAttendanceRequestStatusLabelAr(req.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
