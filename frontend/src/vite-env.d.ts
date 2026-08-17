/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SSID shown on the WiFi tab. */
  readonly VITE_WIFI_SSID?: string;
  /** Guest network password shown on the WiFi tab. */
  readonly VITE_WIFI_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
