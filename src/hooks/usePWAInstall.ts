import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isChrome, setIsChrome] = useState(false);
  const [isSafari, setIsSafari] = useState(false);
  const [isHttps, setIsHttps] = useState(true);
  const [domainOrigin, setDomainOrigin] = useState('');
  const [swActive, setSwActive] = useState<boolean | null>(null);
  const [manifestDetected, setManifestDetected] = useState(false);

  const refreshEnvironmentChecks = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setIsHttps(
      window.isSecureContext || window.location.protocol === 'https:'
    );
    setDomainOrigin(window.location.origin);
    setManifestDetected(
      Boolean(document.querySelector('link[rel="manifest"]'))
    );

    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        setSwActive(Boolean(reg));
      } catch {
        setSwActive(false);
      }
    } else {
      setSwActive(false);
    }
  }, []);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroidDevice = /android/.test(userAgent);
    const isChromeBrowser =
      /chrome|crios/.test(userAgent) && !/edg|opr/.test(userAgent);
    const isSafariBrowser =
      isIOSDevice && /safari/.test(userAgent) && !/crios|fxios|edgios/.test(userAgent);

    setIsIOS(isIOSDevice);
    setIsAndroid(isAndroidDevice);
    setIsChrome(isChromeBrowser);
    setIsSafari(isSafariBrowser);

    void refreshEnvironmentChecks();

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [refreshEnvironmentChecks]);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
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
  };
}
