
import React from 'react';
import { SCORING_RULES } from '../constants';
import { BookOpen, HelpCircle, Puzzle, Users2Icon, Target } from 'lucide-react'; // Added Users2Icon, Target
import { F1_POINTS_SYSTEM, F1_SPRINT_POINTS_SYSTEM, FASTEST_LAP_POINT_BONUS } from '../types'; // Import points systems


const RulesPage: React.FC = () => {
  return (
    <div className="container mx-auto p-4 sm:p-6 lg:p-8">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-red-500 flex items-center justify-center">
            <BookOpen size={40} className="mr-3 text-red-600" />
            Reglas del Juego y Puntuación
        </h1>
        <p className="text-gray-300 mt-2 text-lg">Entiende cómo se calculan tus puntos en F1 Predictor Pro.</p>
      </header>

      <section className="bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl mb-12">
        <h2 className="text-2xl font-semibold text-red-400 mb-6 border-b-2 border-red-500 pb-2 flex items-center">
          <Target size={28} className="mr-2"/> Sistema de Puntuación por Predicciones de Carrera
        </h2>
        <div className="space-y-4">
          {SCORING_RULES.map((rule, index) => (
            <div key={index} className="p-4 bg-gray-700 rounded-lg shadow-md flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">{rule.action}</h3>
                {rule.description && <p className="text-sm text-gray-300 mt-1">{rule.description}</p>}
              </div>
              <div className="ml-4 text-right">
                <span className="text-2xl font-bold text-yellow-400">{rule.points}</span>
                <span className="block text-xs text-gray-400">puntos</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      
      <section className="bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl mb-12">
        <h2 className="text-2xl font-semibold text-red-400 mb-6 border-b-2 border-red-500 pb-2 flex items-center">
            <Users2Icon size={28} className="mr-2" /> Puntuación de "Mi Equipo F1"
        </h2>
        <div className="text-gray-300 space-y-3">
            <p>La puntuación de tu equipo F1 se calcula basándose en el rendimiento real (en cada Gran Premio y Carrera Sprint) de los pilotos y escuderías que hayas seleccionado.</p>
            
            <h4 className="text-lg font-semibold text-red-300 mt-3">Puntos de Pilotos (por cada piloto de tu equipo):</h4>
            <ul className="list-disc list-inside space-y-1 pl-4">
                <li><span className="font-semibold text-white">Carrera Principal:</span> Cada piloto suma puntos según su posición final en la carrera, basado en el sistema de puntuación oficial de la FIA:
                    <ul className="list-circle list-inside pl-6 text-sm">
                        {Object.entries(F1_POINTS_SYSTEM).map(([pos, pts]) => (
                            <li key={pos}>Puesto {pos}: <span className="text-yellow-300">{pts}</span> puntos</li>
                        ))}
                    </ul>
                </li>
                <li><span className="font-semibold text-white">Vuelta Rápida (Carrera Principal):</span> Si un piloto de tu equipo logra la vuelta rápida Y termina entre los 10 primeros, suma <span className="text-yellow-300">{FASTEST_LAP_POINT_BONUS}</span> punto adicional.</li>
                 <li><span className="font-semibold text-white">Carrera Sprint (si aplica):</span> Cada piloto suma puntos según su posición final en la Carrera Sprint, basado en el sistema de puntuación oficial de la FIA para Sprints:
                    <ul className="list-circle list-inside pl-6 text-sm">
                         {Object.entries(F1_SPRINT_POINTS_SYSTEM).map(([pos, pts]) => (
                            <li key={pos}>Puesto {pos} (Sprint): <span className="text-yellow-300">{pts}</span> puntos</li>
                        ))}
                    </ul>
                </li>
            </ul>

            <h4 className="text-lg font-semibold text-red-300 mt-3">Puntos de Escuderías (por cada escudería de tu equipo):</h4>
             <ul className="list-disc list-inside space-y-1 pl-4">
                <li><span className="font-semibold text-white">Carrera Principal:</span> Cada escudería seleccionada suma el total de puntos obtenidos por sus dos pilotos oficiales en la carrera principal (según el sistema FIA).</li>
                <li><span className="font-semibold text-white">Carrera Sprint (si aplica):</span> Cada escudería seleccionada suma el total de puntos obtenidos por sus dos pilotos oficiales en la Carrera Sprint (según el sistema FIA para Sprints).</li>
            </ul>
            <p className="text-yellow-400 text-sm mt-3">
                <HelpCircle size={16} className="inline mr-1" /> Los puntos de "Mi Equipo F1" se calculan después de cada evento (GP y Sprint) y se suman a tu total general en la tabla `user_scores` bajo la categoría `score_team`.
            </p>
        </div>
      </section>

      <section className="bg-gray-800 p-6 sm:p-8 rounded-xl shadow-2xl mb-12">
        <h2 className="text-2xl font-semibold text-red-400 mb-6 border-b-2 border-red-500 pb-2 flex items-center">
            <Puzzle size={28} className="mr-2" /> Puntuación de "Adivina el Piloto"
        </h2>
        <div className="text-gray-300 space-y-3">
            <p>Pon a prueba tu conocimiento sobre los pilotos de F1 y suma puntos adicionales.</p>
            <ul className="list-disc list-inside space-y-2 pl-4">
                <li><span className="font-semibold text-white">Objetivo:</span> Adivinar el apellido de un piloto de F1 actual en un máximo de 5 intentos por partida.</li>
                <li><span className="font-semibold text-white">Partidas Diarias:</span> Puedes jugar hasta 3 partidas de "Adivina el Piloto" cada día. Las partidas se reinician diariamente (a medianoche UTC).</li>
                <li><span className="font-semibold text-white">Puntos por Acierto:</span> Cada partida ganada (apellido adivinado correctamente) otorga <span className="text-yellow-400 font-bold">10 puntos</span>.</li>
                <li>
                    <span className="font-semibold text-white">Bonus por Pleno Diario:</span> Si ganas las 3 partidas en un mismo día, recibirás un bonus adicional de <span className="text-yellow-400 font-bold">20 puntos</span>.
                    (Totalizando 10+10+10+20 = 50 puntos por un día perfecto).
                </li>
                <li><span className="font-semibold text-white">Feedback de Letras:</span>
                    <ul className="list- Disc list-inside pl-6 mt-1 text-sm">
                        <li><span className="inline-block w-3 h-3 bg-green-500 rounded-sm align-middle mr-1.5"></span>Letra verde: Correcta y en la posición correcta.</li>
                        <li><span className="inline-block w-3 h-3 bg-yellow-500 rounded-sm align-middle mr-1.5"></span>Letra amarilla: Correcta pero en la posición incorrecta.</li>
                        <li><span className="inline-block w-3 h-3 bg-gray-500 rounded-sm align-middle mr-1.5"></span>Letra gris: No está en el apellido.</li>
                    </ul>
                </li>
            </ul>
             <p className="text-yellow-400 text-sm mt-3">
                <HelpCircle size={16} className="inline mr-1" /> Los puntos obtenidos en "Adivina el Piloto" se suman a tu puntuación general en la tabla `user_scores` bajo la categoría `score_guess_the_pilot` para la fecha en que se jugó.
            </p>
        </div>
      </section>

      <section className="mt-12 text-center text-gray-400 text-sm">
        <h3 className="text-xl font-semibold text-red-400 mb-3">Consideraciones Generales</h3>
        <ul className="list-disc list-inside inline-block text-left space-y-1">
            <li>Las predicciones deben realizarse antes de la hora límite indicada para cada sesión (usualmente antes del inicio de la Clasificación).</li>
            <li>Los resultados oficiales de la FIA (Federación Internacional del Automóvil) se utilizan para validar las predicciones y otorgar puntos.</li>
            <li>En caso de penalizaciones post-carrera que alteren los resultados, se tomarán los resultados finales sancionados por la FIA para el cálculo de puntos.</li>
            <li>La administración se reserva el derecho de ajustar las reglas si es necesario, notificando a los usuarios con antelación.</li>
        </ul>
         <p className="mt-6">¡Diviértete y que gane el mejor predictor!</p>
      </section>
    </div>
  );
};

export default RulesPage;
