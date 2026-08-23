# 0028 — Heart-rate zone boundaries and colours have separate owners

- **Status:** Accepted · 2026-08-23 · Tech Lead
- **Area:** cross-cutting (iOS sync, pipeline, web + WidgetKit)
- **Context:** Heart-rate zone boundaries and display colours were copied across Python, Node, iOS and web code. A device-only boundary edit could not reach Coach or survive a reinstall, while four colour ramps rendered the same zones differently.
- **Decision:** Store each athlete's four inclusive zone uppers in `user_data/health/zones.json`. Store the ordered five-colour ramp and names in `shared/warm-instrument/tokens.json`. Missing or invalid boundary files use today's defaults; historical activity zone seconds and stored edges are never rewritten.
- **Why:** Physiology varies by athlete and belongs in the athlete repo. Product design is shared and already has a checked token pipeline feeding web, iOS and widgets. The fallback keeps old and partially upgraded repos safe.
- **Rejected:** Soul or coach profile storage, because neither is a shared machine-readable contract. Per-sport boundaries, because no automatic source maintains them. A generated boundary fixture, because absence deliberately selects the default.
