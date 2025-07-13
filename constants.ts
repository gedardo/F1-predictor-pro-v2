

import { F1Team, F1Driver, F1Race, ScoringRule, DriverStanding, ConstructorStanding, UserF1Team } from './types';

export const APP_NAME = "F1 Predictor Pro";

export const MOCK_API_KEY = "mock-gemini-api-key"; // Placeholder

export const F1_TEAMS_2025: F1Team[] = [
  { id: 'mercedes', name: 'Mercedes-AMG Petronas', color: 'bg-teal-500', logoUrl: 'https://picsum.photos/seed/mercedes/40/40' },
  { id: 'redbull', name: 'Oracle Red Bull Racing', color: 'bg-indigo-700', logoUrl: 'https://picsum.photos/seed/redbull/40/40' },
  { id: 'ferrari', name: 'Scuderia Ferrari', color: 'bg-red-600', logoUrl: 'https://picsum.photos/seed/ferrari/40/40' },
  { id: 'mclaren', name: 'McLaren Formula 1 Team', color: 'bg-orange-500', logoUrl: 'https://picsum.photos/seed/mclaren/40/40' },
  { id: 'astonmartin', name: 'Aston Martin Aramco', color: 'bg-green-600', logoUrl: 'https://picsum.photos/seed/astonmartin/40/40' },
  { id: 'alpine', name: 'BWT Alpine F1 Team', color: 'bg-pink-500', logoUrl: 'https://picsum.photos/seed/alpine/40/40' },
  { id: 'haas', name: 'MoneyGram Haas F1 Team', color: 'bg-gray-400', logoUrl: 'https://picsum.photos/seed/haas/40/40' },
  { id: 'rb', name: 'Visa Cash App RB', color: 'bg-blue-500', logoUrl: 'https://picsum.photos/seed/rb/40/40' },
  { id: 'sauber', name: 'Stake F1 Team Kick Sauber', color: 'bg-lime-500', logoUrl: 'https://picsum.photos/seed/sauber/40/40' },
  { id: 'williams', name: 'Williams Racing', color: 'bg-sky-600', logoUrl: 'https://picsum.photos/seed/williams/40/40' },
];

export const F1_DRIVERS_2025: F1Driver[] = [
  // Mercedes
  { id: 'russell', name: 'George Russell', teamId: 'mercedes', number: 63, nationality: 'British', headshotUrl: 'https://picsum.photos/seed/russell/80/80' },
  { id: 'antonelli', name: 'Andrea Kimi Antonelli', teamId: 'mercedes', number: 12, nationality: 'Italian', headshotUrl: 'https://picsum.photos/seed/antonelli/80/80' },

  // Red Bull Racing
  { id: 'verstappen', name: 'Max Verstappen', teamId: 'redbull', number: 1, nationality: 'Dutch', headshotUrl: 'https://picsum.photos/seed/verstappen/80/80' },
  { id: 'tsunoda', name: 'Yuki Tsunoda', teamId: 'redbull', number: 22, nationality: 'Japanese', headshotUrl: 'https://picsum.photos/seed/tsunoda/80/80' },

  // Ferrari
  { id: 'leclerc', name: 'Charles Leclerc', teamId: 'ferrari', number: 16, nationality: 'Monegasque', headshotUrl: 'https://picsum.photos/seed/leclerc/80/80' },
  { id: 'hamilton', name: 'Lewis Hamilton', teamId: 'ferrari', number: 44, nationality: 'British', headshotUrl: 'https://picsum.photos/seed/hamilton/80/80' },

  // McLaren
  { id: 'norris', name: 'Lando Norris', teamId: 'mclaren', number: 4, nationality: 'British', headshotUrl: 'https://picsum.photos/seed/norris/80/80' },
  { id: 'piastri', name: 'Oscar Piastri', teamId: 'mclaren', number: 81, nationality: 'Australian', headshotUrl: 'https://picsum.photos/seed/piastri/80/80' },

  // Aston Martin
  { id: 'alonso', name: 'Fernando Alonso', teamId: 'astonmartin', number: 14, nationality: 'Spanish', headshotUrl: 'https://picsum.photos/seed/alonso/80/80' },
  { id: 'stroll', name: 'Lance Stroll', teamId: 'astonmartin', number: 18, nationality: 'Canadian', headshotUrl: 'https://picsum.photos/seed/stroll/80/80' },

  // Alpine
  { id: 'gasly', name: 'Pierre Gasly', teamId: 'alpine', number: 10, nationality: 'French', headshotUrl: 'https://picsum.photos/seed/gasly/80/80' },
  { id: 'colapinto', name: 'Franco Colapinto', teamId: 'alpine', number: 43, nationality: 'Argentine', headshotUrl: 'https://picsum.photos/seed/colapinto/80/80' },

  // Sauber (Stake F1 Team Kick Sauber)
  { id: 'hulkenberg', name: 'Nico Hülkenberg', teamId: 'sauber', number: 27, nationality: 'German', headshotUrl: 'https://picsum.photos/seed/hulkenberg/80/80' },
  { id: 'bortoleto', name: 'Gabriel Bortoleto', teamId: 'sauber', number: 85, nationality: 'Brazilian', headshotUrl: 'https://picsum.photos/seed/bortoleto/80/80' },

  // RB (Visa Cash App RB F1 Team)
  { id: 'lawson', name: 'Liam Lawson', teamId: 'rb', number: 40, nationality: 'New Zealander', headshotUrl: 'https://picsum.photos/seed/lawson/80/80' },
  { id: 'hadjar', name: 'Isack Hadjar', teamId: 'rb', number: 6, nationality: 'French', headshotUrl: 'https://picsum.photos/seed/hadjar/80/80' }, // Corrected Hadjar's image URL.

  // Williams
  { id: 'albon', name: 'Alexander Albon', teamId: 'williams', number: 23, nationality: 'Thai', headshotUrl: 'https://picsum.photos/seed/albon/80/80' },
  { id: 'sainz', name: 'Carlos Sainz Jr.', teamId: 'williams', number: 55, nationality: 'Spanish', headshotUrl: 'https://picsum.photos/seed/sainz/80/80' },

  // Haas
  { id: 'bearman', name: 'Oliver Bearman', teamId: 'haas', number: 50, nationality: 'British', headshotUrl: 'https://picsum.photos/seed/bearman/80/80' },
  { id: 'ocon', name: 'Esteban Ocon', teamId: 'haas', number: 31, nationality: 'French', headshotUrl: 'https://picsum.photos/seed/ocon/80/80' },
];

export const F1_CALENDAR_2025: F1Race[] = [
  {
    id: 'australia',
    round: 1,
    name: 'GP de Australia',
    circuit: 'Albert Park Circuit',
    country: 'Australia',
    date: '2025-03-16',
    sessions: { 
      practice1: '2025-03-14T01:30Z',
      practice2: '2025-03-14T05:00Z',
      practice3: '2025-03-15T01:30Z',
      qualifying: '2025-03-15T05:00Z',
      race: '2025-03-16T04:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/australia_map/300/200',
    laps: 58,
    length: '5.278 km',
    mockPodium: { first: 'norris', second: 'verstappen', third: 'russell' }
  },
  {
    id: 'china',
    round: 2,
    name: 'GP de China',
    circuit: 'Shanghai International Circuit',
    country: 'China',
    date: '2025-03-23', 
    sessions: {
      practice1: '2025-03-21T02:30Z',
      practice2: '2025-03-21T03:30Z', 
      sprintQualifying: '2025-03-21T06:30Z',
      sprint: '2025-03-22T03:00Z',
      qualifying: '2025-03-22T07:00Z',
      race: '2025-03-23T07:00Z'
    },
    isSprintWeekend: true,
    mapUrl: 'https://picsum.photos/seed/china_map/300/200',
    laps: 56,
    length: '5.451 km',
    mockPodium: { first: 'piastri', second: 'norris', third: 'russell' } 
  },
  {
    id: 'japan',
    round: 3,
    name: 'GP de Japón',
    circuit: 'Suzuka International Racing Course',
    country: 'Japón',
    date: '2025-04-06',
    sessions: { 
      practice1: '2025-04-04T02:30Z',
      practice2: '2025-04-04T06:00Z',
      practice3: '2025-04-05T02:30Z',
      qualifying: '2025-04-05T06:00Z',
      race: '2025-04-06T05:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/japan_map/300/200',
    laps: 53,
    length: '5.807 km',
    mockPodium: { first: 'verstappen', second: 'norris', third: 'piastri' }
  },
  {
    id: 'bahrain',
    round: 4,
    name: 'GP de Bahréin',
    circuit: 'Bahrain International Circuit',
    country: 'Bahréin',
    date: '2025-04-13',
    sessions: { 
      practice1: '2025-04-11T11:30Z',
      practice2: '2025-04-11T15:00Z',
      practice3: '2025-04-12T12:30Z',
      qualifying: '2025-04-12T16:00Z',
      race: '2025-04-13T15:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/bahrain_map/300/200',
    laps: 57,
    length: '5.412 km',
    mockPodium: { first: 'piastri', second: 'russell', third: 'norris' }
  },
  {
    id: 'saudi_arabia',
    round: 5,
    name: 'GP de Arabia Saudita',
    circuit: 'Jeddah Street Circuit',
    country: 'Arabia Saudita',
    date: '2025-04-20',
    sessions: { 
      practice1: '2025-04-18T13:30Z',
      practice2: '2025-04-18T17:00Z',
      practice3: '2025-04-19T13:30Z',
      qualifying: '2025-04-19T17:00Z',
      race: '2025-04-20T17:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/saudi_arabia_map/300/200',
    laps: 50,
    length: '6.174 km',
    mockPodium: { first: 'piastri', second: 'verstappen', third: 'leclerc' }
  },
  {
    id: 'miami',
    round: 6,
    name: 'GP de Miami',
    circuit: 'Miami International Autodrome',
    country: 'EE. UU.',
    date: '2025-05-04', 
    sessions: {
      practice1: '2025-05-02T16:30Z',
      practice2: '2025-05-02T17:30Z', 
      sprintQualifying: '2025-05-02T20:30Z',
      sprint: '2025-05-03T16:00Z',
      qualifying: '2025-05-03T20:00Z', 
      race: '2025-05-04T20:00Z'
    },
    isSprintWeekend: true,
    mapUrl: 'https://picsum.photos/seed/miami_map/300/200',
    laps: 57,
    length: '5.412 km', 
    mockPodium: { first: 'piastri', second: 'norris', third: 'russell' }
  },
  {
    id: 'emilia_romagna',
    round: 7,
    name: 'GP de Emilia-Romaña',
    circuit: 'Autodromo Enzo e Dino Ferrari',
    country: 'Italia',
    date: '2025-05-18',
    sessions: { 
      practice1: '2025-05-16T11:30Z',
      practice2: '2025-05-16T15:00Z',
      practice3: '2025-05-17T10:30Z',
      qualifying: '2025-05-17T14:00Z',
      race: '2025-05-18T13:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/emilia_romagna_map/300/200',
    laps: 63,
    length: '4.909 km',
    mockPodium: { first: 'verstappen', second: 'norris', third: 'piastri' }
  },
  {
    id: 'monaco',
    round: 8,
    name: 'GP de Mónaco',
    circuit: 'Circuit de Monaco',
    country: 'Mónaco',
    date: '2025-05-25',
    sessions: { 
      practice1: '2025-05-23T11:30Z',
      practice2: '2025-05-23T15:00Z',
      practice3: '2025-05-24T10:30Z',
      qualifying: '2025-05-24T14:00Z',
      race: '2025-05-25T13:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/monaco_map/300/200',
    laps: 78,
    length: '3.337 km',
    mockPodium: { first: 'norris', second: 'leclerc', third: 'piastri' }
  },
  // Future races from here - no mockPodium data needed if actual results will be entered
  {
    id: 'spain',
    round: 9,
    name: 'GP de España',
    circuit: 'Circuit de Barcelona-Catalunya',
    country: 'España',
    date: '2025-06-01',
    sessions: { 
      practice1: '2025-05-30T11:30Z', 
      practice2: '2025-05-30T15:00Z', 
      practice3: '2025-05-31T10:30Z', 
      qualifying: '2025-05-31T14:00Z', 
      race: '2025-06-01T13:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/spain_map/300/200',
    laps: 66, 
    length: '4.657 km' 
  },
  {
    id: 'canada',
    round: 10,
    name: 'GP de Canadá',
    circuit: 'Circuit Gilles Villeneuve',
    country: 'Canadá',
    date: '2025-06-15',
    sessions: { 
      practice1: '2025-06-13T17:30Z', 
      practice2: '2025-06-13T21:00Z', 
      practice3: '2025-06-14T16:30Z', 
      qualifying: '2025-06-14T20:00Z', 
      race: '2025-06-15T18:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/canada_map/300/200',
    laps: 70, 
    length: '4.361 km' 
  },
  {
    id: 'austria',
    round: 11,
    name: 'GP de Austria',
    circuit: 'Red Bull Ring',
    country: 'Austria',
    date: '2025-06-29',
    sessions: { 
      practice1: '2025-06-27T11:30Z',
      practice2: '2025-06-27T15:00Z',
      practice3: '2025-06-28T10:30Z',
      qualifying: '2025-06-28T14:00Z',
      race: '2025-06-29T13:00Z'
    },
    isSprintWeekend: false, 
    mapUrl: 'https://picsum.photos/seed/austria_map/300/200',
    laps: 71,
    length: '4.318 km'
  },
  {
    id: 'great_britain',
    round: 12,
    name: 'GP de Gran Bretaña',
    circuit: 'Silverstone Circuit',
    country: 'Reino Unido',
    date: '2025-07-06',
    sessions: { 
      practice1: '2025-07-04T12:30Z', 
      practice2: '2025-07-04T16:00Z', 
      practice3: '2025-07-05T11:30Z', 
      qualifying: '2025-07-05T15:00Z', 
      race: '2025-07-06T14:00Z'
    },
    isSprintWeekend: false,
    mapUrl: 'https://picsum.photos/seed/great_britain_map/300/200',
    laps: 52,
    length: '5.891 km'
  },
  {
    id: 'belgium',
    round: 13,
    name: 'GP de Bélgica',
    circuit: 'Circuit de Spa-Francorchamps',
    country: 'Bélgica',
    date: '2025-07-27',
    sessions: { 
      practice1: '2025-07-25T10:30Z',
      practice2: '2025-07-25T11:30Z', 
      sprintQualifying: '2025-07-25T14:30Z',
      sprint: '2025-07-26T10:00Z',
      qualifying: '2025-07-26T14:00Z',
      race: '2025-07-27T13:00Z'
    },
    isSprintWeekend: true,
    mapUrl: 'https://picsum.photos/seed/belgium_map/300/200',
    laps: 44,
    length: '7.004 km'
  },
];

export const SCORING_RULES: ScoringRule[] = [
  { action: 'Pole Position (Clasificación)', points: 10, description: 'Acertar el piloto en la Pole Position.' },
  { action: 'Piloto en Podio (Posición Exacta - Carrera)', points: 25, description: 'Acertar un piloto y su posición exacta en el podio (1º, 2º, o 3º).' },
  { action: 'Piloto en Podio (Posición Incorrecta - Carrera)', points: 10, description: 'Acertar un piloto que termina en el podio, pero en una posición diferente a la predicha.' },
  { action: 'Piloto en Top 10 (Posición Exacta - Carrera)', points: 5, description: 'Acertar un piloto y su posición exacta entre el 4º y 10º puesto.' },
  { action: 'Piloto en Top 10 (Posición Incorrecta dentro del Top 10 - Carrera)', points: 2, description: 'Acertar un piloto que termina en el Top 10, pero en una posición diferente a la predicha.' },
  { action: 'Vuelta Rápida (Carrera)', points: 10, description: 'Acertar el piloto que logra la vuelta rápida.' },
  { action: 'Piloto del Día (Carrera)', points: 8, description: 'Acertar el Piloto del Día.' },
  { action: 'Ganador Sprint (Exacto)', points: 15, description: 'Acertar el ganador de la Carrera Sprint.' },
  { action: 'Podio Sprint (Posición Exacta)', points: 8, description: 'Acertar un piloto y su posición exacta en el podio del Sprint.' },
  { action: 'Predicción Perfecta de Carrera (Top 10 + VR + PDD)', points: 100, description: 'Bonus por acertar el Top 10 en orden exacto, la Vuelta Rápida y el Piloto del Día.' },
];

export const MOCK_DRIVER_STANDINGS: DriverStanding[] = [
  { position: 1, driverId: 'piastri', points: 161 },
  { position: 2, driverId: 'norris', points: 158 },
  { position: 3, driverId: 'verstappen', points: 136 },
  { position: 4, driverId: 'russell', points: 99 },
  { position: 5, driverId: 'leclerc', points: 79 },
  { position: 6, driverId: 'hamilton', points: 63 },
  { position: 7, driverId: 'antonelli', points: 48 },
  { position: 8, driverId: 'albon', points: 42 },
  { position: 9, driverId: 'ocon', points: 20 },
  { position: 10, driverId: 'hadjar', points: 15 }, 
  { position: 11, driverId: 'stroll', points: 14 },
  { position: 12, driverId: 'sainz', points: 12 },
  { position: 13, driverId: 'tsunoda', points: 10 },
  { position: 14, driverId: 'gasly', points: 7 },
  { position: 15, driverId: 'hulkenberg', points: 6 },
  { position: 16, driverId: 'bearman', points: 6 },
  { position: 17, driverId: 'lawson', points: 4 },
  { position: 18, driverId: 'alonso', points: 0 },
  { position: 19, driverId: 'colapinto', points: 0 },
  { position: 20, driverId: 'bortoleto', points: 0 },
];

export const MOCK_CONSTRUCTOR_STANDINGS: ConstructorStanding[] = [
  { position: 1, teamId: 'mclaren', points: 319 },
  { position: 2, teamId: 'mercedes', points: 147 },
  { position: 3, teamId: 'redbull', points: 143 },
  { position: 4, teamId: 'ferrari', points: 142 },
  { position: 5, teamId: 'williams', points: 54 },
  { position: 6, teamId: 'haas', points: 26 },
  { position: 7, teamId: 'rb', points: 22 },        
  { position: 8, teamId: 'astonmartin', points: 14 },
  { position: 9, teamId: 'alpine', points: 7 },
  { position: 10, teamId: 'sauber', points: 6 },     
];

export const DEFAULT_USER_F1_TEAM: UserF1Team = {
  drivers: [null, null, null, null],
  constructors: [null, null],
  changesRemaining: 5, // Example initial changes
};

export const MAX_DRIVERS_TEAM = 4;
export const MAX_CONSTRUCTORS_TEAM = 2;

export const PREDICTION_CLOSE_HOURS_BEFORE = 1; // Predictions close 1 hour before session
