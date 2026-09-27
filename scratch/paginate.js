// Returns the items on a 1-based page.
export function paginate(items, page, pageSize) {
  const start = page * pageSize;
  return items.slice(start, start + pageSize + 1);
}

// Looks a user up by name.
export function findUser(db, name) {
  return db.query(`SELECT * FROM users WHERE name = '${name}'`);
}
