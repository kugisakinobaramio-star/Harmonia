import { Music2 } from 'lucide-react';

export function StartupScreen() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="MusicKK is loading"
      className="fixed inset-0 z-[100] flex min-h-dvh items-center justify-center overflow-hidden bg-[#050706] text-white"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(29,185,84,0.13),transparent_58%)]" />
      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[1.7rem] border border-emerald-400/20 bg-emerald-400/[0.08] shadow-[0_0_70px_rgba(29,185,84,0.12)]">
          <Music2 className="h-10 w-10 text-[#1DB954]" strokeWidth={1.8} />
        </div>
        <div className="text-3xl font-black tracking-[-0.07em]">MusicKK</div>
        <p className="mt-2 text-sm text-zinc-400">Getting your music ready</p>
        <div className="mt-8 h-1 w-36 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-2/5 animate-[startup-progress_1.1s_ease-in-out_infinite] rounded-full bg-[#1DB954]" />
        </div>
      </div>
      <style>{`@keyframes startup-progress { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }`}</style>
    </div>
  );
}
