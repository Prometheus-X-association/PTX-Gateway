/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESIGN_THEME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
