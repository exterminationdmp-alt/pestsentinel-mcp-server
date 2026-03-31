import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabaseQuery } from "../services/supabase.js";
import { PEST_TYPES } from "../constants.js";
import { z } from "zod";

enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

const PEST_DESCRIPTIONS: Record<string, string> = {
  rodents: "Rats and mice — driven by food sources, temperature drops, and building age",
  mosquitoes: "Mosquitoes — driven by standing water, humidity, and warm temperatures",
  cockroaches: "Cockroaches — driven by restaurant density, humidity, and urban density",
  bedbugs: "Bed bugs — driven by hotel density, Airbnb concentration, and travel hubs",
  carpenter_ants: "Carpenter ants — driven by moisture, wood structures, and green space",
  raccoons: "Raccoons — driven by green space, waste disruption, and suburban density",
  squirrels: "Squirrels — driven by tree canopy, building age, and attic access",
  skunks: "Skunks — driven by green space, construction activity, and grub availability",
  bats: "Bats — driven by older buildings, green space proximity, and insect availability",
  groundhogs: "Groundhogs — driven by suburban edges, green space, and soil conditions",
  opossums: "Opossums — driven by green space, residential density, and food availability",
  wasps: "Wasps — driven by warm temperatures, dry conditions, and building structures",
  termites: "Termites — driven by soil moisture, wood structures, and warm climates",
  fire_ants: "Fire ants — driven by warm temperatures, sandy soil, and sun exposure",
  scorpions: "Scorpions — driven by desert heat, rocky terrain, and construction activity",
};

export function registerPestTools(server: McpServer): void {
  server.registerTool(
    "pestsentinel_list_pest_types",
    {
      title: "List Pest Types",
      description: `List all 15 pest types tracked by Pest Sentinel with descriptions of what drives their risk scores.

Use this tool to discover available pest types before calling other tools that require a pest_type parameter.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  All 15 pest types with descriptions of their primary risk drivers.`,
      inputSchema: z.object({
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
    async ({ response_format }) => {
      const pestList = PEST_TYPES.map((p) => ({
        pest_type: p,
        description: PEST_DESCRIPTIONS[p] ?? p,
      }));

      let text: string;
      if (response_format === ResponseFormat.JSON) {
        text = JSON.stringify({ count: pestList.length, pest_types: pestList }, null, 2);
      } else {
        const lines = [
          "# Pest Sentinel — Tracked Pest Types",
          "",
          "| Pest Type | Description |",
          "|-----------|-------------|",
          ...pestList.map((p) => `| \`${p.pest_type}\` | ${p.description} |`),
        ];
        text = lines.join("\n");
      }

      return {
        content: [{ type: "text" as const, text }],
        structuredContent: { count: pestList.length, pest_types: pestList },
      };
    }
  );

  server.registerTool(
    "pestsentinel_get_coverage",
    {
      title: "Get Coverage Summary",
      description: `Get a summary of Pest Sentinel's current data coverage — how many zones, states, countries, pest types, and weeks of history are available.

Use this tool to understand what's available before making other queries. Returns current platform stats.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Coverage stats: zone count, state/province breakdown, latest week scored, total risk scores.`,
      inputSchema: z.object({
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
    async ({ response_format }) => {
      try {
        const [zones, scoreStats] = await Promise.all([
          supabaseQuery<{ province: string; country: string; count: string }>("pi_zones", {
            select: "province,country",
            limit: "1000",
          }),
          supabaseQuery<{ week_start: string }>("pi_risk_scores", {
            select: "week_start",
            order: "week_start.desc",
            limit: "1",
          }),
        ]);

        const byProvince: Record<string, number> = {};
        for (const z of zones) {
          const key = `${z.province} (${z.country})`;
          byProvince[key] = (byProvince[key] ?? 0) + 1;
        }

        const output = {
          total_zones: zones.length,
          pest_types: PEST_TYPES.length,
          latest_week: scoreStats[0]?.week_start ?? "unknown",
          coverage_by_province: Object.entries(byProvince)
            .sort((a, b) => b[1] - a[1])
            .map(([province, count]) => ({ province, zones: count })),
        };

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(output, null, 2);
        } else {
          const lines = [
            "# Pest Sentinel — Coverage Summary",
            "",
            `- **Total zones:** ${output.total_zones}`,
            `- **Pest types modeled:** ${output.pest_types}`,
            `- **Latest week scored:** ${output.latest_week}`,
            `- **Updated:** Weekly every Monday`,
            "",
            "## Coverage by State/Province",
            "",
            "| State/Province | Zones |",
            "|----------------|-------|",
            ...output.coverage_by_province.map((p) => `| ${p.province} | ${p.zones} |`),
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
