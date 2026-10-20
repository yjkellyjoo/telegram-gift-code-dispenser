import type { Clock } from '../clock.js';

export class FakeClock implements Clock {
  constructor(private ms: number) {}

  now(): number {
    return this.ms;
  }

  set(iso: string): void {
    this.ms = Date.parse(iso);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}
