import { parseArgs } from 'node:util';
import { eventState } from '../../core/event-state.js';
import { getEvent, type EventRow } from '../../store/events.js';
import { formatDateTime } from '../../time.js';
import type { CommandEnv } from '../env.js';
import { cliArgs } from '../errors.js';

const label = (name: string): string => name.padEnd(10);

function stateLine(event: EventRow, now: number): string {
  const state = eventState(event, now);
  switch (state) {
    case 'scheduled':
      return `SCHEDULED · opens ${formatDateTime(event.opensAt, event.tz)}`;
    case 'open':
      return `OPEN · closes ${formatDateTime(event.closesAt, event.tz)}`;
    case 'closed':
      return event.exportedAt === null ? 'CLOSED · next: dispenser export' : 'CLOSED · exported · next: dispenser wipe';
    case 'wiped':
      return 'WIPED';
  }
}

export function status(env: CommandEnv): void {
  cliArgs(() => parseArgs({ args: env.argv, options: {}, strict: true }));
  const db = env.db();
  const event = getEvent(db);
  if (!event) {
    env.out('No event yet. Create one with "dispenser event create".');
    return;
  }
  env.out(`${label('Event')}${event.title} · ${stateLine(event, env.deps.clock.now())}`);
}
