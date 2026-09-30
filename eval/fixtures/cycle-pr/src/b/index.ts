// Module B imports from module A — creates a circular dependency with src/a/index.ts.
import { greetA } from '../a/index.js';

export function greetB(): string {
  return `B says hello, and ${greetA()}`;
}

export const MODULE_B = 'module-b';
