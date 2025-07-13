/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_ENV: string
  // Agrega más variables según las necesites
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}