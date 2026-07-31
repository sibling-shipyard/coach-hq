import type { RepoData } from "@/hooks/useRepoData";
import type { SportAnalyticsNavLink } from "@/components/home-warm/snapshots";

export interface PluginsConfig {
  enabled: string[];
}

export function parsePlugins(raw: unknown): PluginsConfig {
  if (raw && typeof raw === "object" && Array.isArray((raw as PluginsConfig).enabled)) {
    return { enabled: (raw as PluginsConfig).enabled.map(String) };
  }
  return { enabled: [] };
}

export function isBadmintonAnalyticsAvailable(data: RepoData | null | undefined): boolean {
  if (!data) return false;
  if (data.badminton_analytics_available === true) return true;
  return parsePlugins(data.plugins).enabled.includes("badminton");
}

export function filterSportAnalyticsLinks(
  links: SportAnalyticsNavLink[],
  data: RepoData | null | undefined,
): SportAnalyticsNavLink[] {
  return links.filter((link) => {
    if (link.glyph === "badminton") {
      return isBadmintonAnalyticsAvailable(data);
    }
    return true;
  });
}
