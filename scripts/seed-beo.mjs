#!/usr/bin/env node
// Seed beo_events and beo_prep_tasks from BEO invoice filenames
// and the beo_recipe_map.csv file.
//
// Idempotent: skips events whose title already exists.
// Run: npm run seed-beo

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'lariat.db');
const BEO_DIR = path.join(ROOT, 'originals', 'BEO');
const RECIPE_MAP = path.join(ROOT, 'menus', 'beo_recipe_map.csv');

// ---------------------------------------------------------------------------
// 1. Parse invoice filenames into event records
// ---------------------------------------------------------------------------

const INVOICES = [
  // filename (without extension)            → client name, event_date
  { file: 'Invoice Darrell and anne collett 9_27',       client: 'Darrell & Anne Collett', date: '2025-09-27' },
  { file: 'Lariat Invoice Christy Nichols 9_7',         client: 'Christy Nichols',        date: '2025-09-07' },
  { file: 'Lariat Invoice Kaitlyn and Tori 10_17_25',   client: 'Kaitlyn & Tori',         date: '2025-10-17' },
  { file: 'Lariat Invoice Laura Coker 12_19_25',        client: 'Laura Coker',            date: '2025-12-19' },
  { file: 'Lariat Invoice Leighton Peebles 12_13',      client: 'Leighton Peebles',       date: '2025-12-13' },
  { file: 'Lariat Invoice Logan and Olivia 9_18',       client: 'Logan & Olivia',         date: '2025-09-18' },
  // Duplicate "(1)" file intentionally skipped
];

function eventTitle(client) {
  // Use last name + "Event" as the title
  const parts = client.split(/\s*&\s*/);
  const last = parts[0].trim().split(/\s+/).pop();
  return `${last} Event`;
}

// ---------------------------------------------------------------------------
// 2. Load recipe map → array of prep-task strings
// ---------------------------------------------------------------------------

function loadPrepTasks() {
  const csv = fs.readFileSync(RECIPE_MAP, 'utf-8');
  const lines = csv.trim().split('\n').slice(1); // skip header
  return lines
    .map((l) => {
      const [beoItem, recipeId] = l.split(',').map((s) => s.trim());
      if (!beoItem || !recipeId) return null;
      return `Prep ${recipeId} (${beoItem})`;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 3. Seed the database
// ---------------------------------------------------------------------------

function seed() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const prepTasks = loadPrepTasks();
  console.log(`Loaded ${prepTasks.length} prep-task templates from recipe map`);

  const insertEvent = db.prepare(`
    INSERT INTO beo_events (title, event_date, guest_count, notes, status, location_id)
    VALUES (@title, @event_date, NULL, @notes, 'completed', 'default')
  `);

  const insertTask = db.prepare(`
    INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id)
    VALUES (@event_id, @task, @due_date, 1, @sort_order, 'default')
  `);

  const findEvent = db.prepare(`SELECT id FROM beo_events WHERE title = ?`);

  const txn = db.transaction(() => {
    let eventsInserted = 0;
    let tasksInserted = 0;

    for (const inv of INVOICES) {
      const title = eventTitle(inv.client);

      // Idempotent: skip if title already present
      if (findEvent.get(title)) {
        console.log(`  skip (exists): ${title}`);
        continue;
      }

      const info = insertEvent.run({
        title,
        event_date: inv.date,
        notes: `Client: ${inv.client}`,
      });
      const eventId = info.lastInsertRowid;
      eventsInserted++;

      // Insert all prep tasks for this event
      prepTasks.forEach((task, idx) => {
        insertTask.run({
          event_id: eventId,
          task,
          due_date: inv.date, // prep due same day as event
          sort_order: idx + 1,
        });
        tasksInserted++;
      });

      console.log(`  + ${title} (${inv.date}) — ${prepTasks.length} tasks`);
    }

    return { eventsInserted, tasksInserted };
  });

  const { eventsInserted, tasksInserted } = txn();

  console.log(`\nDone: ${eventsInserted} events, ${tasksInserted} prep tasks inserted.`);

  // Quick verify
  const eventCount = db.prepare('SELECT count(*) AS n FROM beo_events').get().n;
  const taskCount = db.prepare('SELECT count(*) AS n FROM beo_prep_tasks').get().n;
  console.log(`Totals in DB: ${eventCount} events, ${taskCount} prep tasks.`);

  db.close();
}

seed();
