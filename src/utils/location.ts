export interface BranchGeoTarget {
  branchId?: string;
  branchName: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  maxAccuracyMeters?: number;
}

export interface GeoFix {
  lat: number;
  lng: number;
  accuracyMeters: number;
  timestamp: number;
}

export interface LocationVerificationResult {
  allowed: boolean;
  distanceMeters: number;
  radiusMeters: number;
  accuracyMeters: number;
  fix: GeoFix;
  message: string;
}

export function isIosDevice(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  const ua = window.navigator.userAgent.toLowerCase();
  return (
    /iphone|ipad|ipod/.test(ua) ||
    (ua.includes('mac') && 'ontouchend' in document)
  );
}

/**
 * حساب المسافة بالأمتار بين نقطتين جغرافيتين باستخدام صيغة Haversine
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusMeters = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

function buildGeoErrorMessage(code: number | undefined, isIos: boolean): string {
  if (code === 1) {
    if (isIos) {
      return (
        'تم رفض إذن الموقع الجغرافي على الآيفون. فعّله من: ' +
        'الإعدادات > الخصوصية والأمن > خدمات الموقع > Safari (أو التطبيق المثبّت) ثم اختر "أثناء استخدام التطبيق" وتأكد من تفعيل "الموقع الدقيق".'
      );
    }
    return (
      'تم رفض إذن الموقع الجغرافي على الأندرويد. فعّله من: ' +
      'إعدادات الجوال > الموقع (Location) ثم أذونات التطبيقات > المتصفح/التطبيق > السماح أثناء استخدام التطبيق مع تفعيل الدقة العالية.'
    );
  }

  if (code === 2) {
    return isIos
      ? 'تعذر تحديد موقعك عبر GPS حالياً على الآيفون. تأكد من تشغيل خدمة الموقع والوايفاي/البيانات ثم أعد المحاولة.'
      : 'تعذر تحديد موقعك عبر GPS حالياً على الأندرويد. فعّل "الموقع (Location)" من شريط الاختصارات أو الإعدادات وتأكد من وجود إشارة جيدة.';
  }

  if (code === 3) {
    return (
      'انتهت مهلة تحديد الموقع عبر GPS قبل الحصول على قراءة دقيقة. ' +
      'تحرك خطوتين نحو مكان مفتوح أو قريب من نافذة/مدخل الفرع ثم أعد المحاولة.'
    );
  }

  return (
    'تعذر التحقق من موقعك الجغرافي. تأكد من فتح الرابط عبر اتصال آمن (HTTPS) وتفعيل خدمة الموقع في الجوال.'
  );
}

/**
 * قراءة إحداثيات GPS الحالية مع محاولة أولى بدقة عالية ثم بديل أسرع عند الحاجة
 */
export function getCurrentBranchLocation(
  timeoutMs = 12_000
): Promise<GeoFix> {
  const ios = isIosDevice();

  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('المتصفح أو الجهاز الحالي لا يدعم خدمة تحديد الموقع (GPS).'));
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      reject(
        new Error(
          'خدمة الموقع GPS تتطلب اتصالاً آمناً HTTPS. تأكد من فتح التطبيق عبر رابط HTTPS.'
        )
      );
      return;
    }

    const requestFix = (highAccuracy: boolean, allowFallback: boolean) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyMeters: Math.round(pos.coords.accuracy || 0),
            timestamp: pos.timestamp || Date.now(),
          });
        },
        (err) => {
          if (err.code === 1) {
            reject(new Error(buildGeoErrorMessage(err.code, ios)));
            return;
          }
          if (allowFallback && highAccuracy) {
            requestFix(false, false);
            return;
          }
          reject(new Error(buildGeoErrorMessage(err.code, ios)));
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: timeoutMs,
          maximumAge: highAccuracy ? 0 : 15_000,
        }
      );
    };

    requestFix(true, true);
  });
}

/**
 * التحقق من وجود الموظف داخل نطاق الفرع المحدد
 */
export async function verifyEmployeeLocation(
  target: BranchGeoTarget
): Promise<LocationVerificationResult> {
  const fix = await getCurrentBranchLocation();
  const distanceMeters = calculateDistanceMeters(
    fix.lat,
    fix.lng,
    target.lat,
    target.lng
  );
  const radiusMeters = Math.max(10, Number(target.radiusMeters) || 50);

  const accuracyAllowance = Math.min(
    Math.max(0, fix.accuracyMeters - 15),
    Math.round(radiusMeters * 0.5)
  );
  const effectiveDistance = Math.max(0, distanceMeters - accuracyAllowance);
  const allowed = effectiveDistance <= radiusMeters;

  if (!allowed) {
    return {
      allowed: false,
      distanceMeters,
      radiusMeters,
      accuracyMeters: fix.accuracyMeters,
      fix,
      message:
        `أنت خارج نطاق "${target.branchName}" المسموح (${radiusMeters} متر). ` +
        `المسافة الحالية التقريبية: ${distanceMeters} متر. يجب التواجد داخل الفرع لإتمام البصمة.`,
    };
  }

  return {
    allowed: true,
    distanceMeters,
    radiusMeters,
    accuracyMeters: fix.accuracyMeters,
    fix,
    message:
      `تم التحقق من موقعك داخل "${target.branchName}" ` +
      `(المسافة: ${distanceMeters} متر من أصل ${radiusMeters} متر مسموحة).`,
  };
}
