import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabaseQuery } from "../services/supabase.js";
import { PEST_TYPES, CHARACTER_LIMIT } from "../constants.js";
import type { Zone, RiskScore } from "../types.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const PestTypeSchema = z.enum([...PEST_TYPES] as [string, ...string[]]);

function trendEmoji(trend: string): string {
  if (trend === "rising") return "↑";
  if (trend === "falling") return "↓";
  return "→";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MODERATE";
  if (score >= 20) return "LOW";
  return "MINIMAL";
}

export function registerRiskScoreTools(server: McpServer): void {
  // ── Get Zone Scores ───────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_get_zone_scores",
    {
      title: "Get Zone Risk Scores",
      description: `Get the current weekly pest risk scores for a specific zone.

Returns scores for all 15 pest types (or a single pest type if specified) for the most recent week. Scores range from 0–100. Trend indicates direction vs. prior week.

Pest types: rodents, mosquitoes, cockroaches, bedbugs, carpenter_ants, raccoons, squirrels, skunks, bats, groundhogs, opossums, wasps, termites, fire_ants, scorpions

Args:
  - zone_id (string): The UUID of the zone (use pestsentinel_search_zones to find it)
  - pest_type (string, optional): Filter to a single pest type
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Current risk scores with trend, confidence, and risk drivers for the zone.

Examples:
  - "What's the rodent risk in downtown Chicago?" → first search for zone, then get scores with pest_type='rodents'
  - "Show all pest scores for Miami Beach zone" → zone_id='<uuid>'`,
      inputSchema: z.object({
        zone_id: z.string().uuid()
          .describe("Zone UUID (use pestsentinel_search_zones to find zone IDs)"),
        pest_type: PestTypeSchema.optional()
          .describe("Optional: filter to one pest type"),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
          .describe("Output format: 'markdown' or 'json'"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ zone_id, pest_type, response_format }) => {
      try {
        const [zones, latestWeekArr] = await Promise.all([
          supabaseQuery<Zone>("pi_zones", {
            select: "id,name,region,province,country",
            id: `eq.${zone_id}`,
            limit: "1",
          }),
          supabaseQuery<{ week_start: string }>("pi_risk_scores", {
            select: "week_start",
            order: "week_start.desc",
            limit: "1",
          }),
        ]);

        if (!zones.length) {
          return {
            content: [{
              type: "text" as const,
              text: `Zone '${zone_id}' not found. Use pestsentinel_search_zones to find valid zone IDs.`,
            }],
          };
        }

        const zone = zones[0];
        const latestWeek = latestWeekArr[0]?.week_start;
        if (!latestWeek) {
          return {
            content: [{ type: "text" as const, text: "No risk score data available yet." }],
          };
        }

        const scoreParams: Record<string, string> = {
          select: "pest_type,score,trend,confidence,risk_drivers,week_start",
          zone_id: `eq.${zone_id}`,
          week_start: `eq.${latestWeek}`,
          order: "score.desc",
        };
        if (pest_type) scoreParams["pest_type"] = `eq.${pest_type}`;

        const scores = await supabaseQuery<RiskScore>("pi_risk_scores", scoreParams);

        if (!scores.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No scores found for zone '${zone.name}'${pest_type ? ` / ${pest_type}` : ""} for week ${latestWeek}.`,
            }],
          };
        }

        const output = {
          zone: { id: zone_id, name: zone.name, region: zone.region, province: zone.province, country: zone.country },
          week: latestWeek,
          scores: scores.map((s) => ({
            pest_type: s.pest_type,
            score: s.score,
            level: scoreLabel(s.score),
            trend: s.trend,
            confidence: s.confidence,
            risk_drivers: s.risk_drivers,
          })),
        };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Pest Risk Scores — ${zone.name}, ${zone.region}, ${zone.province}`,
            `**Week of:** ${latestWeek}`,
            "",
            "| Pest Type | Score | Level | Trend |",
            "|-----------|-------|-------|-------|",
            ...scores.map((s) =>
              `| ${s.pest_type.replace("_", " ")} | ${s.score}/100 | ${scoreLabel(s.score)} | ${trendEmoji(s.trend)} ${s.trend} |`
            ),
          ];

          const topScore = scores[0];
          if (topScore) {
            lines.push("", `**Highest risk:** ${topScore.pest_type.replace("_", " ")} at ${topScore.score}/100 (${scoreLabel(topScore.score)})`);
          }
          text = lines.join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ── Get Rising Zones ──────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_get_rising_zones",
    {
      title: "Get Rising Pest Zones",
      description: `Get zones with rising pest pressure this week — the most actionable intelligence for pest control operators.

Returns zones where the current week's score is trending upward, sorted by score descending. Use this to find where pest activity is accelerating before it peaks.

Args:
  - pest_type (string, optional): Filter to a specific pest type
  - country (string, optional): Filter by country code 'US' or 'CA'
  - province (string, optional): Filter by state/province (e.g. 'TX', 'FL')
  - min_score (number, optional): Minimum score threshold 0–100 (default: 40)
  - limit (number): Max results, 1–100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Zones with rising trend, sorted by risk score, with zone name and location.

Examples:
  - "Where is mosquito activity rising this week?" → pest_type='mosquitoes'
  - "Rising rodent pressure in Florida?" → pest_type='rodents', province='FL'
  - "What zones should I target this week?" → no filters`,
      inputSchema: z.object({
        pest_type: PestTypeSchema.optional()
          .describe("Filter to one pest type"),
        country: z.string().toUpperCase().optional()
          .describe("Country code: 'US' or 'CA'"),
        province: z.string().toUpperCase().optional()
          .describe("State/province code e.g. 'TX', 'FL', 'ON'"),
        min_score: z.number().int().min(0).max(100).default(40)
          .describe("Minimum risk score threshold (default: 40)"),
        limit: z.number().int().min(1).max(100).default(20)
          .describe("Max results (default: 20)"),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
          .describe("Output format: 'markdown' or 'json'"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ pest_type, country, province, min_score, limit, response_format }) => {
      try {
        const latestWeekArr = await supabaseQuery<{ week_start: string }>("pi_risk_scores", {
          select: "week_start",
          order: "week_start.desc",
          limit: "1",
        });
        const latestWeek = latestWeekArr[0]?.week_start;
        if (!latestWeek) {
          return { content: [{ type: "text" as const, text: "No risk score data available." }] };
        }

        const zoneParams: Record<string, string> = {
          select: "id,name,region,province,country",
        };
        if (country) zoneParams["country"] = `eq.${country}`;
        if (province) zoneParams["province"] = `eq.${province}`;

        const allZones = await supabaseQuery<Zone>("pi_zones", { ...zoneParams, limit: "1000" });
        const zoneMap = new Map(allZones.map((z) => [z.id, z]));
        const zoneIds = allZones.map((z) => z.id);

        if (!zoneIds.length) {
          return { content: [{ type: "text" as const, text: "No zones found for the given region filters." }] };
        }

        const scoreParams: Record<string, string> = {
          select: "zone_id,pest_type,score,trend,confidence,week_start",
          week_start: `eq.${latestWeek}`,
          trend: "eq.rising",
          score: `gte.${min_score}`,
          order: "score.desc",
          limit: String(limit),
          zone_id: `in.(${zoneIds.join(",")})`,
        };
        if (pest_type) scoreParams["pest_type"] = `eq.${pest_type}`;

        const scores = await supabaseQuery<RiskScore & { zone_id: string }>("pi_risk_scores", scoreParams);

        if (!scores.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No rising zones found${pest_type ? ` for ${pest_type}` : ""}${province ? ` in ${province}` : ""}. Try lowering min_score or removing filters.`,
            }],
          };
        }

        const enriched = scores.map((s) => {
          const zone = zoneMap.get(s.zone_id);
          return {
            zone_id: s.zone_id,
            zone_name: zone?.name ?? "Unknown",
            region: zone?.region ?? "",
            province: zone?.province ?? "",
            country: zone?.country ?? "",
            pest_type: s.pest_type,
            score: s.score,
            level: scoreLabel(s.score),
            confidence: s.confidence,
          };
        });

        const output = { week: latestWeek, count: enriched.length, rising_zones: enriched };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Rising Pest Zones — Week of ${latestWeek}`,
            `${pest_type ? `**Pest:** ${pest_type.replace("_", " ")} | ` : ""}${province ? `**Region:** ${province} | ` : ""}${enriched.length} zones rising`,
            "",
            "| Zone | Region | State/Province | Pest | Score | Level |",
            "|------|--------|----------------|------|-------|-------|",
            ...enriched.map((e) =>
              `| ${e.zone_name} | ${e.region} | ${e.province} | ${e.pest_type.replace("_", " ")} | ${e.score}/100 | ${e.level} |`
            ),
          ];
          text = lines.join("\n");
        }

        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + "\n\n_Truncated. Use filters or reduce limit._";
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ── Get Top Zones ─────────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_get_top_zones",
    {
      title: "Get Top Risk Zones",
      description: `Get the highest-scoring pest risk zones this week across any region or pest type.

Use this to identify the most active pest hotspots nationally or regionally. Useful for operators expanding territory, PE firms evaluating markets, or anyone asking "where is pest pressure highest right now?"

Args:
  - pest_type (string, optional): Filter to one pest type
  - country (string, optional): 'US' or 'CA'
  - province (string, optional): State/province code e.g. 'TX', 'CA', 'FL'
  - limit (number): Max results 1–50 (default: 10)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Top-scoring zones with pest type, score, trend, and location.

Examples:
  - "Where is termite risk highest in the US?" → pest_type='termites', country='US'
  - "Top 10 highest pest pressure zones this week" → no filters
  - "Highest rodent risk in Texas?" → pest_type='rodents', province='TX'`,
      inputSchema: z.object({
        pest_type: PestTypeSchema.optional()
          .describe("Filter to one pest type"),
        country: z.string().toUpperCase().optional()
          .describe("Country code: 'US' or 'CA'"),
        province: z.string().toUpperCase().optional()
          .describe("State/province code e.g. 'TX', 'FL', 'ON'"),
        limit: z.number().int().min(1).max(50).default(10)
          .describe("Max results (default: 10)"),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
          .describe("Output format: 'markdown' or 'json'"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ pest_type, country, province, limit, response_format }) => {
      try {
        const latestWeekArr = await supabaseQuery<{ week_start: string }>("pi_risk_scores", {
          select: "week_start",
          order: "week_start.desc",
          limit: "1",
        });
        const latestWeek = latestWeekArr[0]?.week_start;
        if (!latestWeek) {
          return { content: [{ type: "text" as const, text: "No risk score data available." }] };
        }

        const zoneParams: Record<string, string> = { select: "id,name,region,province,country" };
        if (country) zoneParams["country"] = `eq.${country}`;
        if (province) zoneParams["province"] = `eq.${province}`;

        const allZones = await supabaseQuery<Zone>("pi_zones", { ...zoneParams, limit: "1000" });
        const zoneMap = new Map(allZones.map((z) => [z.id, z]));
        const zoneIds = allZones.map((z) => z.id);

        if (!zoneIds.length) {
          return { content: [{ type: "text" as const, text: "No zones found for the given filters." }] };
        }

        const scoreParams: Record<string, string> = {
          select: "zone_id,pest_type,score,trend,confidence,week_start",
          week_start: `eq.${latestWeek}`,
          order: "score.desc",
          limit: String(limit),
          zone_id: `in.(${zoneIds.join(",")})`,
        };
        if (pest_type) scoreParams["pest_type"] = `eq.${pest_type}`;

        const scores = await supabaseQuery<RiskScore & { zone_id: string }>("pi_risk_scores", scoreParams);

        const enriched = scores.map((s) => {
          const zone = zoneMap.get(s.zone_id);
          return {
            zone_id: s.zone_id,
            zone_name: zone?.name ?? "Unknown",
            region: zone?.region ?? "",
            province: zone?.province ?? "",
            country: zone?.country ?? "",
            pest_type: s.pest_type,
            score: s.score,
            level: scoreLabel(s.score),
            trend: s.trend,
            confidence: s.confidence,
          };
        });

        const output = { week: latestWeek, count: enriched.length, top_zones: enriched };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Top Pest Risk Zones — Week of ${latestWeek}`,
            "",
            "| # | Zone | Region | State/Province | Pest | Score | Level | Trend |",
            "|---|------|--------|----------------|------|-------|-------|-------|",
            ...enriched.map((e, i) =>
              `| ${i + 1} | ${e.zone_name} | ${e.region} | ${e.province} | ${e.pest_type.replace("_", " ")} | ${e.score}/100 | ${e.level} | ${trendEmoji(e.trend)} |`
            ),
          ];
          text = lines.join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ── Get Zone History ──────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_get_zone_history",
    {
      title: "Get Zone Risk Score History",
      description: `Get historical weekly risk scores for a zone to see how pest pressure has changed over time.

Returns scores week-by-week going back up to 12 weeks. Useful for identifying seasonal patterns, long-term trends, or evaluating territory before expansion.

Args:
  - zone_id (string): The UUID of the zone
  - pest_type (string, optional): Filter to a single pest type
  - weeks (number): Number of weeks of history to return, 1–12 (default: 6)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Weekly scores with trend and confidence for the requested period.

Examples:
  - "How has mosquito pressure changed in Tampa over the last 6 weeks?" → zone_id + pest_type='mosquitoes'
  - "Show termite history for Houston zone" → zone_id + pest_type='termites'`,
      inputSchema: z.object({
        zone_id: z.string().uuid()
          .describe("Zone UUID (use pestsentinel_search_zones to find zone IDs)"),
        pest_type: PestTypeSchema.optional()
          .describe("Optional: filter to one pest type"),
        weeks: z.number().int().min(1).max(12).default(6)
          .describe("Weeks of history to return (default: 6)"),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
          .describe("Output format: 'markdown' or 'json'"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ zone_id, pest_type, weeks, response_format }) => {
      try {
        const zones = await supabaseQuery<Zone>("pi_zones", {
          select: "id,name,region,province,country",
          id: `eq.${zone_id}`,
          limit: "1",
        });

        if (!zones.length) {
          return {
            content: [{
              type: "text" as const,
              text: `Zone '${zone_id}' not found. Use pestsentinel_search_zones to find valid zone IDs.`,
            }],
          };
        }

        const zone = zones[0];
        const scoreParams: Record<string, string> = {
          select: "pest_type,score,trend,confidence,week_start",
          zone_id: `eq.${zone_id}`,
          order: "week_start.desc,score.desc",
          limit: String(weeks * (pest_type ? 1 : 15)),
        };
        if (pest_type) scoreParams["pest_type"] = `eq.${pest_type}`;

        const scores = await supabaseQuery<RiskScore>("pi_risk_scores", scoreParams);

        if (!scores.length) {
          return {
            content: [{ type: "text" as const, text: `No history found for zone '${zone.name}'.` }],
          };
        }

        const output = {
          zone: { id: zone_id, name: zone.name, region: zone.region, province: zone.province },
          weeks_requested: weeks,
          history: scores.map((s) => ({
            week_start: s.week_start,
            pest_type: s.pest_type,
            score: s.score,
            level: scoreLabel(s.score),
            trend: s.trend,
            confidence: s.confidence,
          })),
        };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Risk History — ${zone.name}, ${zone.region}, ${zone.province}`,
            `**Last ${weeks} weeks**${pest_type ? ` | Pest: ${pest_type.replace("_", " ")}` : ""}`,
            "",
            "| Week | Pest | Score | Level | Trend |",
            "|------|------|-------|-------|-------|",
            ...scores.map((s) =>
              `| ${s.week_start} | ${s.pest_type.replace("_", " ")} | ${s.score}/100 | ${scoreLabel(s.score)} | ${trendEmoji(s.trend)} ${s.trend} |`
            ),
          ];
          text = lines.join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // ── Get Regional Summary ──────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_get_regional_summary",
    {
      title: "Get Regional Pest Risk Summary",
      description: `Get a high-level pest risk summary for an entire state, province, or city — aggregated across all zones in that region.

Returns average and peak scores per pest type, with rising/falling/stable zone counts. Ideal for market analysis, territory planning, and understanding which pests are dominant in a region.

Args:
  - province (string, optional): State/province code e.g. 'TX', 'FL', 'ON'
  - region (string, optional): City/region name e.g. 'Chicago', 'Miami', 'Toronto'
  - country (string, optional): 'US' or 'CA'
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Per-pest aggregated stats: avg score, peak score, zone count, rising/falling breakdown.

Examples:
  - "What's the pest outlook for Florida this week?" → province='FL'
  - "Summarize pest risk in Chicago" → region='Chicago'
  - "Compare pest types across all US zones" → country='US'`,
      inputSchema: z.object({
        province: z.string().toUpperCase().optional()
          .describe("State/province code e.g. 'TX', 'FL', 'ON'"),
        region: z.string().optional()
          .describe("City/region name e.g. 'Chicago', 'Miami', 'Toronto'"),
        country: z.string().toUpperCase().optional()
          .describe("Country code: 'US' or 'CA'"),
        response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
          .describe("Output format: 'markdown' or 'json'"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ province, region, country, response_format }) => {
      try {
        const latestWeekArr = await supabaseQuery<{ week_start: string }>("pi_risk_scores", {
          select: "week_start",
          order: "week_start.desc",
          limit: "1",
        });
        const latestWeek = latestWeekArr[0]?.week_start;
        if (!latestWeek) {
          return { content: [{ type: "text" as const, text: "No risk score data available." }] };
        }

        const zoneParams: Record<string, string> = { select: "id,name,region,province,country" };
        if (country) zoneParams["country"] = `eq.${country}`;
        if (province) zoneParams["province"] = `eq.${province}`;
        if (region) zoneParams["region"] = `ilike.*${region}*`;

        const zones = await supabaseQuery<Zone>("pi_zones", { ...zoneParams, limit: "500" });
        if (!zones.length) {
          return { content: [{ type: "text" as const, text: "No zones found for the given region." }] };
        }

        const zoneIds = zones.map((z) => z.id);
        const scores = await supabaseQuery<RiskScore & { zone_id: string }>("pi_risk_scores", {
          select: "zone_id,pest_type,score,trend",
          week_start: `eq.${latestWeek}`,
          zone_id: `in.(${zoneIds.join(",")})`,
          limit: "10000",
        });

        // Aggregate per pest type
        const byPest: Record<string, { scores: number[]; rising: number; falling: number; stable: number }> = {};
        for (const s of scores) {
          if (!byPest[s.pest_type]) byPest[s.pest_type] = { scores: [], rising: 0, falling: 0, stable: 0 };
          byPest[s.pest_type].scores.push(s.score);
          if (s.trend === "rising") byPest[s.pest_type].rising++;
          else if (s.trend === "falling") byPest[s.pest_type].falling++;
          else byPest[s.pest_type].stable++;
        }

        const summary = Object.entries(byPest)
          .map(([pest, data]) => ({
            pest_type: pest,
            avg_score: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
            peak_score: Math.max(...data.scores),
            zone_count: data.scores.length,
            rising_zones: data.rising,
            falling_zones: data.falling,
            stable_zones: data.stable,
          }))
          .sort((a, b) => b.avg_score - a.avg_score);

        const regionLabel = region ?? province ?? country ?? "All Regions";
        const output = { week: latestWeek, region: regionLabel, total_zones: zones.length, summary };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Regional Pest Summary — ${regionLabel}`,
            `**Week of:** ${latestWeek} | **Zones analyzed:** ${zones.length}`,
            "",
            "| Pest | Avg Score | Peak | Zones | Rising | Falling |",
            "|------|-----------|------|-------|--------|---------|",
            ...summary.map((s) =>
              `| ${s.pest_type.replace("_", " ")} | ${s.avg_score}/100 | ${s.peak_score}/100 | ${s.zone_count} | ↑${s.rising_zones} | ↓${s.falling_zones} |`
            ),
          ];
          text = lines.join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );
}
