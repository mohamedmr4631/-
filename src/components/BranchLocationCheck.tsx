import { useState } from 'react';
import { CheckCircle2, Crosshair, MapPin, ShieldAlert } from 'lucide-react';
import {
  getCurrentBranchLocation,
  verifyEmployeeLocation,
  type BranchGeoTarget,
  type LocationVerificationResult,
} from '../utils/location';

interface BranchLocationCheckProps {
  branchName: string;
  geoEnabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  branchId?: string;
  lastResult?: LocationVerificationResult | null;
  onVerified?: (result: LocationVerificationResult) => void;
}

export function BranchLocationCheck({
  branchName,
  geoEnabled,
  lat,
  lng,
  radiusMeters,
  branchId,
  lastResult,
  onVerified,
}: BranchLocationCheckProps) {
  const [checking, setChecking] = useState(false);
  const [localResult, setLocalResult] = useState<LocationVerificationResult | null>(
    null
  );
  const [infoText, setInfoText] = useState<{ ok: boolean; text: string } | null>(null);

  const effectiveResult = lastResult ?? localResult;
  const hasGeoTarget = geoEnabled && lat !== null && lng !== null;

  const handleVerify = async () => {
    setChecking(true);
    setInfoText(null);
    try {
      if (hasGeoTarget) {
        const target: BranchGeoTarget = {
          branchId,
          branchName,
          lat,
          lng,
          radiusMeters,
        };
        const res = await verifyEmployeeLocation(target);
        setLocalResult(res);
        setInfoText({ ok: res.allowed, text: res.message });
        onVerified?.(res);
      } else {
        const fix = await getCurrentBranchLocation();
        setInfoText({
          ok: true,
          text: `تمت قراءة GPS بنجاح (الدقة ±${fix.accuracyMeters} م). النطاق الجغرافي غير مفروض على "${branchName}".`,
        });
      }
    } catch (err) {
      setInfoText({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : 'تعذر قراءة الموقع الجغرافي (GPS) حالياً.',
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <MapPin className="w-4 h-4 text-teal-700 shrink-0" />
          <span>التحقق الجغرافي: {branchName}</span>
        </div>

        <button
          type="button"
          disabled={checking}
          onClick={() => void handleVerify()}
          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg border border-teal-200 bg-white hover:bg-teal-50 text-xs font-semibold text-teal-800 transition-colors disabled:opacity-50"
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0" />
          <span>{checking ? 'جاري الفحص...' : 'فحص الموقع (GPS)'}</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 tabular-nums">
        <span>
          حالة النطاق:{' '}
          <strong className="text-slate-900">
            {hasGeoTarget ? `مفروض (${radiusMeters} متر)` : 'غير مفروض'}
          </strong>
        </span>
        {effectiveResult && (
          <>
            <span>
              المسافة الحالية:{' '}
              <strong
                className={
                  effectiveResult.allowed ? 'text-emerald-700' : 'text-rose-700'
                }
              >
                {effectiveResult.distanceMeters} متر
              </strong>
            </span>
            <span>
              دقة GPS:{' '}
              <strong className="text-slate-900">
                ±{effectiveResult.accuracyMeters} متر
              </strong>
            </span>
          </>
        )}
      </div>

      {(infoText || effectiveResult) && (
        <div
          className={`flex items-start gap-2 p-2.5 rounded-lg border text-[11px] font-medium ${
            (infoText ? infoText.ok : effectiveResult?.allowed)
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {(infoText ? infoText.ok : effectiveResult?.allowed) ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-700 shrink-0 mt-0.5" />
          )}
          <span>{infoText ? infoText.text : effectiveResult?.message}</span>
        </div>
      )}
    </div>
  );
}
