export const SUPABASE_URL = "https://kyyolzbvojrydtbprphg.supabase.co";
export const CHARACTER_LIMIT = 25000;

export const PEST_TYPES = [
  "rodents",
  "mosquitoes",
  "cockroaches",
  "bedbugs",
  "carpenter_ants",
  "raccoons",
  "squirrels",
  "skunks",
  "bats",
  "groundhogs",
  "opossums",
  "wasps",
  "termites",
  "fire_ants",
  "scorpions",
] as const;

export type PestType = typeof PEST_TYPES[number];

export const TREND_VALUES = ["rising", "falling", "stable"] as const;
export type Trend = typeof TREND_VALUES[number];
