import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { buildAndroidCallbackRedirectFromWebLocation } from './lib/androidAuthBridge';
import './index.css';

function AndroidOAuthBridgeView({ deepLink, error }: { deepLink: string; error?: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace(deepLink);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  return (
    <div className="grid min-h-dvh place-items-center bg-[#0b0d0c] p-6 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#18181b] p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#1DB954] text-xl font-black text-black">
          M
        </div>
        <h1 className="text-lg font-extrabold text-white">
          {error ? 'Returning to MusicKK' : 'Completing Google Sign-In'}
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {error
            ? 'Tap below if MusicKK does not reopen automatically.'
            : 'Redirecting securely back to the MusicKK Android app…'}
        </p>
        <a
          href={deepLink}
          className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-[#1DB954] px-4 py-2.5 text-xs font-extrabold text-black hover:bg-[#1ed760]"
        >
          Open MusicKK
        </a>
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Harmonia root element is missing.');
}

const bridgeInfo =
  typeof window !== 'undefined'
    ? buildAndroidCallbackRedirectFromWebLocation(window.location.href)
    : { isBridgePage: false, appDeepLink: null };

createRoot(rootElement).render(
  <AppErrorBoundary>
    {bridgeInfo.isBridgePage && bridgeInfo.appDeepLink ? (
      <AndroidOAuthBridgeView deepLink={bridgeInfo.appDeepLink} error={bridgeInfo.error} />
    ) : (
      <App />
    )}
  </AppErrorBoundary>
);
