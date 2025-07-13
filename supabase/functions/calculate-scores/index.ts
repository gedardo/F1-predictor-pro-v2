import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors';

// Interfaces para tipado dentro de la función (ajusta según sea necesario)
interface RaceResult {
  id_carrera_pred: string;
  fecha_carrera: string; // "YYYY-MM-DD"
  pole_position_real_piloto_id: string | null;
  race_top_10_real: (string | null)[] | null;
  vuelta_rapida_real_piloto_id: string | null;
  piloto_del_dia_real_piloto_id: string | null;
  es_sprint: boolean;
  // Añade aquí campos para resultados de sprint si los tienes, ej: sprint_top_3_real: (string | null)[] | null;
}

interface UserPrediction {
  id_usuario: string;
  top3_clasificacion: (string | null)[] | null;
  // top3_sprint: (string | null)[] | null; // Omitido por ahora
  top10_carrera: (string | null)[] | null;
  vuelta_rapida_piloto_id: string | null;
  piloto_del_dia_id: string | null;
}

interface UserF1TeamSelection {
  id_usuario: string;
  pilotos_seleccionados: (string | null)[] | null;
  constructores_seleccionados: (string | null)[] | null;
}

interface F1Pilot {
  id_piloto_pred: string;
  id_equipo_pred: string | null;
  nombre: string;
}

// Constantes de Puntuación (similares a tus archivos types.ts y constants.ts)
const F1_POINTS_SYSTEM: Record<number, number> = {
    1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
};
const FASTEST_LAP_POINT_BONUS = 1;
// const F1_SPRINT_POINTS_SYSTEM: Record<number, number> = { /* ... */ }; // Omitido por ahora

const SCORING_RULES = [
  { action: 'Pole Position (Clasificación)', points: 10 },
  { action: 'Piloto en Podio (Posición Exacta - Carrera)', points: 25 },
  { action: 'Piloto en Podio (Posición Incorrecta - Carrera)', points: 10 },
  { action: 'Piloto en Top 10 (Posición Exacta - Carrera)', points: 5 },
  { action: 'Piloto en Top 10 (Posición Incorrecta dentro del Top 10 - Carrera)', points: 2 },
  { action: 'Vuelta Rápida (Carrera)', points: 10 },
  { action: 'Piloto del Día (Carrera)', points: 8 },
  // { action: 'Ganador Sprint (Exacto)', points: 15 }, // Omitido
  // { action: 'Podio Sprint (Posición Exacta)', points: 8 }, // Omitido
];

Deno.serve(async (req) => {
  // Manejo de CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { raceId } = await req.json();
    if (!raceId) {
      throw new Error("Falta raceId en la solicitud.");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configuradas.");
    }

    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    // 1. Obtener resultados reales de la carrera
    const { data: raceResult, error: raceError } = await supabaseClient
      .from('f1_carreras_predeterminadas')
      .select('id_carrera_pred, fecha_carrera, pole_position_real_piloto_id, race_top_10_real, vuelta_rapida_real_piloto_id, piloto_del_dia_real_piloto_id, es_sprint')
      .eq('id_carrera_pred', raceId)
      .single<RaceResult>();

    if (raceError || !raceResult) {
      throw new Error(`Carrera no encontrada o error al obtenerla: ${raceError?.message || 'Carrera no existe'}`);
    }
    if (!raceResult.race_top_10_real || !raceResult.pole_position_real_piloto_id || !raceResult.vuelta_rapida_real_piloto_id || !raceResult.piloto_del_dia_real_piloto_id) {
        throw new Error(`Los resultados reales para la carrera ${raceId} no están completos. No se pueden calcular las puntuaciones.`);
    }

    const eventDate = raceResult.fecha_carrera; // "YYYY-MM-DD"

    // 2. Obtener todas las predicciones para esta carrera
    const { data: predictions, error: predError } = await supabaseClient
      .from('usuarios_predicciones')
      .select('id_usuario, top3_clasificacion, top10_carrera, vuelta_rapida_piloto_id, piloto_del_dia_id') // top3_sprint omitido
      .eq('id_carrera_pred', raceId)
      .returns<UserPrediction[]>();

    if (predError) throw predError;

    // 3. Obtener todas las selecciones de equipos F1 de usuarios
    const { data: teamSelections, error: teamSelError } = await supabaseClient
      .from('usuarios_f1_equipos_seleccion')
      .select('id_usuario, pilotos_seleccionados, constructores_seleccionados')
      .returns<UserF1TeamSelection[]>();
      
    if (teamSelError) throw teamSelError;

    // 4. Obtener todos los pilotos (para referencia de equipo)
    const { data: allPilots, error: pilotsError } = await supabaseClient
        .from('f1_pilotos_predeterminados')
        .select('id_piloto_pred, id_equipo_pred, nombre')
        .returns<F1Pilot[]>();
    if (pilotsError) throw pilotsError;


    // Estructurar usuarios y sus datos
    const userScoresToUpdate: { userId: string; predScore: number; teamScore: number }[] = [];
    const allUserIds = new Set<string>();
    (predictions || []).forEach(p => allUserIds.add(p.id_usuario));
    (teamSelections || []).forEach(ts => allUserIds.add(ts.id_usuario));


    // --- INICIO LÓGICA DE PUNTUACIÓN ---
    for (const userId of allUserIds) {
      let totalPredictionScoreForUser = 0;
      let totalTeamScoreForUser = 0;

      // === A. Calcular Puntos de Predicción ===
      const userPrediction = (predictions || []).find(p => p.id_usuario === userId);
      if (userPrediction) {
        // Pole Position
        if (userPrediction.top3_clasificacion?.[0] && userPrediction.top3_clasificacion[0] === raceResult.pole_position_real_piloto_id) {
          totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Pole Position (Clasificación)')?.points || 0;
        }
        // Vuelta Rápida
        if (userPrediction.vuelta_rapida_piloto_id && userPrediction.vuelta_rapida_piloto_id === raceResult.vuelta_rapida_real_piloto_id) {
          totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Vuelta Rápida (Carrera)')?.points || 0;
        }
        // Piloto del Día
        if (userPrediction.piloto_del_dia_id && userPrediction.piloto_del_dia_id === raceResult.piloto_del_dia_real_piloto_id) {
          totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Piloto del Día (Carrera)')?.points || 0;
        }
        // Top 10 Carrera
        if (userPrediction.top10_carrera && raceResult.race_top_10_real) {
          userPrediction.top10_carrera.forEach((predictedPilotId, predIdx) => {
            if (!predictedPilotId) return; // Skip si el usuario no predijo esta posición

            const actualPilotInPredPosition = raceResult.race_top_10_real![predIdx];
            const actualPositionOfPredictedPilot = raceResult.race_top_10_real!.indexOf(predictedPilotId);

            if (predictedPilotId === actualPilotInPredPosition) { // Acierto exacto
              if (predIdx < 3) totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Piloto en Podio (Posición Exacta - Carrera)')?.points || 0;
              else totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Piloto en Top 10 (Posición Exacta - Carrera)')?.points || 0;
            } else if (actualPositionOfPredictedPilot !== -1) { // Piloto está en Top 10 pero en otro lugar
              if (predIdx < 3 && actualPositionOfPredictedPilot < 3) totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Piloto en Podio (Posición Incorrecta - Carrera)')?.points || 0;
              else totalPredictionScoreForUser += SCORING_RULES.find(r => r.action === 'Piloto en Top 10 (Posición Incorrecta dentro del Top 10 - Carrera)')?.points || 0;
            }
          });
        }
        // Sprint scoring omitido por ahora
      }

      // === B. Calcular Puntos de Equipo F1 ===
      const userTeamSelection = (teamSelections || []).find(ts => ts.id_usuario === userId);
      if (userTeamSelection) {
        // Puntos de Pilotos Seleccionados
        if (userTeamSelection.pilotos_seleccionados) {
          for (const selectedPilotId of userTeamSelection.pilotos_seleccionados) {
            if (!selectedPilotId) continue;
            const pilotActualPositionIdx = raceResult.race_top_10_real!.indexOf(selectedPilotId);
            if (pilotActualPositionIdx !== -1) {
              const racePosition = pilotActualPositionIdx + 1;
              totalTeamScoreForUser += (F1_POINTS_SYSTEM[racePosition] || 0);
              // Bonus vuelta rápida para piloto del equipo
              if (selectedPilotId === raceResult.vuelta_rapida_real_piloto_id && racePosition <= 10) {
                totalTeamScoreForUser += FASTEST_LAP_POINT_BONUS;
              }
            }
            // Sprint scoring omitido
          }
        }
        // Puntos de Constructores Seleccionados
        if (userTeamSelection.constructores_seleccionados) {
            for (const selectedConstructorId of userTeamSelection.constructores_seleccionados) {
                if (!selectedConstructorId) continue;
                const constructorPilots = (allPilots || []).filter(p => p.id_equipo_pred === selectedConstructorId);
                for (const officialPilot of constructorPilots) {
                    const pilotActualPositionIdx = raceResult.race_top_10_real!.indexOf(officialPilot.id_piloto_pred);
                    if (pilotActualPositionIdx !== -1) {
                        const racePosition = pilotActualPositionIdx + 1;
                        totalTeamScoreForUser += (F1_POINTS_SYSTEM[racePosition] || 0);
                        // Bonus vuelta rápida para pilotos oficiales del constructor
                        if (officialPilot.id_piloto_pred === raceResult.vuelta_rapida_real_piloto_id && racePosition <= 10) {
                            totalTeamScoreForUser += FASTEST_LAP_POINT_BONUS;
                        }
                    }
                    // Sprint scoring omitido
                }
            }
        }
      }
      userScoresToUpdate.push({ userId, predScore: totalPredictionScoreForUser, teamScore: totalTeamScoreForUser });
    }
    // --- FIN LÓGICA DE PUNTUACIÓN ---


    // 5. Actualizar (Upsert) la tabla user_scores
    if (userScoresToUpdate.length > 0) {
      const upsertData = userScoresToUpdate.map(score => ({
        user_id: score.userId,
        event_date: eventDate, // Fecha de la carrera
        score_predictions: score.predScore,
        score_team: score.teamScore,
        // score_guess_the_pilot se mantiene o se establece en 0 por defecto si es una nueva fila para esta fecha
        // La columna event_total_score se calcula automáticamente en la DB
      }));

      const { error: upsertError } = await supabaseClient
        .from('user_scores')
        .upsert(upsertData, { onConflict: 'user_id,event_date', ignoreDuplicates: false }); 
        // `ignoreDuplicates: false` significa que actualizará las columnas especificadas en caso de conflicto.
        // Las columnas no especificadas en `upsertData` (como `score_guess_the_pilot`)
        // mantendrán su valor existente si la fila ya existía, o tomarán el valor por defecto de la DB si es una fila nueva.

      if (upsertError) {
        console.error("Error al hacer upsert en user_scores:", upsertError);
        throw new Error(`Error al actualizar user_scores: ${upsertError.message}`);
      }
    }

    return new Response(JSON.stringify({ message: "Puntuaciones calculadas y actualizadas con éxito para la carrera " + raceId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en la función calculate-scores:", error);
    return new Response(JSON.stringify({ error: error.message || "Error desconocido en la función." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})