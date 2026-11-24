import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harmonia.music',
  appName: 'MusicKK',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: { CapacitorHttp: { enabled: true } },
};

export default config;
