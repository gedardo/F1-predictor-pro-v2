# F1-Predictor-Pro

Aplicación web para predecir resultados de carreras de Fórmula 1, gestionar equipos virtuales y seguir las clasificaciones de pilotos y constructores.

## Características

- Visualización de clasificaciones de pilotos y constructores
- Predicciones de resultados de carreras
- Creación y gestión de equipos virtuales de F1
- Juego de adivinanzas de pilotos
- Calendario de carreras con información detallada
- Noticias actualizadas de F1

## Tecnologías utilizadas

- React 19
- TypeScript
- Vite
- Supabase (autenticación y base de datos)
- API externa de F1 (f1-api-node)
- Google Gemini API (para noticias)

## Opciones para ejecutar la aplicación

Hay varias formas de ejecutar esta aplicación:

### 1. Usando Docker (recomendado para producción)

Si prefieres usar Docker para ejecutar la aplicación en un entorno aislado:

```bash
# Construir la imagen Docker
docker build -t f1-predictor-pro .

# Ejecutar el contenedor
docker run -p 8080:80 f1-predictor-pro
```

O usando Docker Compose:

```bash
docker-compose up -d
```

Para más detalles, consulta [README.docker.md](./README.docker.md).

### 2. Usando el script de PowerShell

Se ha incluido un script de PowerShell para facilitar la ejecución:

```powershell
.\run-app.ps1
```

Este script proporciona un menú interactivo para instalar dependencias, ejecutar en modo desarrollo, construir para producción o previsualizar la versión de producción.

### 3. Manualmente con npm

Para ejecutar la aplicación manualmente:

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# O construir para producción
npm run build
npm run preview
```

Para más detalles, consulta [README.run-without-docker.md](./README.run-without-docker.md).

## Configuración

La aplicación requiere las siguientes variables de entorno en un archivo `.env`:

```
GEMINI_API_KEY=tu_clave_api_gemini
VITE_SUPABASE_URL=tu_url_supabase
VITE_SUPABASE_ANON_KEY=tu_clave_anonima_supabase
VITE_APP_ENV=development
```

## Estructura del proyecto

- `/components`: Componentes reutilizables de React
- `/contexts`: Contextos de React para gestión de estado global
- `/pages`: Componentes de página para cada ruta
- `/services`: Servicios para interactuar con APIs externas
- `/utils`: Utilidades y funciones auxiliares
- `/lib`: Bibliotecas y configuraciones
- `/types`: Definiciones de tipos TypeScript

## Contribuir

Si deseas contribuir a este proyecto:

1. Haz un fork del repositorio
2. Crea una rama para tu característica (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'Add some amazing feature'`)
4. Haz push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request
