import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const dbMod = await import('../lib/db.ts');
  const foodCost = await import('../lib/beoFoodCost.ts');

  // get production db
  const db = dbMod.getDb();
  
  const eventsPath = '/Users/seanburdges/.gemini/antigravity-ide/brain/4ccb5eae-277f-4044-aa74-c7904947a915/scratch/events_master.json';
  const data = JSON.parse(readFileSync(eventsPath, 'utf8'));
  
  for (const [eventName, eventData] of Object.entries(data)) {
    const lines = [];
    let id_counter = 1;
    for (const [item, qty] of Object.entries(eventData.menu)) {
      lines.push({
        id: id_counter++,
        item_name: item,
        unit_cost: 100, // Dummy value, we just want the actual 'cost' field
        quantity: qty
      });
    }
    
    // Some events might have no valid lines if they just say "Bar Spend Amount"
    if (lines.length > 0) {
      try {
        const { perLine } = foodCost.computeLineFoodCosts(lines, 'default', db);
        let totalFoodCost = 0;
        for (const line of perLine) {
           if (line.cost) {
              totalFoodCost += (line.cost * line.quantity);
           }
        }
        eventData.food_cost = totalFoodCost;
      } catch (err) {
        eventData.food_cost = 0;
        eventData.food_cost_error = String(err);
      }
    } else {
      eventData.food_cost = 0;
    }
  }
  
  writeFileSync(eventsPath, JSON.stringify(data, null, 2));
  console.log("Successfully added food_cost to all events.");
}

main().catch(console.error);
