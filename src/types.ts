export interface Zone {
  id: string;
  name: string;
  name_fr?: string;
  borough?: string;
  region: string;
  province: string;
  country: string;
  lat?: number;
  lng?: number;
  housing_density?: number;
  restaurant_density?: number;
  green_space_pct?: number;
  avg_building_age?: number;
}

export interface RiskScore {
  id: string;
  zone_id: string;
  pest_type: string;
  score: number;
  trend: string;
  confidence: number;
  risk_drivers: Record<string, unknown>;
  week_start: string;
}

export interface ZoneWithScores extends Zone {
  scores: RiskScore[];
}

export interface PaginatedResponse<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}
