# Lariat Tech Debt & Hardening Plan

This plan addresses the tech debt and architecture tasks requested for the Lariat Cockpit application. 

## Proposed Changes

### 1. TypeScript Incremental Migration

The initial baseline conversions for the database (`lib/db.ts`) and data sources (`lib/data.ts`) are already fully typed and completed. The next incremental step is to begin typing the React component layer. 

#### [MODIFY] [app/gold-stars/*](file:///Users/seanburdges/Dev/Lariat/app/gold-stars)
- Rename `.jsx` to `.tsx` for `page.jsx` and `GoldStarBoard.jsx`.
- Define prop interfaces (e.g. `StarLogProps`) and annotate shared parameters.

### 2. Extract Inline Styles to CSS Classes

Many React components currently use unoptimized inline styles (e.g. `style={{...}}`) which breaks UI performance patterns and caching.

#### [MODIFY] [app/globals.css](file:///Users/seanburdges/Dev/Lariat/app/globals.css)
- Add functional atomic CSS units mapping to current inline styles: `.flex-center`, `.text-muted`, layout spacers, and color references.

#### [MODIFY] [app/beo/BeoBoard.jsx](file:///Users/seanburdges/Dev/Lariat/app/beo/BeoBoard.jsx)
- Remove `style={{...}}` rules and apply the new global classes.
#### [MODIFY] [app/kitchen-assistant/KitchenAssistantClient.jsx](file:///Users/seanburdges/Dev/Lariat/app/kitchen-assistant/KitchenAssistantClient.jsx)
- Extract inline paddings, layouts, and style parameters into external class definitions.

### 3. Rate Limiting for PIN Auth Endpoint

> [!NOTE]
> Rate limiting is **already successfully implemented** in the PIN endpoint logic via the `isRateLimited()` cache interceptor which limits an IP to 5 requests per 60 seconds.

#### [NO CHANGE REQUIRED] [app/api/auth/pin/route.js](file:///Users/seanburdges/Dev/Lariat/app/api/auth/pin/route.js)
- Maintain current implementation.

### 4. Fully Archive Lariat-v2 Content

The legacy v2 application should be completely removed from the main branch.

#### [DELETE] [Lariat-v2/](file:///Users/seanburdges/Dev/Lariat/Lariat-v2)
- Execute `git rm -rf` on the legacy directory.
#### [MODIFY] [package.json](file:///Users/seanburdges/Dev/Lariat/package.json)
- Remove the legacy `"export:v2": "node scripts/export-v2.mjs"` script from config.
#### [DELETE] [scripts/export-v2.mjs](file:///Users/seanburdges/Dev/Lariat/scripts/export-v2.mjs)
- Delete the export script that points entirely to v2 SQLite data maps.

### 5. Migrate Python Utilities to Dedicated `scripts/lib`

#### [NEW] [scripts/lib/](file:///Users/seanburdges/Dev/Lariat/scripts/lib)
- Establish the new Python utility directory structure.
#### [DELETE] [libs/](file:///Users/seanburdges/Dev/Lariat/libs)
- Move all files (e.g., `checklist_state.py`, `recipe_parser.py`) into `scripts/lib/`.
#### [MODIFY] [scripts/*.py](file:///Users/seanburdges/Dev/Lariat/scripts)
- Update all Python path resolvers across the various cron scripts. Convert `import libs.X` and `from libs.X import Y` statements to use `from scripts.lib.X import Y`.

## Verification Plan

### Automated Tests
- Run `npm run dev` and ensure Next.js compiles without errors in the converted `.tsx` pages.
- Check `npx tsc --noEmit` to verify strict typing compliance of the modified react components.

### Manual Verification
- Render the `gold-stars` and `beo` pages locally to visually guarantee style identicality post-extraction.
- Execute a sampling of standard Python ops tools (e.g. `scripts/rebuild_merged_prices.py`) to confirm the successful repathing of dependencies.
