import categoriesJson from "@/data/categories.json";

export interface CategoryRule {
  duration_lt?: number;
  duration_gte?: number;
  weekday?: string;  // "Mon", "Tue", etc.
}

export interface CategoryEntry {
  code: string;
  label: string;
  rule?: CategoryRule;
}

export interface SportConfig {
  sport: string;
  categories: CategoryEntry[];
}

export type CategoryConfigObject = Record<string, Record<string, { label: string; rule?: CategoryRule }>>;
export type CategoryConfigInput = SportConfig[] | CategoryConfigObject;

export function resolveCategory(
  sportType: string,
  elapsedTime: number,
  startDateLocal: string,
  config: CategoryConfigInput
): string {
  const d = new Date(startDateLocal.replace(/Z$/, ""));
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = days[d.getDay()];

  if (Array.isArray(config)) {
    const sportConfig = config.find(c => c.sport === sportType);
    if (!sportConfig) {
      return sportType.substring(0, 3).toUpperCase();
    }
    
    for (const entry of sportConfig.categories) {
      if (!entry.rule) return entry.code;
      
      let pass = true;
      if (entry.rule.duration_lt !== undefined && elapsedTime >= entry.rule.duration_lt) {
        pass = false;
      }
      if (entry.rule.duration_gte !== undefined && elapsedTime < entry.rule.duration_gte) {
        pass = false;
      }
      if (entry.rule.weekday !== undefined && entry.rule.weekday !== weekday) {
        pass = false;
      }
      
      if (pass) return entry.code;
    }
    
    return sportConfig.categories[0].code;
  }

  const sportMap = config[sportType];
  if (!sportMap || Object.keys(sportMap).length === 0) {
    return sportType.substring(0, 3).toUpperCase();
  }

  const codes = Object.keys(sportMap);
  for (const [code, info] of Object.entries(sportMap)) {
    if (!info.rule) return code;
    let pass = true;
    if (info.rule.duration_lt !== undefined && elapsedTime >= info.rule.duration_lt) {
      pass = false;
    }
    if (info.rule.duration_gte !== undefined && elapsedTime < info.rule.duration_gte) {
      pass = false;
    }
    if (info.rule.weekday !== undefined && info.rule.weekday !== weekday) {
      pass = false;
    }
    if (pass) return code;
  }

  return codes[0];
}

export function buildCategoryLookup(config: CategoryConfigInput): Record<string, { label: string; sport: string }> {
  const lookup: Record<string, { label: string; sport: string }> = {};

  if (Array.isArray(config)) {
    for (const sport of config) {
      for (const cat of sport.categories) {
        lookup[cat.code] = { label: cat.label, sport: sport.sport };
      }
    }
    return lookup;
  }

  for (const [sport, categories] of Object.entries(config)) {
    for (const [code, info] of Object.entries(categories)) {
      lookup[code] = { label: info.label, sport };
    }
  }

  return lookup;
}

let activeCategoryConfig: CategoryConfigInput | undefined = undefined;

export function setGlobalCategoryConfig(config?: CategoryConfigInput) {
  activeCategoryConfig = config;
}

export function getGlobalCategoryConfig(): CategoryConfigInput | undefined {
  return activeCategoryConfig;
}

const defaultCategoryLookup = buildCategoryLookup(categoriesJson as CategoryConfigInput);

/**
 * Derives the sport / discipline identifier (e.g. "badminton", "run", "calisthenics", "foundation", "cycling", "recovery", etc.)
 * for a given category code or category string using the category lookup config.
 */
export function getSportForCategory(category: string, config?: CategoryConfigInput): string {
  const cat = (category || "").trim();
  if (!cat) return "other";

  const effectiveConfig = config ?? activeCategoryConfig;
  const lookup = effectiveConfig ? buildCategoryLookup(effectiveConfig) : defaultCategoryLookup;
  
  // Direct code lookup (exact match or uppercase match)
  const entry = lookup[cat] || lookup[cat.toUpperCase()];
  if (entry) {
    const labelLower = (entry.label || "").toLowerCase();
    if (labelLower === "foundation") return "foundation";
    if (labelLower === "calisthenics") return "calisthenics";
    if (labelLower === "realign" || labelLower === "recovery") return "recovery";

    const sportLower = (entry.sport || "").toLowerCase();
    if (sportLower === "ride" || sportLower === "cycling" || sportLower === "bike") return "cycling";
    if (sportLower === "yoga") return "recovery";
    if (sportLower === "weighttraining" || sportLower === "weight_training" || sportLower === "strength") {
      return labelLower.includes("strength") ? "strength" : "weight_training";
    }
    if (["badminton", "run", "calisthenics", "foundation", "recovery", "hike", "walk", "cricket", "football", "workout", "swim"].includes(sportLower)) {
      return sportLower;
    }
  }

  // Fallback pattern / name matching for full category strings or direct sport names
  const lower = cat.toLowerCase();
  if (lower.startsWith("badminton")) return "badminton";
  if (lower === "calisthenics" || lower === "calisthenic") return "calisthenics";
  if (lower === "ride" || lower === "cycling" || lower === "bike") return "cycling";
  if (lower === "foundation") return "foundation";
  if (lower === "recovery" || lower === "realign" || lower === "mobility") return "recovery";
  if (lower === "run" || lower === "running") return "run";
  if (lower === "strength") return "strength";
  if (lower === "weight_training" || lower === "weights" || lower === "weighttraining") return "weight_training";
  if (lower === "hike") return "hike";
  if (lower === "walk") return "walk";
  if (lower === "cricket") return "cricket";
  if (lower === "football") return "football";
  if (lower === "workout") return "workout";
  if (lower === "swim") return "swim";

  return "other";
}

