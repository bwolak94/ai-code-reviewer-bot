/** Pure domain model — no external imports, no infrastructure dependencies. */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export function createUser(id: string, name: string, email: string): User {
  return { id, name, email, createdAt: new Date() };
}
