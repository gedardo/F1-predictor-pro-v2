/**
 * Este archivo contiene el mapeo entre los IDs de la API externa (f1-api-node) y los IDs utilizados en la base de datos.
 * Se utiliza para asegurar la consistencia en la visualización de datos en la aplicación.
 */

// Mapeo de IDs de pilotos: de la API externa a los IDs de la base de datos
export const driverIdMapping: Record<string, string> = {
  // Formato: 'ID_API_EXTERNA': 'ID_BASE_DATOS'
  'ver': 'verstappen',
  'ham': 'hamilton',
  'rus': 'russell',
  'lec': 'leclerc',
  'sai': 'sainz',
  'nor': 'norris',
  'pia': 'piastri',
  'alo': 'alonso',
  'str': 'stroll',
  'gas': 'gasly',
  'oco': 'ocon',
  'hul': 'hulkenberg',
  'alb': 'albon',
  'tsu': 'tsunoda',
  'law': 'lawson',
  'had': 'hadjar',
  'bea': 'bearman',
  'ant': 'antonelli',
  'col': 'colapinto',
  'bor': 'bortoleto'
};

// Mapeo de IDs de equipos: de la API externa a los IDs de la base de datos
export const teamIdMapping: Record<string, string> = {
  // Formato: 'ID_API_EXTERNA': 'ID_BASE_DATOS'
  'redbullracing': 'redbull',
  'mercedes': 'mercedes',
  'ferrari': 'ferrari',
  'mclaren': 'mclaren',
  'astonmartin': 'astonmartin',
  'alpine': 'alpine',
  'haas': 'haas',
  'visacashapprb': 'rb',
  'stakef1team': 'sauber',
  'williams': 'williams'
};

/**
 * Función para obtener el ID de piloto de la base de datos a partir del ID de la API externa
 * @param apiDriverId ID del piloto en la API externa
 * @returns ID del piloto en la base de datos o el ID original si no se encuentra mapeo
 */
export function getDbDriverId(apiDriverId: string): string {
  // Convertir a minúsculas y eliminar espacios para normalizar
  const normalizedId = apiDriverId.toLowerCase().replace(/\s/g, '');
  
  // Buscar en el mapeo directo
  if (driverIdMapping[normalizedId]) {
    return driverIdMapping[normalizedId];
  }
  
  // Si no se encuentra en el mapeo, extraer las tres últimas letras si es posible
  // Este es el formato que parece usar la API: 'Oscar PiastriPIA' -> 'pia'
  const match = apiDriverId.match(/[A-Z]{3}$/);
  if (match) {
    const code = match[0].toLowerCase();
    if (driverIdMapping[code]) {
      return driverIdMapping[code];
    }
  }
  
  // Si no se encuentra mapeo, devolver el ID normalizado
  return normalizedId;
}

/**
 * Función para obtener el ID de equipo de la base de datos a partir del ID de la API externa
 * @param apiTeamId ID del equipo en la API externa
 * @returns ID del equipo en la base de datos o el ID original si no se encuentra mapeo
 */
export function getDbTeamId(apiTeamId: string): string {
  // Convertir a minúsculas y eliminar espacios para normalizar
  const normalizedId = apiTeamId.toLowerCase().replace(/\s/g, '');
  
  // Buscar en el mapeo directo
  if (teamIdMapping[normalizedId]) {
    return teamIdMapping[normalizedId];
  }
  
  // Si no se encuentra mapeo, devolver el ID normalizado
  return normalizedId;
}