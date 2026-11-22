import React, { createContext, useCallback, useContext, useState } from 'react';
import { Eye, EyeOff, Lock, LogIn, ShieldCheck, Smartphone, User, Wifi } from 'lucide-react';
import { SCHEMA_LIMITS, type SessionUser } from '../types/attendance';
import {
  getBrowserNotificationStatus,
  requestBrowserNotificationPermission,
  type BrowserNotificationStatus,
} from '../utils/notifications';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthContextValue {
  user: SessionUser | null;
  token: string | null;
  isAdmin: boolean;
  signOutUser: () => void;
  notificationPermission: BrowserNotificationStatus;
  requestNotificationPermission: () => Promise<BrowserNotificationStatus>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useFirebaseAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useFirebaseAuth must be used inside FirebaseProvider');
  }
  return ctx;
}

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  // Hold session token strictly in React memory (never localStorage/sessionStorage)
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationStatus>(() => getBrowserNotificationStatus());

  const requestNotificationPermission = useCallback(async () => {
    const status = await requestBrowserNotificationPermission();
    setNotificationPermission(status);
    return status;
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const cleanUsername = username.trim();
    if (cleanUsername.length < SCHEMA_LIMITS.USERNAME_MIN || !password) {
      setAuthError('يرجى إدخال اسم المستخدم وكلمة المرور.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUsername, password }),
      });
      const data = (await res.json()) as {
        token?: string;
        user?: SessionUser;
        error?: string;
      };

      if (!res.ok || !data.token || !data.user) {
        setAuthError(data.error ?? 'تعذر تسجيل الدخول. تحقق من البيانات.');
        return;
      }

      setToken(data.token);
      setUser(data.user);
      setPassword('');

      // Request browser notification permission right upon login
      const currentStatus = getBrowserNotificationStatus();
      if (currentStatus === 'default') {
        void requestNotificationPermission();
      }
    } catch {
      setAuthError('تعذر الاتصال بالخادم. يرجى المحاولة مجدداً.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOutUser = () => {
    setToken(null);
    setUser(null);
    setUsername('');
    setPassword('');
    setAuthError(null);
  };

  if (!user || !token) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-6">
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4 py-2 border-b border-slate-200">
          <span className="text-lg font-bold text-slate-900 whitespace-nowrap shrink-0">
            بصمة — نظام الحضور والانصراف
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap shrink-0">
              إدارة الحضور والانصراف
            </span>
          </div>
        </header>

        <main className="max-w-5xl w-full mx-auto my-auto py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-5">
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight [text-wrap:balance]">
              تسجيل الحضور والانصراف والاستراحات بحسابات يحددها المدير
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
              سجّل الدخول باسم المستخدم وكلمة المرور المعتمدة من الإدارة للوصول إلى بوابة الحضور أو لوحة تحكم المدير ومتابعة السجل اللحظي.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
              <div className="pt-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-1">
                  <Wifi className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>قفل شبكة الفرع</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  التحقق من عنوان IP الخارجي لشبكة المقر قبل قبول البصمة.
                </p>
              </div>
              <div className="pt-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-1">
                  <Smartphone className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>ربط الجوال الشخصي</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  بصمة متصفح فريدة تمنع التسجيل بالنيابة مع فك ربط من الإدارة.
                </p>
              </div>
              <div className="pt-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-1">
                  <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>إدارة الصلاحيات</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  إنشاء وتعديل حسابات الموظفين والمديرين والتحكم الكامل بها.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            <form
              onSubmit={handleLogin}
              className="bg-white border border-slate-200 rounded-xl p-7 space-y-4"
            >
              <div>
                <h2 className="text-lg font-bold text-slate-900">تسجيل الدخول</h2>
                <p className="text-xs text-slate-500 mt-1">
                  أدخل اسم المستخدم وكلمة المرور المحددين من الإدارة.
                </p>
              </div>

              <div>
                <label
                  htmlFor="loginUsername"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  اسم المستخدم
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="loginUsername"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    maxLength={SCHEMA_LIMITS.USERNAME_MAX}
                    autoComplete="username"
                    placeholder="أدخل اسم المستخدم"
                    className="w-full h-11 pr-10 pl-3.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="loginPassword"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  كلمة المرور
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="loginPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={SCHEMA_LIMITS.PASSWORD_MAX}
                    autoComplete="current-password"
                    placeholder="أدخل كلمة المرور"
                    className="w-full h-11 pr-10 pl-10 bg-white border border-slate-300 rounded-lg text-sm font-mono text-slate-900 focus:border-teal-700 focus:ring-1 focus:ring-teal-700"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800"
                >
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2 h-11 px-5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>{isSubmitting ? 'جاري التحقق...' : 'دخول إلى النظام'}</span>
              </button>
            </form>
          </div>
        </main>

        <footer className="max-w-5xl w-full mx-auto pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>نظام البصمة الذكي</span>
          <span>بوابة الحضور والانصراف السحابية</span>
        </footer>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAdmin: user.role === 'admin',
        signOutUser,
        notificationPermission,
        requestNotificationPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
