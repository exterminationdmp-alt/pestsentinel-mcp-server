# Pest Sentinel MCP Server

Real-time pest risk intelligence for **500+ zones** across the US and Canada — delivered as an MCP server for use with Claude, Cursor, and any MCP-compatible AI client.

Updated **every Monday** with fresh scores for **15 pest types** across **12 US states and 7 Canadian provinces**.

---

## What questions does this answer?

- *"What are the current pest risk scores for downtown Miami?"*
- *"Which zones have rising mosquito pressure this week?"*
- *"Where is termite risk highest in Texas right now?"*
- *"How has rodent pressure in Chicago changed over the past 6 weeks?"*
- *"Give me a full pest outlook for Florida this week."*
- *"Is Columbus, Ohio covered? What's the closest zone?"*
- *"What pest types does Pest Sentinel track?"*

---

## Tools

| Tool | Description |
|------|-------------|
| `pestsentinel_list_zones` | List all covered zones, filterable by state/province/city |
| `pestsentinel_search_zones` | Search zones by name to find zone IDs |
| `pestsentinel_get_zone_scores` | Current week's risk scores for a specific zone |
| `pestsentinel_get_rising_zones` | Zones with rising pest pressure this week |
| `pestsentinel_get_top_zones` | Highest-scoring zones nationally or by region |
| `pestsentinel_get_zone_history` | Historical weekly scores for a zone (up to 12 weeks) |
| `pestsentinel_get_regional_summary` | Aggregated pest outlook for a state, province, or city |
| `pestsentinel_list_pest_types` | All 15 pest types with risk driver descriptions |
| `pestsentinel_get_coverage` | Platform coverage stats and zone counts by state/province |

---

## Pest Types

`rodents` · `mosquitoes` · `cockroaches` · `bedbugs` · `carpenter_ants` · `raccoons` · `squirrels` · `skunks` · `bats` · `groundhogs` · `opossums` · `wasps` · `termites` · `fire_ants` · `scorpions`

---

## Installation

### Claude Desktop (stdio)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pestsentinel": {
      "command": "node",
      "args": ["/path/to/pestsentinel-mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_ANON_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Build from source

```bash
npm install
npm run build
SUPABASE_ANON_KEY=your-key npm start
```

### HTTP server (remote deployment)

```bash
TRANSPORT=http SUPABASE_ANON_KEY=your-key PORT=3000 npm start
```

---

## Get your API key

Visit **[pestsentinel.ai](https://pestsentinel.ai)** to get your API key.

---

## Score reference

| Score | Level |
|-------|-------|
| 80–100 | CRITICAL |
| 60–79 | HIGH |
| 40–59 | MODERATE |
| 20–39 | LOW |
| 0–19 | MINIMAL |

Trend values: `rising` ↑ · `stable` → · `falling` ↓

---

## Coverage

- **500+ zones** across major US and Canadian cities
- **12 US states**: FL, TX, CA, NC, UT, WI, TN, NY, GA, IL, AZ, NV, PA, and more
- **7 Canadian provinces**: ON, QC, AB, BC, SK, MB, NS
- Updated weekly every Monday from NOAA, Environment Canada, US Census, NASA NDVI, municipal 311 data, and Google Trends
