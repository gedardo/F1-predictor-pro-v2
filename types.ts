// import { Timestamp } from 'firebase/firestore'; // No longer needed

// User profile type, now reflecting Supabase perfiles_usuarios table
export interface User {
  id: string; // UUID from auth.users and perfiles_usuarios.id
  email: string; // From perfiles_usuarios.email (synced with auth.users.email)
  nickname: string; // From perfiles_usuarios.nickname
  createdAt: string; // ISO string date from perfiles_usuarios.fecha_creacion
  avatarUrl?: string | null; // From perfiles_usuarios.avatar_url
  guessGamePlaysToday?: number; // Number of times "Guess the Driver" game played today
  guessGameWinsToday?: number;  // Number of wins in "Guess the Driver" game today
  guessGameLastPlayDate?: string | null; // Date of last play for "Guess the Driver" game (YYYY-MM-DD)
}

// Basic user profile for displaying names in rankings
export interface UserProfileBasic {
  id: string;
  nickname: string;
  avatarUrl?: string | null;
}

// Represents a row in the new user_scores table
export interface UserScore {
  id: string; // UUID
  user_id: string;
  event_date: string; // DATE "YYYY-MM-DD"
  score_team: number;
  score_predictions: number;
  score_guess_the_pilot: number;
  event_total_score: number; // Calculated by the database
  created_at: string; // TIMESTAMPTZ
}

// Represents a row from the new user_rankings view
export interface UserRanking {
  user_id: string;
  total_overall_score: number;
  rank: number;
}


export interface F1Team {
  id: string; // Corresponds to id_equipo_pred
  name: string; // Corresponds to nombre
  color: string | null;
  logoUrl: string | null;
}

export interface F1Driver {
  id: string; // Corresponds to id_piloto_pred
  name: string; // Corresponds to nombre
  teamId: string | null; // Corresponds to id_equipo_pred
  number: number | null;
  nationality: string | null;
  headshotUrl: string | null; // Corresponds to url_foto
}

export interface RaceSession { 
  practice1: string;
  practice2: string;
  practice3?: string;
  qualifying: string;
  sprintQualifying?: string;
  sprint?: string;
  race: string;
}

export interface F1Race {
  id: string; // Corresponds to id_carrera_pred
  name: string; // Corresponds to nombre
  circuit: string | null;
  country: string | null;
  date: string; // Corresponds to fecha_carrera (YYYY-MM-DD)
  sessions: RaceSession | null; // Parsed from JSONB
  isSprintWeekend: boolean; // Corresponds to es_sprint
  round: number | null;
  mapUrl: string | null; // Corresponds to url_mapa_circuito
  laps: number | null;
  length: string | null; // Corresponds to longitud_km
  
  // Fields for actual results, populated by admin
  polePositionRealPilotId?: string | null; 
  raceTop10Real?: (string | null)[] | null; 
  fastestLapRealPilotId?: string | null; 
  driverOfTheDayRealPilotId?: string | null;

  // Mock/placeholder podium from constants, for races without actual results yet
  mockPodium?: { first: string; second: string; third: string } | null; 
}

// User's fantasy F1 team selection, matches usuarios_f1_equipos_seleccion
export interface UserF1Team {
  drivers: (string | null)[]; 
  constructors: (string | null)[]; 
  changesRemaining: number; 
}

// User's prediction for a race, matches usuarios_predicciones
export interface Prediction {
  raceId: string; 
  qualifyingTop3: (string | null)[]; 
  sprintTop3?: (string | null)[] | null; 
  raceTop10: (string | null)[]; 
  fastestLap: string | null; 
  driverOfTheDay: string | null; 
}


export interface DriverStanding { 
  position: number;
  driverId: string;
  points: number;
}

export interface ConstructorStanding { 
  position: number;
  teamId: string;
  points: number;
}

export interface NewsArticle { 
  title: string;
  url?: string;
  source?: string;
  publishedAt?: string;
}

export interface ScoringRule { 
  action: string;
  points: number;
  description?: string;
}

export enum AppRoute {
  Home = '/',
  Auth = '/auth',
  MyTeam = '/my-team',
  Standings = '/standings',
  Calendar = '/calendar',
  Prediction = '/predict',
  Rules = '/rules',
  Profile = '/profile',
  DriverGuessGame = '/driver-guess',
  AdminRaceResults = '/admin/race-results'
}

export type LetterState = 'correct' | 'present' | 'absent' | 'neutral' | 'empty';

export interface GameLetter {
    char: string;
    state: LetterState;
}
// Standard F1 points for race finishes (Top 10)
export const F1_POINTS_SYSTEM: Record<number, number> = {
    1: 25,
    2: 18,
    3: 15,
    4: 12,
    5: 10,
    6: 8,
    7: 6,
    8: 4,
    9: 2,
    10: 1,
};
export const FASTEST_LAP_POINT_BONUS = 1; // If driver is in Top 10

// Standard F1 points for sprint race finishes (Top 8)
export const F1_SPRINT_POINTS_SYSTEM: Record<number, number> = {
    1: 8,
    2: 7,
    3: 6,
    4: 5,
    5: 4,
    6: 3,
    7: 2,
    8: 1,
};
