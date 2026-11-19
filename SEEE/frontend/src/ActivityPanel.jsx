import { useEffect, useState } from 'react';

const activityLabels = {
  project_created: 'created a project',
  project_updated: 'updated a project',
  task_created: 'created a task',
  task_updated: 'updated a task',
  subtask_created: 'added a subtask',
  subtask_updated: 'updated a subtask',
  comment_added: 'commented on a task',
  comment_updated: 'edited a comment',
  attachment_added: 'added a file',
  attachment_removed: 'removed a file',
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function dateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function RelatedLabel({ type, title }) {
  if (!title) return null;
  return <span className="activity-related">{type === 'task' ? 'Task' : 'Project'}: {title}</span>;
}

export default function ActivityPanel({ onBack }) {
  const [activity, setActivity] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState('');

  async function loadActivity() {
    setLoading(true);
    setError('');
    try {
      const data = await request('/api/activity');
      setActivity(data.activity || []);
      setNotifications(data.notifications || []);
      setUnreadCount(Number(data.unread_count) || 0);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadActivity();
  }, []);

  async function markRead(notificationId) {
    setSavingId(notificationId);
    setError('');
    try {
      await request('/api/activity/notifications/' + notificationId + '/read', { method: 'PATCH' });
      setNotifications((items) => items.map((item) => item.notification_id === notificationId ? { ...item, is_read: true } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch (markError) {
      setError(markError.message);
    } finally {
      setSavingId(null);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError('');
    try {
      await request('/api/activity/notifications/read-all', { method: 'POST' });
      setNotifications((items) => items.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (markError) {
      setError(markError.message);
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <main className="activity-main">
      <div className="activity-intro">
        <div>
          <p className="eyebrow eyebrow-light">TEAM UPDATES</p>
          <h1>Team activity</h1>
          <p>Recent project and task updates, plus notifications sent to you.</p>
        </div>
        <button className="secondary-action activity-back-action" type="button" onClick={onBack}>Back to overview</button>
      </div>

      {error && <div className="inline-alert" role="alert">{error}</div>}
      {loading ? (
        <div className="tasks-loading"><span className="loading-spinner" aria-hidden="true" />Loading team activity…</div>
      ) : (
        <div className="activity-columns">
          <section className="activity-card" aria-labelledby="activity-feed-title">
            <div className="activity-card-heading">
              <div>
                <h2 id="activity-feed-title">Recent activity</h2>
                <p>Updates from projects and tasks you can access.</p>
              </div>
              <span className="activity-count">{activity.length}</span>
            </div>
            {activity.length === 0 ? (
              <p className="activity-empty">There are no updates yet. Project and task changes will appear here.</p>
            ) : (
              <div className="activity-list">
                {activity.map((entry) => (
                  <article className="activity-item" key={entry.activity_id}>
                    <span className="activity-dot" aria-hidden="true" />
                    <div className="activity-item-copy">
                      <p><strong>{entry.actor_name}</strong> {activityLabels[entry.action] || 'made an update'}</p>
                      <RelatedLabel type={entry.entity_type} title={entry.task_title || entry.project_name} />
                      {entry.details && <p className="activity-details">{entry.details}</p>}
                      <time dateTime={entry.created_at}>{dateTime(entry.created_at)}</time>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="activity-card notification-card" aria-labelledby="notifications-title">
            <div className="activity-card-heading">
              <div>
                <h2 id="notifications-title">Your notifications</h2>
                <p>{unreadCount ? unreadCount + ' unread' : 'You’re all caught up.'}</p>
              </div>
              {unreadCount > 0 && (
                <button className="text-button" type="button" onClick={markAllRead} disabled={markingAll}>
                  {markingAll ? 'Marking…' : 'Mark all read'}
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="activity-empty">Notifications about assignments and task comments will appear here.</p>
            ) : (
              <div className="notification-list">
                {notifications.map((notification) => (
                  <article className={'notification-item' + (notification.is_read ? '' : ' notification-unread')} key={notification.notification_id}>
                    <div className="notification-copy">
                      <p>{notification.message}</p>
                      <RelatedLabel type={notification.related_type} title={notification.related_title} />
                      <time dateTime={notification.created_at}>{dateTime(notification.created_at)}</time>
                    </div>
                    {!notification.is_read && (
                      <button
                        className="text-button notification-read-button"
                        type="button"
                        onClick={() => markRead(notification.notification_id)}
                        disabled={savingId === notification.notification_id}
                      >
                        {savingId === notification.notification_id ? 'Saving…' : 'Mark read'}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
