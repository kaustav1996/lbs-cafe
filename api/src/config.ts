import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Supabase pooler connection string)'),
  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 characters'),
  PORT: z.coerce.number().default(8080),
  // Comma-separated list of origins allowed to call the API from a browser.
  CORS_ORIGINS: z.string().default('https://lbscafe.com,https://www.lbscafe.com,http://localhost:5173'),
  // First owner account, created only when the staff table is empty.
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().min(8).optional(),
  OWNER_NAME: z.string().default('Owner'),
  // Supabase and most hosted Postgres need TLS. Set to "disable" for a local database.
  DATABASE_SSL: z.enum(['require', 'disable']).default('require'),
  PUBLIC_SITE_URL: z.string().default('https://lbscafe.com'),
  NODE_ENV: z.string().default('production'),
});

export const env = Env.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
