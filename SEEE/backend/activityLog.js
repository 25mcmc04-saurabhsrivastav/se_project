// activity_logs.details is a JSON column, so plain text must be wrapped as valid JSON.
function toDetailsJson(details) {
  if (details === undefined || details === null || details === '') return null;
  if (typeof details === 'string') return JSON.stringify({ message: details });
  return JSON.stringify(details);
}

// Turns a stored details value back into readable text for the activity feed.
export function readDetailsText(details) {
  if (details === undefined || details === null) return null;
  let value = details;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (typeof value === 'string') return value;
  if (value && typeof value.message === 'string') return value.message;
  return JSON.stringify(value);
}

export async function recordActivity(db, userId, action, entityType, entityId, details) {
  await db.execute(
    'INSERT INTO activity_logs (user_id, `action`, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId || null, action, entityType, entityId, toDetailsJson(details)],
  );
}

export async function notifyUsers(db, userIds, message, relatedType, relatedId, actorId) {
  const recipientIds = [...new Set((userIds || []).map(Number))]
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== Number(actorId));
  if (recipientIds.length === 0) return;

  const placeholders = recipientIds.map(() => '(?, ?, ?, ?, 0)').join(', ');
  const values = recipientIds.flatMap((userId) => [userId, message, relatedType || null, relatedId || null]);
  await db.execute(
    'INSERT INTO notifications (user_id, message, related_type, related_id, is_read) VALUES ' + placeholders,
    values,
  );
}
