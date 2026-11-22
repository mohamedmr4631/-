export type BrowserNotificationStatus = NotificationPermission | 'unsupported';

export function getBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function getActiveServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return existing;
    }
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500)),
    ]);
  } catch {
    return null;
  }
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  try {
    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    const result = await new Promise<NotificationPermission>((resolve) => {
      try {
        const maybePromise = Notification.requestPermission((legacyResult) => {
          resolve(legacyResult);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(() => resolve(Notification.permission));
        }
      } catch {
        resolve(Notification.permission);
      }
    });

    return result;
  } catch {
    return getBrowserNotificationStatus();
  }
}

export async function showBrowserNotification(options: {
  title: string;
  body: string;
  tag: string;
}): Promise<boolean> {
  if (getBrowserNotificationStatus() !== 'granted') {
    return false;
  }

  const notifOptions: NotificationOptions & { renotify?: boolean } = {
    body: options.body,
    tag: options.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    renotify: true,
  };

  // Prefer ServiceWorkerRegistration.showNotification so Android/mobile browsers work reliably
  try {
    const reg = await getActiveServiceWorkerRegistration();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(options.title, notifOptions);
      return true;
    }
  } catch {
    // Fall back to standard Notification constructor below
  }

  try {
    const notification = new Notification(options.title, notifOptions);
    notification.onclick = () => {
      try {
        window.focus();
        notification.close();
      } catch {
        // Ignore focus errors in restricted frames
      }
    };
    return true;
  } catch {
    return false;
  }
}
