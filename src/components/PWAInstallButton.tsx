import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Globe,
  MapPin,
  MoreVertical,
  Share,
  ShieldCheck,
  Smartphone,
  X,
  XCircle,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getCurrentBranchLocation, type GeoFix } from '../utils/location';

export function PWAInstallButton() {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isAndroid,
    isChrome,
    isSafari,
    isHttps,
    domainOrigin,
    swActive,
    manifestDetected,
    install,
    refreshEnvironmentChecks,
  } = usePWAInstall();

  const [guideOpen, setGuideOpen] = useState(false);
  const [testingGeo, setTestingGeo] = useState(false);
  const [geoResult, setGeoResult] = useState<{
    ok: boolean;
    message: string;
    fix?: GeoFix;
  } | null>(null);

  const handleOpenGuide = () => {
    void refreshEnvironmentChecks();
    setGuideOpen(true);
  };

  const handleTestGeo = async () => {
    setTestingGeo(true);
    setGeoResult(null);
    try {
      const fix = await getCurrentBranchLocation();
      setGeoResult({
        ok: true,
        message: `تم تحديد الموقع بنجاح (دقة التقريب: ${fix.accuracyMeters} متر).`,
        fix,
      });
    } catch (err) {
      setGeoResult({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : 'تعذر قراءة الموقع الجغرافي (GPS).',
      });
    } finally {
      setTestingGeo(false);
    }
  };

  const buttonLabel = isInstalled
    ? 'تطبيق مثبّت'
    : isInstallable
      ? 'تثبيت التطبيق'
      : isIOS
        ? 'تثبيت على الآيفون'
        : isAndroid
          ? 'تثبيت على الأندرويد'
          : 'تثبيت / فحص الجوال';

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        {!isInstalled && isInstallable ? (
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span>تثبيت التطبيق</span>
          </button>
        ) : !isInstalled ? (
          <button
            type="button"
            onClick={handleOpenGuide}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0 text-teal-700" />
            <span>{buttonLabel}</span>
          </button>
        ) : null}

        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={handleOpenGuide}
            title="فحص HTTPS وجاهزية الأندرويد والآيفون"
            aria-label="فحص HTTPS وجاهزية الجوال"
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition-colors shrink-0"
          >
            <ShieldCheck className="w-4 h-4 text-teal-700" />
          </button>
        )}
      </div>

      {guideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-readiness-title"
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-teal-700" />
                <h3 id="pwa-readiness-title" className="text-base font-bold text-slate-900">
                  التثبيت على الجوال وفحص HTTPS (Android / iPhone)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label="إغلاق"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live HTTPS, Manifest & Service Worker Check */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                  <Globe className="w-3.5 h-3.5 text-teal-700" />
                  <span>بروتوكول الأمان (HTTPS)</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    isHttps ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {isHttps ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>آمن (HTTPS)</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5" />
                      <span>غير آمن</span>
                    </>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">الدومين الحالي</span>
                <span className="font-mono text-[11px] text-slate-800 truncate max-w-[230px]" dir="ltr">
                  {domainOrigin || '—'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">ملف التطبيق (Manifest)</span>
                <span
                  className={`font-bold ${
                    manifestDetected ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {manifestDetected ? 'متصل وجاهز' : 'جاري التحميل'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600">Service Worker (العمل أوفلاين)</span>
                <span
                  className={`font-bold ${
                    swActive ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {swActive === null
                    ? 'جاري الفحص...'
                    : swActive
                      ? 'مفعّل'
                      : 'يتطلب تحديث الصفحة على HTTPS'}
                </span>
              </div>
            </div>

            {/* Android / Chrome Section */}
            <div className="rounded-xl border border-sky-100 bg-[#f8fcff] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900">
                  1. التثبيت على Android (متصفح Chrome)
                </h4>
                {isAndroid && isChrome && (
                  <span className="text-[11px] font-bold text-teal-800">جهازك الحالي</span>
                )}
              </div>

              {isInstallable ? (
                <button
                  type="button"
                  onClick={() => void install()}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-[#3292a6] hover:bg-[#267484] text-white text-xs font-bold rounded-xl transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>اضغط هنا لتثبيت التطبيق مباشرة عبر Chrome</span>
                </button>
              ) : (
                <ol className="space-y-1.5 text-xs text-slate-700 list-decimal list-inside leading-relaxed">
                  <li>
                    افتح الموقع في <strong>Google Chrome</strong> عبر رابط <strong>HTTPS</strong>.
                  </li>
                  <li>
                    اضغط على قائمة Chrome{' '}
                    <MoreVertical className="inline w-3.5 h-3.5 text-slate-700" /> أعلى الشاشة.
                  </li>
                  <li>
                    اختر <strong>تثبيت التطبيق (Install app)</strong> أو{' '}
                    <strong>الإضافة إلى الشاشة الرئيسية</strong>.
                  </li>
                </ol>
              )}
            </div>

            {/* iOS / Safari Section */}
            <div className="rounded-xl border border-slate-200 bg-[#fcfaf5] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900">
                  2. الإضافة للشاشة الرئيسية على iPhone (Safari)
                </h4>
                {isIOS && (
                  <span className="text-[11px] font-bold text-teal-800">
                    {isSafari ? 'Safari نشط' : 'افتحه في Safari'}
                  </span>
                )}
              </div>
              <ol className="space-y-1.5 text-xs text-slate-700 list-decimal list-inside leading-relaxed">
                <li>
                  افتح الرابط في متصفح <strong>Safari</strong> (وليس داخل متصفح داخلي).
                </li>
                <li>
                  اضغط على زر <strong>المشاركة</strong>{' '}
                  <Share className="inline w-3.5 h-3.5 text-teal-700 mx-0.5" /> في الشريط السفلي.
                </li>
                <li>
                  اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong> ثم{' '}
                  <strong>إضافة</strong>.
                </li>
              </ol>
            </div>

            {/* GPS Test Section */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  3. اختبار صلاحية الموقع الجغرافي (GPS) على الجوال
                </span>
                <button
                  type="button"
                  disabled={testingGeo}
                  onClick={() => void handleTestGeo()}
                  className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{testingGeo ? 'جاري الفحص...' : 'اختبار GPS الآن'}</span>
                </button>
              </div>
              {geoResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-semibold ${
                    geoResult.ok
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : 'bg-rose-50 text-rose-900 border border-rose-200'
                  }`}
                >
                  <div>{geoResult.message}</div>
                  {geoResult.fix && (
                    <div className="font-mono text-[11px] mt-1 opacity-80" dir="ltr">
                      {geoResult.fix.lat.toFixed(6)}, {geoResult.fix.lng.toFixed(6)} (±{geoResult.fix.accuracyMeters}m)
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="w-full min-h-[44px] py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </>
  );
}
