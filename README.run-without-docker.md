# Ejecutar F1-Predictor-Pro sin Docker

Si prefieres ejecutar la aplicación sin Docker, puedes seguir estas instrucciones.

## Requisitos previos

- Node.js (versión 18 o superior)
- npm (normalmente viene con Node.js)

## Pasos para ejecutar la aplicación

### 1. Instalar dependencias

En el directorio raíz del proyecto, ejecuta:

```bash
npm install
```

### 2. Configurar variables de entorno

Asegúrate de que el archivo `.env` contiene las variables de entorno necesarias:

```
GEMINI_API_KEY=tu_clave_api_gemini
VITE_SUPABASE_URL=tu_url_supabase
VITE_SUPABASE_ANON_KEY=tu_clave_anonima_supabase
VITE_APP_ENV=development
```

### 3. Ejecutar en modo desarrollo

Para iniciar el servidor de desarrollo:

```bash
npm run dev
```

La aplicación estará disponible en http://localhost:5173 (o el puerto que Vite asigne si el 5173 está ocupado).

### 4. Construir para producción

Para crear una versión optimizada para producción:

```bash
npm run build
```

Esto generará los archivos estáticos en el directorio `dist`.

### 5. Vista previa de la versión de producción

Para previsualizar la versión de producción localmente:

```bash
npm run preview
```

## Solución de problemas comunes

### Error de conexión a Supabase

Si encuentras errores de conexión a Supabase, verifica:

- Que las claves en el archivo `.env` sean correctas
- Que tu proyecto de Supabase esté activo y accesible
- Que tu IP no esté bloqueada por las reglas de seguridad de Supabase

### Errores de dependencias

Si encuentras errores relacionados con dependencias:

```bash
npm clean-install
```

Esto eliminará `node_modules` y realizará una instalación limpia.

## Desarrollo

Para un flujo de trabajo de desarrollo óptimo:

- Utiliza `npm run dev` para desarrollo con recarga en caliente
- La aplicación utiliza React Router para la navegación
- Los datos se obtienen principalmente de Supabase y la API externa de F1