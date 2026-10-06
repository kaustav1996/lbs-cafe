import { runtime } from './context.js';

/** Events for the admin live feed. On Workers they fan out through the LiveHub Durable Object. */
export type CafeEvent =
  | { type: 'order.created'; orderId: number; number: number; source: string; table: string | null }
  | { type: 'order.updated'; orderId: number; number: number }
  | { type: 'service.created'; id: number; table: string; kind: string }
  | { type: 'service.updated'; id: number }
  | { type: 'reservation.created'; id: number; ref: string }
  | { type: 'reservation.updated'; id: number }
  | { type: 'menu.updated' }
  | { type: 'table.updated'; id: number };

export const bus = {
  publish(e: CafeEvent) {
    runtime().publish(e);
  },
};
