import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Bell, BellRing, CheckCircle2, X, XCircle } from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { EmployeeTerminal } from './components/EmployeeTerminal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FirebaseProvider, useFirebaseAuth } from './components/FirebaseProvider';
import { LogsView } from './components/LogsView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { TopBar } from './components/TopBar';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  DEFAULT_HR_POLICY,
  SCHEMA_LIMITS,
  type AppTab,
  type AttendanceLog,
  type AttendanceRequest,
  type Branch,
  type BranchSettings,
  type BreakRequest,
  type Employee,
} from './types/attendance';
import { getAttendanceRequestTypeLabelAr } from './utils/attendanceMetrics';
import {
  formatTimestampAr,
  getOrCreateDeviceId,
  hashEmployeePin,
  playNotificationChime,
} from './utils/crypto';
import { showBrowserNotification } from './utils/notifications';

const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  allowedIp: '',
  branchName: 'الفرع الرئيسي',
  shiftStart: DEFAULT_HR_POLICY.SHIFT_START,
  graceMinutes: DEFAULT_HR_POLICY.GRACE_MINUTES,
  maxBreakMinutes: DEFAULT_HR_POLICY.MAX_BREAK_MINUTES,
  targetDailyHours: DEFAULT_HR_POLICY.TARGET_DAILY_HOURS,
};

function AttendanceWorkspace() {
  const {
    user,
    token,
    isAdmin,
    signOutUser,
    notificationPermission,
    requestNotificationPermission,
  } = useFirebaseAuth();
  const [activeTab, setActiveTab] = useState<AppTab>('employee');
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);

  const [currentIp, setCurrentIp] = useState('');
  const [ipLoading, setIpLoading] = useState(true);
  const [ipError, setIpError] = useState(false);

  const [branchSettings, setBranchSettings] = useState<BranchSettings>(
    DEFAULT_BRANCH_SETTINGS
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [breakRequests, setBreakRequests] = useState<BreakRequest[]>([]);
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceRequest[]>([]);
  const [asyncError, setAsyncError] = useState<Error | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());

  if (asyncError) {
    throw asyncError;
  }

  const detectIp = useCallback(async () => {
    setIpLoading(true);
    setIpError(false);
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      if (!res.ok) throw new Error('IP lookup failed');
      const data = (await res.json()) as { ip?: string };
      setCurrentIp(data.ip ?? '');
    } catch {
      setIpError(true);
      setCurrentIp('');
    } finally {
      setIpLoading(false);
    }
  }, []);

  useEffect(() => {
    void detectIp();
  }, [detectIp]);

  // Ensure the logged-in user's linked employee document exists in Firestore
  useEffect(() => {
    if (!user) return;
    const empRef = doc(db, 'employees', user.employeeId);
    void (async () => {
      try {
        const snap = await getDoc(empRef);
        if (!snap.exists()) {
          const defaultPinHash = await hashEmployeePin(user.employeeId, '0000');
          await setDoc(empRef, {
            name: user.username.slice(0, SCHEMA_LIMITS.EMP_NAME_MAX),
            roleTitle: (user.roleTitle || 'موظف').slice(0, SCHEMA_LIMITS.ROLE_TITLE_MAX),
            pinHash: defaultPinHash,
            status: 'out',
            deviceId: null,
            lastCheckIn: null,
            lastBreakStart: null,
            totalBreakMs: 0,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `employees/${user.employeeId}`);
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    })();
  }, [user]);

  // Branch settings listener
  useEffect(() => {
    if (!user) return;
    const branchRef = doc(db, 'settings', 'branch');
    const unsub = onSnapshot(
      branchRef,
      async (snap) => {
        if (snap.exists()) {
          const data = snap.data() as BranchSettings;
          setBranchSettings({
            allowedIp: data.allowedIp ?? '',
            branchName: data.branchName ?? 'الفرع الرئيسي',
            shiftStart: data.shiftStart ?? DEFAULT_HR_POLICY.SHIFT_START,
            graceMinutes:
              typeof data.graceMinutes === 'number'
                ? data.graceMinutes
                : DEFAULT_HR_POLICY.GRACE_MINUTES,
            maxBreakMinutes:
              typeof data.maxBreakMinutes === 'number'
                ? data.maxBreakMinutes
                : DEFAULT_HR_POLICY.MAX_BREAK_MINUTES,
            targetDailyHours:
              typeof data.targetDailyHours === 'number'
                ? data.targetDailyHours
                : DEFAULT_HR_POLICY.TARGET_DAILY_HOURS,
            updatedAt: data.updatedAt ?? null,
            updatedBy: data.updatedBy,
          });
        } else if (isAdmin) {
          try {
            await setDoc(branchRef, {
              allowedIp: '',
              branchName: 'الفرع الرئيسي',
              shiftStart: DEFAULT_HR_POLICY.SHIFT_START,
              graceMinutes: DEFAULT_HR_POLICY.GRACE_MINUTES,
              maxBreakMinutes: DEFAULT_HR_POLICY.MAX_BREAK_MINUTES,
              targetDailyHours: DEFAULT_HR_POLICY.TARGET_DAILY_HOURS,
              updatedAt: serverTimestamp(),
              updatedBy: user.id,
            });
          } catch (err) {
            try {
              handleFirestoreError(err, OperationType.CREATE, 'settings/branch');
            } catch (wrapped) {
              setAsyncError(
                wrapped instanceof Error ? wrapped : new Error(String(wrapped))
              );
            }
          }
        }
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, 'settings/branch');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user, isAdmin]);

  // Multi-branch configurations & shifts listener
  useEffect(() => {
    if (!user) return;
    const branchesQuery = query(collection(db, 'branches'), limit(100));
    const unsub = onSnapshot(
      branchesQuery,
      (snapshot) => {
        const list: Branch[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Branch, 'id'>),
        }));
        list.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        setBranches(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'branches');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user]);

  // Employees directory listener
  useEffect(() => {
    if (!user) return;
    setEmployeesLoading(true);

    const empQuery = isAdmin
      ? query(collection(db, 'employees'), limit(200))
      : query(
          collection(db, 'employees'),
          where('isActive', '==', true),
          limit(200)
        );

    const unsub = onSnapshot(
      empQuery,
      (snapshot) => {
        const list: Employee[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Employee, 'id'>),
        }));
        setEmployees(list);
        setEmployeesLoading(false);
      },
      (err) => {
        setEmployeesLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'employees');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user, isAdmin]);

  // Attendance logs listener
  useEffect(() => {
    if (!user) return;
    setLogsLoading(true);

    const logsQuery = isAdmin
      ? query(collection(db, 'attendance_logs'), orderBy('timestamp', 'desc'), limit(50))
      : query(
          collection(db, 'attendance_logs'),
          where('employeeId', '==', user.employeeId),
          limit(50)
        );

    const unsub = onSnapshot(
      logsQuery,
      (snapshot) => {
        const list: AttendanceLog[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AttendanceLog, 'id'>),
        }));
        list.sort((a, b) => {
          const tA = a.timestamp ? a.timestamp.toMillis() : 0;
          const tB = b.timestamp ? b.timestamp.toMillis() : 0;
          return tB - tA;
        });
        setLogs(list);
        setLogsLoading(false);
      },
      (err) => {
        setLogsLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'attendance_logs');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user, isAdmin]);

  // Real-time break permission requests listener
  useEffect(() => {
    if (!user) return;

    const reqQuery = isAdmin
      ? query(collection(db, 'break_requests'), orderBy('requestedAt', 'desc'), limit(50))
      : query(
          collection(db, 'break_requests'),
          where('employeeId', '==', user.employeeId),
          limit(50)
        );

    const unsub = onSnapshot(
      reqQuery,
      (snapshot) => {
        const list: BreakRequest[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BreakRequest, 'id'>),
        }));
        list.sort((a, b) => {
          const tA = a.requestedAt ? a.requestedAt.toMillis() : 0;
          const tB = b.requestedAt ? b.requestedAt.toMillis() : 0;
          return tB - tA;
        });

        // Play chime and dispatch instant desktop/mobile browser notification
        list.forEach((req) => {
          if (
            req.employeeId === user.employeeId &&
            !req.notified &&
            (req.status === 'approved' || req.status === 'rejected') &&
            !seenNotifIdsRef.current.has(req.id)
          ) {
            seenNotifIdsRef.current.add(req.id);
            if (req.status === 'approved') {
              playNotificationChime();
              void showBrowserNotification({
                title: 'تمت الموافقة على طلب البريك',
                body: `وافق المدير (${req.reviewedBy ?? 'الإدارة'}) على استراحتك — بدأ وقت البريك الآن.`,
                tag: `break-${req.id}`,
              });
            } else {
              void showBrowserNotification({
                title: 'تم رفض طلب البريك',
                body: `قام المدير (${req.reviewedBy ?? 'الإدارة'}) برفض طلب البريك في هذا الوقت.`,
                tag: `break-${req.id}`,
              });
            }
          }
        });

        setBreakRequests(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'break_requests');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user, isAdmin]);

  // Real-time missed punch, permission & leave requests listener
  useEffect(() => {
    if (!user) return;

    const reqQuery = isAdmin
      ? query(
          collection(db, 'attendance_requests'),
          orderBy('requestedAt', 'desc'),
          limit(50)
        )
      : query(
          collection(db, 'attendance_requests'),
          where('employeeId', '==', user.employeeId),
          limit(50)
        );

    const unsub = onSnapshot(
      reqQuery,
      (snapshot) => {
        const list: AttendanceRequest[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<AttendanceRequest, 'id'>),
        }));
        list.sort((a, b) => {
          const tA = a.requestedAt ? a.requestedAt.toMillis() : 0;
          const tB = b.requestedAt ? b.requestedAt.toMillis() : 0;
          return tB - tA;
        });

        list.forEach((req) => {
          const key = `att_${req.id}`;
          if (
            req.employeeId === user.employeeId &&
            !req.notified &&
            (req.status === 'approved' || req.status === 'rejected') &&
            !seenNotifIdsRef.current.has(key)
          ) {
            seenNotifIdsRef.current.add(key);
            const typeLabel = getAttendanceRequestTypeLabelAr(req.type);
            if (req.status === 'approved') {
              playNotificationChime();
              void showBrowserNotification({
                title: `تمت الموافقة: ${typeLabel}`,
                body: `وافق المدير (${req.reviewedBy ?? 'الإدارة'}) على طلبك بتاريخ ${req.targetDate}.`,
                tag: key,
              });
            } else {
              void showBrowserNotification({
                title: `تم رفض الطلب: ${typeLabel}`,
                body: `قام المدير (${req.reviewedBy ?? 'الإدارة'}) برفض طلبك بتاريخ ${req.targetDate}.`,
                tag: key,
              });
            }
          }
        });

        setAttendanceRequests(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'attendance_requests');
        } catch (wrapped) {
          setAsyncError(
            wrapped instanceof Error ? wrapped : new Error(String(wrapped))
          );
        }
      }
    );

    return () => unsub();
  }, [user, isAdmin]);

  const unreadNotifications = useMemo(() => {
    if (!user) return [];
    return breakRequests.filter(
      (r) =>
        r.employeeId === user.employeeId &&
        !r.notified &&
        (r.status === 'approved' || r.status === 'rejected')
    );
  }, [breakRequests, user]);

  const unreadAttendanceNotifications = useMemo(() => {
    if (!user) return [];
    return attendanceRequests.filter(
      (r) =>
        r.employeeId === user.employeeId &&
        !r.notified &&
        (r.status === 'approved' || r.status === 'rejected')
    );
  }, [attendanceRequests, user]);

  const pendingBreakCount = useMemo(
    () =>
      breakRequests.filter((r) => r.status === 'pending').length +
      attendanceRequests.filter((r) => r.status === 'pending').length,
    [breakRequests, attendanceRequests]
  );

  const handleAcknowledgeNotification = async (reqId: string) => {
    try {
      await updateDoc(doc(db, 'break_requests', reqId), {
        notified: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `break_requests/${reqId}`);
      } catch (wrapped) {
        setAsyncError(
          wrapped instanceof Error ? wrapped : new Error(String(wrapped))
        );
      }
    }
  };

  const handleAcknowledgeAttendanceNotification = async (reqId: string) => {
    try {
      await updateDoc(doc(db, 'attendance_requests', reqId), {
        notified: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.UPDATE, `attendance_requests/${reqId}`);
      } catch (wrapped) {
        setAsyncError(
          wrapped instanceof Error ? wrapped : new Error(String(wrapped))
        );
      }
    }
  };

  if (!user || !token) return null;

  const effectiveTab: AppTab =
    activeTab === 'admin' && !isAdmin ? 'employee' : activeTab;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-safe">
      <TopBar
        activeTab={effectiveTab}
        onTabChange={setActiveTab}
        isAdmin={isAdmin}
        username={user.username}
        pendingBreakCount={pendingBreakCount}
        onSignOut={signOutUser}
      />

      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 space-y-5 sm:space-y-6">
        {notificationPermission === 'default' && !notifBannerDismissed && (
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-slate-700">
              <Bell className="w-4 h-4 text-teal-700 shrink-0" />
              <span>
                فعّل إشعارات المتصفح لتصلك تنبيهات الموافقة على طلب البريك فوراً على سطح المكتب أو الجوال.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void requestNotificationPermission()}
                className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                تفعيل الإشعارات
              </button>
              <button
                type="button"
                onClick={() => setNotifBannerDismissed(true)}
                aria-label="إغلاق تنبيه الإشعارات"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Real-time Break Approval / Rejection Notification Banner */}
        {unreadNotifications.map((notif) => {
          const isApproved = notif.status === 'approved';
          return (
            <div
              key={notif.id}
              role="alert"
              className={`rounded-xl border p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${
                isApproved
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-red-50 border-red-300 text-red-950'
              }`}
            >
              <div className="flex items-start gap-3">
                {isApproved ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-700 mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <BellRing className="w-4 h-4 shrink-0" />
                    <span>
                      {isApproved
                        ? 'إشعار موافقة: تم التصديق على طلب البريك'
                        : 'إشعار: تم رفض طلب البريك'}
                    </span>
                  </div>
                  <p className="text-xs mt-1 opacity-90">
                    {isApproved
                      ? `وافق المدير (${notif.reviewedBy ?? 'الإدارة'}) على استراحتك — بدأ وقت البريك الآن (${
                          notif.reviewedAt
                            ? formatTimestampAr(notif.reviewedAt.toDate())
                            : ''
                        }).`
                      : `قام المدير (${notif.reviewedBy ?? 'الإدارة'}) برفض طلب البريك في هذا الوقت.`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleAcknowledgeNotification(notif.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isApproved
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                    : 'bg-red-700 hover:bg-red-800 text-white'
                }`}
              >
                تم الاطلاع
              </button>
            </div>
          );
        })}

        {/* Real-time Attendance/Leave/Permission Request Notifications */}
        {unreadAttendanceNotifications.map((notif) => {
          const isApproved = notif.status === 'approved';
          const typeLabel = getAttendanceRequestTypeLabelAr(notif.type);
          return (
            <div
              key={`att_${notif.id}`}
              role="alert"
              className={`rounded-xl border p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${
                isApproved
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-red-50 border-red-300 text-red-950'
              }`}
            >
              <div className="flex items-start gap-3">
                {isApproved ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-700 mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold">
                    <BellRing className="w-4 h-4 shrink-0" />
                    <span>
                      {isApproved
                        ? `تمت الموافقة: ${typeLabel}`
                        : `تم رفض الطلب: ${typeLabel}`}
                    </span>
                  </div>
                  <p className="text-xs mt-1 opacity-90">
                    {isApproved
                      ? `وافق المدير (${notif.reviewedBy ?? 'الإدارة'}) على طلبك ليوم ${notif.targetDate}${
                          notif.targetTime ? ` الساعة ${notif.targetTime}` : ''
                        }.`
                      : `قام المدير (${notif.reviewedBy ?? 'الإدارة'}) برفض الطلب المقدم ليوم ${notif.targetDate}.`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleAcknowledgeAttendanceNotification(notif.id)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isApproved
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                    : 'bg-red-700 hover:bg-red-800 text-white'
                }`}
              >
                تم الاطلاع
              </button>
            </div>
          );
        })}

        {effectiveTab === 'employee' && (
          <EmployeeTerminal
            currentUser={user}
            employees={employees}
            employeesLoading={employeesLoading}
            branchSettings={branchSettings}
            branches={branches}
            currentIp={currentIp}
            ipLoading={ipLoading}
            ipError={ipError}
            onRefreshIp={() => void detectIp()}
            deviceId={deviceId}
            recentLogs={logs}
            logsLoading={logsLoading}
            breakRequests={breakRequests}
            attendanceRequests={attendanceRequests}
          />
        )}

        {effectiveTab === 'logs' && (
          <LogsView logs={logs} logsLoading={logsLoading} isAdmin={isAdmin} />
        )}

        {effectiveTab === 'admin' && isAdmin && (
          <AdminDashboard
            currentUser={user}
            authToken={token}
            employees={employees}
            employeesLoading={employeesLoading}
            branchSettings={branchSettings}
            branches={branches}
            currentIp={currentIp}
            breakRequests={breakRequests}
            attendanceRequests={attendanceRequests}
            logs={logs}
            logsLoading={logsLoading}
          />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <AttendanceWorkspace />
      </FirebaseProvider>
      <OfflineIndicator />
    </ErrorBoundary>
  );
}
