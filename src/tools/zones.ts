import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabaseQuery } from "../services/supabase.js";
import { CHARACTER_LIMIT } from "../constants.js";
import type { Zone } from "../types.js";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export function registerZoneTools(server: McpServer): void {
  // ── List Zones ────────────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_list_zones",
    {
      title: "List Pest Sentinel Zones",
      description: `List all geographic zones covered by Pest Sentinel's weekly risk scoring.

Pest Sentinel currently covers 500+ zones across 12 US states and 7 Canadian provinces. Each zone is a neighborhood or district within a major city.

Args:
  - country (string, optional): Filter by country code — 'US' or 'CA'
  - province (string, optional): Filter by state/province code (e.g., 'TX', 'FL', 'ON', 'QC')
  - region (string, optional): Filter by city/region name (e.g., 'Chicago', 'Toronto')
  - limit (number): Max results to return, 1–200 (default: 50)
  - offset (number): Pagination offset (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of zones with id, name, region, province, country, and coordinates.

Examples:
  - "Show me all zones in Texas" → province='TX'
  - "What zones are covered in Toronto?" → region='Toronto'
  - "List all US zones" → country='US'`,
      inputSchema: z.object({
        country: z.string().toUpperCase().optional()
          .describe("Country code: 'US' or 'CA'"),
        province: z.string().toUpperCase().optional()
          .describe("State/province code e.g. 'TX', 'FL', 'ON', 'QC'"),
        region: z.string().optional()
          .describe("City/region name e.g. 'Chicago', 'Toronto', 'Miami'"),
        limit: z.number().int().min(1).max(200).default(50)
          .describe("Max results to return (default: 50)"),
        offset: z.number().int().min(0).default(0)
          .describe("Pagination offset (default: 0)"),
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
    async ({ country, province, region, limit, offset, response_format }) => {
      try {
        const params: Record<string, string> = {
          select: "id,name,region,province,country,lat,lng",
          order: "region.asc,name.asc",
          limit: String(limit),
          offset: String(offset),
        };
        if (country) params["country"] = `eq.${country}`;
        if (province) params["province"] = `eq.${province}`;
        if (region) params["region"] = `ilike.*${region}*`;

        const zones = await supabaseQuery<Zone>("pi_zones", params);

        if (!zones.length) {
          return {
            content: [{
              type: "text" as const,
              text: "No zones found matching your criteria. Try broadening your filter or visit pestsentinel.ai to request coverage for your city.",
            }],
          };
        }

        const output = {
          count: zones.length,
          offset,
          has_more: zones.length === limit,
          next_offset: zones.length === limit ? offset + limit : undefined,
          zones,
        };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Pest Sentinel Zones (${zones.length} shown)`,
            "",
            `| Zone | Region | State/Province | Country |`,
            `|------|--------|----------------|---------|`,
            ...zones.map((z) => `| ${z.name} | ${z.region} | ${z.province} | ${z.country} |`),
          ];
          if (output.has_more) {
            lines.push("", `_More zones available — use offset=${output.next_offset} to continue_`);
          }
          text = lines.join("\n");
        }

        if (text.length > CHARACTER_LIMIT) {
          text = text.slice(0, CHARACTER_LIMIT) + "\n\n_Response truncated. Use filters or pagination to narrow results._";
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

  // ── Search Zones ──────────────────────────────────────────────────────────
  server.registerTool(
    "pestsentinel_search_zones",
    {
      title: "Search Pest Sentinel Zones",
      description: `Search for zones by name or city to find the zone ID needed for risk score queries.

Use this tool when you know a city or neighborhood name and need to find the matching zone ID before calling pestsentinel_get_zone_scores or pestsentinel_get_zone_history.

Args:
  - query (string): City, neighborhood, or zone name to search (min 2 characters)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Matching zones with their IDs, regions, and locations.

Examples:
  - "Find zones in Nashville" → query='Nashville'
  - "Search for Brooklyn zones" → query='Brooklyn'
  - "Is Columbus covered?" → query='Columbus'`,
      inputSchema: z.object({
        query: z.string().min(2).max(100)
          .describe("City, neighborhood, or zone name to search"),
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
    async ({ query, response_format }) => {
      try {
        const [byName, byRegion] = await Promise.all([
          supabaseQuery<Zone>("pi_zones", {
            select: "id,name,region,province,country,lat,lng",
            name: `ilike.*${query}*`,
            limit: "20",
          }),
          supabaseQuery<Zone>("pi_zones", {
            select: "id,name,region,province,country,lat,lng",
            region: `ilike.*${query}*`,
            limit: "20",
          }),
        ]);

        // Deduplicate
        const seen = new Set<string>();
        const zones: Zone[] = [];
        for (const z of [...byName, ...byRegion]) {
          if (!seen.has(z.id)) {
            seen.add(z.id);
            zones.push(z);
          }
        }

        if (!zones.length) {
          return {
            content: [{
              type: "text" as const,
              text: `No zones found matching '${query}'. This city may not be covered yet. Visit pestsentinel.ai to request it — new cities are typically added within 1–2 days.`,
            }],
          };
        }

        const output = { count: zones.length, query, zones };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            `# Search Results for '${query}' (${zones.length} zones found)`,
            "",
            "| Zone | Region | State/Province | Country | Zone ID |",
            "|------|--------|----------------|---------|---------|",
            ...zones.map((z) => `| ${z.name} | ${z.region} | ${z.province} | ${z.country} | \`${z.id}\` |`),
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
