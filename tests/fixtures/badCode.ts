const ADULT_AGE_THRESHOLD = 18;

interface User {
  age: number;
  name: string;
}

export async function fetchUsers(): Promise<User[]> {
  const response = await fetch('/api/users');
  return response.json();
}

export async function fetchAdmins(): Promise<User[]> {
  const response = await fetch('/api/admins');
  return response.json();
}

export function filterAdultUsers(users: User[]): User[] {
  const adultUsers: User[] = [];
  for (const user of users) {
    if (user.age > ADULT_AGE_THRESHOLD) {
      adultUsers.push(user);
    }
  }
  return adultUsers;
}

export function countUsers(users: User[]): number {
  return users.length;
}

export function renderUserNamesToDom(users: User[]): void {
  for (const user of users) {
    document.body.innerHTML += `<div>${user.name}</div>`;
  }
}
