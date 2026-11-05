import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.dvdmsv.cajadeherramientas',
  appName: 'Caja de herramientas',
  webDir: 'dist/android/browser',
  android: { allowMixedContent: false, minWebViewVersion: 130 },
  server: { errorPath: 'assets/android-webview.html' },
};

export default config;
