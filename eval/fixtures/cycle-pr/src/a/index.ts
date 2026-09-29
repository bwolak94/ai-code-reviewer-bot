// Module A imports from module B — together they form a circular dependency.
import { greetB } from '../b/index.js';

export function greetA(): string {
  return `A says hello, and ${greetB()}`;
}

export const MODULE_A = 'module-a';
