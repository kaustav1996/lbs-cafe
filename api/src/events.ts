import { EventEmitter } from 'node:events';

/** In-process event bus feeding the admin live stream. The API runs as one instance. */
export type CafeEvent =
  | { type: 'order.created'; orderId: number; number: number; source: string; table: string | null }
  | { type: 'order.updated'; orderId: number; number: number }
  | { type: 'service.created'; id: number; table: string; kind: string }
  | { type: 'service.updated'; id: number }
  | { type: 'reservation.created'; id: number; ref: string }
  | { type: 'reservation.updated'; id: number }
  | { type: 'menu.updated' };

class Bus extends EventEmitter {
  publish(e: CafeEvent) {
    this.emit('event', e);
  }
}
export const bus = new Bus();
bus.setMaxListeners(100);
