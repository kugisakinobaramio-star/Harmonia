import { ArrowRight, Check, Music2, Sparkles } from 'lucide-react';
import { useState } from 'react';

const MOOD_CHOICES = [
  { id: 'Bollywood Romantic', detail: 'Melody, romance and film music' },
  { id: 'Anime & J-Pop', detail: 'Anime themes and Japanese pop' },
  { id: 'Late Night Dark', detail: 'Atmospheric, mellow and moody' },
  { id: 'Acoustic Unplugged', detail: 'Warm vocals and organic sound' },
  { id: 'Workout Energy', detail: 'Upbeat tracks with momentum' },
  { id: 'Indie & R&B', detail: 'Alternative, soul and smooth grooves' },
];

interface WelcomeExperienceProps {
  hasCompletedSetup: boolean;
  initialMoods: string[];
  onComplete: (moods: string[]) => void;
}

export function WelcomeExperience({
  hasCompletedSetup,
  initialMoods,
  onComplete,
}: WelcomeExperienceProps) {
  const [stage, setStage] = useState<'intro' | 'moods'>('intro');
  const [selected, setSelected] = useState<string[]>(initialMoods);

  const toggleMood = (mood: string) => {
    setSelected((current) =>
      current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood]
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-[#050906] px-5 py-8 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="welcome-orb absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-[#38d879]/15 blur-[100px]" />
        <div className="absolute bottom-[-14rem] right-[-8rem] h-80 w-80 rounded-full bg-[#1b8e53]/10 blur-[90px]" />
      </div>

      {stage === 'intro' ? (
        <section className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
          <div className="welcome-mark relative mb-8 grid h-32 w-32 place-items-center rounded-[2.2rem] border border-[#8bffae]/20 bg-[#0c1710] shadow-[0_0_90px_rgba(69,224,124,0.16)]">
            <img src="/musick-mark.svg" alt="" className="h-full w-full rounded-[2.2rem]" />
            <span className="welcome-ring absolute -inset-3 rounded-[2.7rem] border border-[#7ee2a8]/20" />
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.38em] text-[#83e9a7]">Your sound. Your space.</p>
          <h1 className="text-5xl font-black tracking-[-0.07em] sm:text-6xl">Musick<span className="text-[#75e99b]">.</span></h1>
          <p className="mt-4 max-w-xs text-sm leading-6 text-zinc-400">
            One place for the music you love, wherever you find it.
          </p>
          <button
            type="button"
            onClick={() => hasCompletedSetup ? onComplete(initialMoods) : setStage('moods')}
            className="mt-10 inline-flex min-h-14 w-full max-w-xs items-center justify-center gap-3 rounded-full bg-[#79e99f] px-7 text-sm font-extrabold text-[#07110a] shadow-[0_10px_36px_rgba(69,224,124,0.2)] transition-transform active:scale-[0.98]"
          >
            Tap to Start <ArrowRight className="h-4 w-4" />
          </button>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">Made for your listening mood</p>
        </section>
      ) : (
        <section className="relative z-10 w-full max-w-lg">
          <div className="mb-8 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl border border-[#7ee2a8]/20 bg-[#102017] text-[#7ee2a8]">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#7ee2a8]">A quick first step</p>
              <p className="text-sm text-zinc-400">You can change these anytime in Personalise.</p>
            </div>
          </div>

          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">What do you feel like listening to?</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            Pick a few moods to shape your starting recommendations. This is optional.
          </p>

          <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {MOOD_CHOICES.map((mood) => {
              const active = selected.includes(mood.id);
              return (
                <button
                  key={mood.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleMood(mood.id)}
                  className={`flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors ${active ? 'border-[#78e99e]/70 bg-[#173522]' : 'border-white/10 bg-white/[0.035] hover:bg-white/[0.07]'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-white">{mood.id}</span>
                    <span className="mt-1 block text-[11px] leading-4 text-zinc-400">{mood.detail}</span>
                  </span>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${active ? 'border-[#79e99f] bg-[#79e99f] text-[#07110a]' : 'border-white/20 text-transparent'}`}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => onComplete(selected)}
            className="mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#79e99f] px-6 text-sm font-extrabold text-[#07110a] transition-transform active:scale-[0.99]"
          >
            <Sparkles className="h-4 w-4" /> {selected.length ? 'Build my music space' : 'Continue without choosing'}
          </button>
          <button
            type="button"
            onClick={() => onComplete(initialMoods)}
            className="mt-3 min-h-10 w-full text-xs font-semibold text-zinc-500 hover:text-white"
          >
            Skip for now
          </button>
        </section>
      )}
    </div>
  );
}
