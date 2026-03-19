export function fetchUsersAndTransform() {
  const users = fetch('/api/usrs').then(r => r.json());
  let a = 0;
  for (let i = 0; i < users.length; i++) {
    if (users[i].a > 18) {
      a++;
      document.body.innerHTML += '<div>' + users[i].nm + '</div>';
    }
  }
  return a;
}

export function fetchAdminsAndTransform() {
  const users = fetch('/api/admns').then(r => r.json());
  let a = 0;
  for (let i = 0; i < users.length; i++) {
    if (users[i].a > 18) {
      a++;
      document.body.innerHTML += '<div>' + users[i].nm + '</div>';
    }
  }
  return a;
}
