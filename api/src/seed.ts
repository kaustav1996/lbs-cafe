import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import { env } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface SeedOption { label: string; diet: 'veg' | 'nonveg' | 'unknown'; price: number }
interface SeedItem { id: string; name: string; description?: string; options: SeedOption[] }
interface SeedCategory { id: string; name: string; color: string; kind: 'food' | 'drink'; items: SeedItem[] }

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  gst_rate: 0.18,
  hours: Array.from({ length: 7 }, () => ({ open: '10:00', close: '22:00' })),
  ordering_enabled: true,
  takeaway_enabled: true,
  booking_enabled: true,
  cafe: {
    name: "LB's Hemp Cafe & Lounge",
    address: '29 BJ, BJ Block, Sector 2, Bidhannagar, Kolkata, West Bengal 700091',
    phone: '+91 98754 31882',
    email: 'lbsfrequency@gmail.com',
    gstin: '',
  },
};

/** Fills an empty database: settings, the menu from the old site, tables 1–12, and the first owner login. */
export async function seed(log: (m: string) => void = console.log) {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await sql`insert into settings (key, value) values (${key}, ${sql.json(value as never)}) on conflict (key) do nothing`;
  }

  const [{ n: cats }] = await sql<{ n: number }[]>`select count(*)::int as n from categories`;
  if (cats === 0) {
    const file = path.resolve(here, '../seed/menu.json');
    const menu = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedCategory[];
    await sql.begin(async tx => {
      for (const [ci, c] of menu.entries()) {
        const [cat] = await tx<{ id: number }[]>`
          insert into categories (slug, name, color, kind, sort)
          values (${c.id}, ${c.name}, ${c.color}, ${c.kind}, ${ci * 10}) returning id`;
        for (const [ii, it] of c.items.entries()) {
          const [item] = await tx<{ id: number }[]>`
            insert into items (category_id, slug, name, description, sort)
            values (${cat.id}, ${it.id}, ${it.name}, ${it.description ?? null}, ${ii * 10}) returning id`;
          for (const [oi, o] of it.options.entries()) {
            await tx`insert into item_options (item_id, label, diet, price_paise, sort)
                     values (${item.id}, ${o.label}, ${o.diet}, ${o.price * 100}, ${oi})`;
          }
        }
      }
    });
    log(`seeded menu: ${menu.length} sections`);
  }

  const [{ n: tables }] = await sql<{ n: number }[]>`select count(*)::int as n from dining_tables`;
  if (tables === 0) {
    for (let i = 1; i <= 12; i++) await sql`insert into dining_tables (label, seats, sort) values (${String(i)}, 4, ${i})`;
    log('seeded tables 1-12');
  }

  const [{ n: staff }] = await sql<{ n: number }[]>`select count(*)::int as n from staff`;
  if (staff === 0 && env.OWNER_EMAIL && env.OWNER_PASSWORD) {
    const hash = await bcrypt.hash(env.OWNER_PASSWORD, 11);
    await sql`insert into staff (name, email, password_hash, role)
              values (${env.OWNER_NAME}, ${env.OWNER_EMAIL.toLowerCase()}, ${hash}, 'owner')`;
    log(`created owner login ${env.OWNER_EMAIL}`);
  }
}
