# Dockerización de F1-Predictor-Pro

Este documento explica cómo construir y ejecutar la aplicación F1-Predictor-Pro utilizando Docker.

## Requisitos previos

- Docker instalado en tu sistema
- Docker Compose instalado en tu sistema (opcional, pero recomendado)

## Instalación de Docker (si no está instalado)

Se ha incluido un script de PowerShell para facilitar la instalación de Docker Desktop en Windows:

1. Abre PowerShell como administrador
2. Navega al directorio del proyecto
3. Ejecuta el siguiente comando:

```powershell
.\install-docker.ps1
```

Sigue las instrucciones del script. Es posible que necesites reiniciar tu sistema durante el proceso de instalación.

## Archivos de configuración Docker

Se han creado los siguientes archivos para la dockerización:

- `Dockerfile`: Define cómo construir la imagen Docker
- `.dockerignore`: Especifica qué archivos ignorar al construir la imagen
- `nginx.conf`: Configuración de Nginx para servir la aplicación
- `docker-compose.yml`: Facilita la ejecución del contenedor

## Construcción y ejecución con Docker

### Usando Docker directamente

1. Construir la imagen Docker:

```bash
docker build -t f1-predictor-pro .
```

2. Ejecutar el contenedor:

```bash
docker run -p 8080:80 f1-predictor-pro
```

La aplicación estará disponible en http://localhost:8080

### Usando Docker Compose (recomendado)

1. Construir y ejecutar con un solo comando:

```bash
docker-compose up -d
```

2. Para detener la aplicación:

```bash
docker-compose down
```

La aplicación estará disponible en http://localhost:8080

## Variables de entorno

Las variables de entorno se configuran durante la fase de construcción. Si necesitas cambiar las variables de entorno después de la construcción, deberás reconstruir la imagen.

## Notas adicionales

- La configuración actual está optimizada para producción
- Para desarrollo, considera usar volúmenes para montar los archivos locales (descomenta las líneas correspondientes en docker-compose.yml)
- La configuración de Nginx incluye optimizaciones para rendimiento y seguridad