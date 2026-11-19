import { useEffect, useMemo, useState } from 'react';

const taskStatuses = {
  not_started: 'Not started',
  in_progress: 'In progress',
  in_review: 'In review',
  completed: 'Completed',
  blocked: 'Blocked',
};

const subtaskStatuses = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

const priorityLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
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

function TaskForm({ value, user, projects, people, saving, optionsLoading, error, onChange, onProjectChange, onCancel, onSubmit }) {
  const isEditing = Boolean(value.task_id);
  const selectedContributors = new Set((value.contributor_ids || []).map(Number));
  const selectableProjects = projects.filter((project) =>
    !['completed', 'cancelled'].includes(project.status) &&
    (user.role === 'admin' || Number(project.lead_id) === Number(user.id)));

  function toggleContributor(userId) {
    const next = new Set(selectedContributors);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange('contributor_ids', [...next]);
  }

  function changeOwner(selectedId) {
    const ownerId = selectedId ? Number(selectedId) : '';
    onChange('owner_id', ownerId);
    if (ownerId) {
      onChange('contributor_ids', (value.contributor_ids || []).filter((userId) => Number(userId) !== ownerId));
    }
  }

  function changeStatus(status) {
    onChange('status', status);
    if (value.status === 'completed' && status !== 'completed' && Number(value.subtask_count) === 0) {
      onChange('progress_percent', 0);
    }
  }

  return (
    <section className="task-form-card" aria-labelledby="task-form-title">
      <div className="admin-form-heading">
        <div>
          <p className="eyebrow eyebrow-light">{isEditing ? 'TASK SETTINGS' : 'NEW TASK'}</p>
          <h2 id="task-form-title">{isEditing ? 'Edit task' : 'Create a task'}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      <form className="admin-form-grid" onSubmit={onSubmit}>
        <label className="admin-field admin-field-wide">
          <span>Task title</span>
          <input maxLength="200" value={value.title} onChange={(event) => onChange('title', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Project</span>
          {isEditing ? (
            <input value={value.project_name} readOnly />
          ) : (
            <select value={value.project_id || ''} onChange={(event) => onProjectChange(Number(event.target.value))} required>
              <option value="">Choose a project</option>
              {selectableProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_name}</option>)}
            </select>
          )}
        </label>
        <label className="admin-field">
          <span>Owner</span>
          <select value={value.owner_id || ''} onChange={(event) => changeOwner(event.target.value)} disabled={optionsLoading} required>
            <option value="">Choose an owner</option>
            {people.map((person) => <option key={person.user_id} value={person.user_id}>{person.name} · {person.role.replace('_', ' ')}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>Priority</span>
          <select value={value.priority} onChange={(event) => onChange('priority', event.target.value)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select value={value.status} onChange={(event) => changeStatus(event.target.value)}>
            {Object.entries(taskStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>Estimated hours</span>
          <input type="number" min="0.01" max="999999.99" step="0.25" value={value.estimated_hours} onChange={(event) => onChange('estimated_hours', event.target.value)} required />
        </label>
        <label className="admin-field">
          <span>Start date</span>
          <input type="date" value={value.start_date || ''} onChange={(event) => onChange('start_date', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Due date</span>
          <input type="date" min={value.start_date || undefined} value={value.due_date || ''} onChange={(event) => onChange('due_date', event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Manual progress (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={value.progress_percent}
            disabled={Number(value.subtask_count) > 0}
            onChange={(event) => onChange('progress_percent', event.target.value)}
          />
          <small className="field-help">{Number(value.subtask_count) > 0 ? 'Progress is calculated from the subtasks.' : 'Used until the task has subtasks.'}</small>
        </label>
        <label className="admin-field admin-field-wide">
          <span>Description</span>
          <textarea rows="3" maxLength="5000" value={value.description || ''} onChange={(event) => onChange('description', event.target.value)} />
        </label>
        <fieldset className="member-picker task-contributor-picker">
          <legend>Contributors <span>{selectedContributors.size} selected</span></legend>
          {people.length === 0 ? (
            <p className="empty-note">Choose a project with active members first.</p>
          ) : (
            <div className="member-picker-list">
              {people.map((person) => (
                <label className="member-option" key={person.user_id}>
                  <input
                    type="checkbox"
                    checked={selectedContributors.has(Number(person.user_id))}
                    disabled={optionsLoading || Number(value.owner_id) === Number(person.user_id)}
                    onChange={() => toggleContributor(Number(person.user_id))}
                  />
                  <span className="member-option-copy">
                    <strong>{person.name}</strong>
                    <small>{person.email} · {person.role.replace('_', ' ')}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div className="admin-form-actions">
          <p className="form-hint">Choose one owner, then add any other active project members as contributors.</p>
          <button className="primary-action" type="submit" disabled={saving || optionsLoading || (!isEditing && !selectableProjects.length)}>
            {saving ? 'Saving…' : isEditing ? 'Save task' : 'Create task'}
          </button>
        </div>
      </form>
    </section>
  );
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function localToday() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function TaskCollaboration({ task }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [editingComment, setEditingComment] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [savingComment, setSavingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function loadCollaboration() {
    setLoading(true);
    setError('');
    try {
      const data = await request('/api/tasks/' + task.task_id + '/collaboration');
      setComments(data.comments || []);
      setAttachments(data.attachments || []);
      setLoaded(true);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    setSavingComment(true);
    setError('');
    try {
      await request('/api/tasks/' + task.task_id + '/comments', {
        method: 'POST',
        body: JSON.stringify({ message: commentText }),
      });
      setCommentText('');
      await loadCollaboration();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingComment(false);
    }
  }

  async function saveEditedComment(event) {
    event.preventDefault();
    setSavingComment(true);
    setError('');
    try {
      await request('/api/tasks/' + task.task_id + '/comments/' + editingComment, {
        method: 'PATCH',
        body: JSON.stringify({ message: editingText }),
      });
      setEditingComment(null);
      setEditingText('');
      await loadCollaboration();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingComment(false);
    }
  }

  async function uploadFile(event) {
    event.preventDefault();
    if (!selectedFile) {
      setError('Choose a file to upload.');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Files must be 10 MB or smaller.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const url = '/api/tasks/' + task.task_id + '/attachments?filename=' + encodeURIComponent(selectedFile.name);
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: selectedFile,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The file could not be uploaded.');
      setSelectedFile(null);
      setFileInputKey((key) => key + 1);
      await loadCollaboration();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(attachment) {
    if (!window.confirm('Remove “' + attachment.original_name + '”? This file will no longer be available.')) return;
    setError('');
    try {
      await request('/api/tasks/' + task.task_id + '/attachments/' + attachment.attachment_id, { method: 'DELETE' });
      await loadCollaboration();
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  return (
    <details
      className="task-collaboration"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !loading) loadCollaboration();
      }}
    >
      <summary>Comments &amp; files <span>{comments.length + attachments.length}</span></summary>
      {error && <div className="inline-alert collaboration-alert" role="alert">{error}</div>}
      {loading ? (
        <div className="collaboration-loading">Loading comments and files…</div>
      ) : (
        <>
          <section className="collaboration-section" aria-labelledby={'comments-title-' + task.task_id}>
            <h3 id={'comments-title-' + task.task_id}>Comments <span>{comments.length}</span></h3>
            {comments.length === 0 ? (
              <p className="collaboration-empty">Start the conversation about this task.</p>
            ) : (
              <div className="comment-list">
                {comments.map((comment) => (
                  <article className="comment-item" key={comment.comment_id}>
                    <div className="comment-heading">
                      <span className="comment-avatar" aria-hidden="true">{initials(comment.author_name)}</span>
                      <div className="comment-author">
                        <strong>{comment.author_name}</strong>
                        <small>{formatDateTime(comment.created_at)}{new Date(comment.updated_at).getTime() > new Date(comment.created_at).getTime() ? ' · edited' : ''}</small>
                      </div>
                      {comment.can_edit && !editingComment && (
                        <button className="text-button" type="button" onClick={() => { setEditingComment(comment.comment_id); setEditingText(comment.message); }}>Edit</button>
                      )}
                    </div>
                    {editingComment === comment.comment_id ? (
                      <form className="comment-edit-form" onSubmit={saveEditedComment}>
                        <textarea rows="3" maxLength="5000" value={editingText} onChange={(event) => setEditingText(event.target.value)} required />
                        <div className="comment-edit-actions">
                          <button className="text-button" type="button" onClick={() => { setEditingComment(null); setEditingText(''); }} disabled={savingComment}>Cancel</button>
                          <button className="primary-action" type="submit" disabled={savingComment || !editingText.trim()}>{savingComment ? 'Saving…' : 'Save comment'}</button>
                        </div>
                      </form>
                    ) : (
                      <p className="comment-message">{comment.message}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
            <form className="comment-compose" onSubmit={submitComment}>
              <label className="visually-hidden" htmlFor={'new-comment-' + task.task_id}>Add a comment</label>
              <textarea
                id={'new-comment-' + task.task_id}
                rows="2"
                maxLength="5000"
                placeholder="Write a comment…"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                required
              />
              <button className="primary-action" type="submit" disabled={savingComment || !commentText.trim()}>
                {savingComment ? 'Posting…' : 'Comment'}
              </button>
            </form>
          </section>

          <section className="collaboration-section file-collaboration" aria-labelledby={'files-title-' + task.task_id}>
            <h3 id={'files-title-' + task.task_id}>Files <span>{attachments.length}</span></h3>
            {attachments.length > 0 ? (
              <div className="attachment-list">
                {attachments.map((attachment) => (
                  <div className="attachment-item" key={attachment.attachment_id}>
                    <span className="attachment-icon" aria-hidden="true">↧</span>
                    <div className="attachment-copy">
                      <a href={attachment.download_url} download>{attachment.original_name}</a>
                      <small>{formatFileSize(attachment.file_size)} · {attachment.uploader_name} · {formatDateTime(attachment.uploaded_at)}</small>
                    </div>
                    {attachment.can_delete && (
                      <button className="text-button remove-attachment" type="button" onClick={() => removeAttachment(attachment)}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="collaboration-empty">No files attached to this task.</p>
            )}
            <form className="attachment-upload-form" onSubmit={uploadFile}>
              <label className="file-picker">
                <span>{selectedFile ? selectedFile.name : 'Choose a file'}</span>
                <input
                  key={fileInputKey}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.csv,.docx,.xlsx,.pptx,.zip"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
              </label>
              <button className="secondary-action" type="submit" disabled={uploading || !selectedFile}>{uploading ? 'Uploading…' : 'Upload file'}</button>
              <small>PDF, images, text, CSV, Office files, or ZIP · 10 MB max</small>
            </form>
          </section>
        </>
      )}
    </details>
  );
}

function SubtaskProgress({ taskId, subtask, onRefresh }) {
  const [status, setStatus] = useState(subtask.status);
  const [progress, setProgress] = useState(subtask.progress_percent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const changed = status !== subtask.status || Number(progress) !== Number(subtask.progress_percent);

  useEffect(() => {
    setStatus(subtask.status);
    setProgress(subtask.progress_percent);
  }, [subtask.status, subtask.progress_percent]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await request('/api/tasks/' + taskId + '/subtasks/' + subtask.subtask_id, {
        method: 'PATCH',
        body: JSON.stringify({ status, progress_percent: Number(progress) }),
      });
      await onRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (!subtask.can_update) {
    return <span className={'subtask-status subtask-status-' + subtask.status}>{subtaskStatuses[subtask.status] || subtask.status}</span>;
  }

  return (
    <div className="subtask-progress-editor">
      <label>
        <span className="visually-hidden">Subtask status</span>
        <select value={status} onChange={(event) => {
          const nextStatus = event.target.value;
          if (subtask.status === 'completed' && nextStatus !== 'completed') setProgress(0);
          setStatus(nextStatus);
        }}>
          {Object.entries(subtaskStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label className="subtask-percent">
        <span className="visually-hidden">Subtask progress percentage</span>
        <input type="number" min="0" max="100" step="1" value={progress} required onChange={(event) => setProgress(event.target.value)} />
        <span>%</span>
      </label>
      {changed && <button className="text-button" type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
      {error && <span className="subtask-error" role="alert">{error}</span>}
    </div>
  );
}

// Status + % editor on each task card.
// Assignees can set Not started / In progress / In review / Blocked and their %;
// only the project lead or an admin can mark a task Completed (review flow).
function TaskStatusEditor({ task, onTaskUpdate }) {
  const manager = task.can_edit;
  const [status, setStatus] = useState(task.status);
  const [progress, setProgress] = useState(task.progress_percent);
  const [saving, setSaving] = useState(false);
  const usesSubtasks = Number(task.subtask_count) > 0;

  useEffect(() => {
    setStatus(task.status);
    setProgress(task.progress_percent);
  }, [task.status, task.progress_percent]);

  async function save(changes) {
    setSaving(true);
    try {
      await onTaskUpdate(task, changes);
    } finally {
      setSaving(false);
    }
  }

  if (!task.can_update) return null;

  if (!manager && task.status === 'completed') {
    return <p className="task-locked-note">Completed and approved by the project lead.</p>;
  }

  const statusOptions = Object.entries(taskStatuses)
    .filter(([value]) => manager || value !== 'completed');
  const changed = status !== task.status || (!usesSubtasks && Number(progress) !== Number(task.progress_percent));

  return (
    <div className="task-status-editor">
      {manager && task.status === 'in_review' && (
        <div className="review-banner">
          <span>This task is waiting for your review.</span>
          <div className="review-actions">
            <button className="secondary-action" type="button" disabled={saving}
              onClick={() => save({ status: 'in_progress' })}>Send back</button>
            <button className="primary-action" type="button" disabled={saving}
              onClick={() => save({ status: 'completed' })}>Approve &amp; complete</button>
          </div>
        </div>
      )}
      {!manager && task.status === 'in_review' && (
        <p className="task-locked-note">Waiting for the project lead's review.</p>
      )}
      <div className="task-status-editor-row">
        <label className="admin-field">
          <span>Status</span>
          <select value={status} disabled={saving} onChange={(event) => {
            const next = event.target.value;
            setStatus(next);
            if (next === 'in_review' && !usesSubtasks && Number(progress) < 100) setProgress(100);
          }}>
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {usesSubtasks ? (
          <p className="form-hint">% is calculated from subtasks.</p>
        ) : (
          <label className="admin-field">
            <span>Done (%)</span>
            <input type="number" min="0" max="100" step="1" value={progress} disabled={saving || status === 'completed'}
              onChange={(event) => setProgress(event.target.value)} />
          </label>
        )}
        <button className="primary-action" type="button" disabled={!changed || saving}
          onClick={() => save(usesSubtasks ? { status } : { status, progress_percent: Number(progress) })}>
          {saving ? 'Saving…' : 'Update'}
        </button>
      </div>
      {!manager && <p className="form-hint">When the work is done, choose “In review” so the project lead can approve it.</p>}
    </div>
  );
}

const requestStatusLabels = { pending: 'Pending', approved: 'Approved', rejected: 'Declined' };

// Member requests: assignees ask for another person; the lead approves (choosing who) or declines.
function MemberRequests({ task, allUsers, onRefresh }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [chosen, setChosen] = useState({});
  const requests = task.member_requests || [];
  const assignedIds = new Set(task.assignments.map((person) => person.user_id));
  const candidates = allUsers.filter((person) => !assignedIds.has(person.user_id));
  const hasPending = requests.some((item) => item.status === 'pending');

  if (!task.can_edit && !task.can_request_member && requests.length === 0) return null;

  async function sendRequest(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await request('/api/tasks/' + task.task_id + '/member-requests', {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setReason('');
      setOpen(false);
      setMessage(data.message);
      await onRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(item, decision) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const body = decision === 'approved'
        ? { decision, user_id: Number(chosen[item.request_id]) }
        : { decision };
      const data = await request('/api/tasks/' + task.task_id + '/member-requests/' + item.request_id, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMessage(data.message);
      await onRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const myPending = requests.some((item) => item.status === 'pending' && !task.can_edit);

  return (
    <details className="task-subtasks member-requests" open={task.can_edit && hasPending}>
      <summary>Member requests <span>{requests.filter((item) => item.status === 'pending').length}</span></summary>
      {error && <div className="inline-alert" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      {requests.length === 0 && <p className="empty-note subtask-empty-note">No member requests.</p>}
      {requests.map((item) => (
        <div className="member-request-row" key={item.request_id}>
          <div className="subtask-copy">
            <strong>{item.requested_by_name}</strong>
            <small>{formatDateTime(item.created_at)} · <span className={'request-status request-status-' + item.status}>{requestStatusLabels[item.status]}</span>
              {item.handled_by_name ? ' by ' + item.handled_by_name : ''}</small>
            <p className="member-request-reason">{item.reason}</p>
          </div>
          {task.can_edit && item.status === 'pending' && (
            <div className="member-request-actions">
              <select value={chosen[item.request_id] || ''} disabled={busy}
                onChange={(event) => setChosen((current) => ({ ...current, [item.request_id]: event.target.value }))}>
                <option value="">Choose who to add</option>
                {candidates.map((person) => (
                  <option key={person.user_id} value={person.user_id}>{person.name}{person.department ? ' · ' + person.department : ''}</option>
                ))}
              </select>
              <button className="text-button" type="button" disabled={busy} onClick={() => decide(item, 'rejected')}>Decline</button>
              <button className="primary-action" type="button" disabled={busy || !chosen[item.request_id]}
                onClick={() => decide(item, 'approved')}>Approve</button>
            </div>
          )}
        </div>
      ))}
      {task.can_request_member && !myPending && task.status !== 'completed' && (
        open ? (
          <form className="subtask-add-form" onSubmit={sendRequest}>
            <label className="admin-field">
              <span>Why do you need another member?</span>
              <textarea rows="2" minLength="5" maxLength="2000" value={reason} placeholder="For example: need a UI designer for the login screens"
                onChange={(event) => setReason(event.target.value)} required />
            </label>
            <div className="subtask-add-actions">
              <button className="text-button" type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
              <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
            </div>
          </form>
        ) : (
          <button className="subtask-add-trigger" type="button" onClick={() => setOpen(true)}>+ Request a member</button>
        )
      )}
    </details>
  );
}

function TaskCard({ task, allUsers, onEdit, onTaskUpdate, onRefresh }) {
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskAssignee, setSubtaskAssignee] = useState('');
  const [subtaskHours, setSubtaskHours] = useState('1');
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const owners = task.assignments.filter((assignment) => assignment.assignment_role === 'owner');
  const contributors = task.assignments.filter((assignment) => assignment.assignment_role === 'contributor');
  const progress = Math.max(0, Math.min(100, Number(task.effective_progress_percent) || 0));
  const overdue = task.due_date && task.due_date < localToday() && task.status !== 'completed';

  async function addSubtask(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await request('/api/tasks/' + task.task_id + '/subtasks', {
        method: 'POST',
        body: JSON.stringify({
          title: subtaskTitle,
          assignee_id: subtaskAssignee ? Number(subtaskAssignee) : null,
          estimated_hours: Number(subtaskHours),
        }),
      });
      setSubtaskTitle('');
      setSubtaskAssignee('');
      setSubtaskHours('1');
      setAddingSubtask(false);
      await onRefresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="task-card">
      <div className="task-card-top">
        <span className="task-project-name">{task.project_name}</span>
        <div className="task-card-tags">
          <span className={'priority-pill priority-' + task.priority}>{priorityLabels[task.priority]}</span>
          <span className={'task-status task-status-' + task.status}>{taskStatuses[task.status] || task.status}</span>
        </div>
      </div>
      <div className="task-card-title-row">
        <div>
          <h2>{task.title}</h2>
          <p className="task-description">{task.description || 'No description has been added.'}</p>
        </div>
        {task.can_edit && <button className="text-button" type="button" onClick={() => onEdit(task)}>Edit</button>}
      </div>
      <div className="task-assignment-line">
        <span><small>Owner</small><strong>{owners[0]?.name || 'Unassigned'}</strong></span>
        <span><small>Contributors</small><strong>{contributors.length ? contributors.map((person) => person.name).join(', ') : 'None'}</strong></span>
        <span><small>Due</small><strong className={overdue ? 'overdue-date' : ''}>{formatDate(task.due_date) || 'No due date'}{overdue ? ' · overdue' : ''}</strong></span>
      </div>
      <div className="task-progress-row">
        <div className="task-progress-heading"><span>Progress</span><strong>{Math.round(progress)}%</strong></div>
        <div className="project-progress-track" role="progressbar" aria-label={task.title + ' progress'} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
          <span style={{ width: progress + '%' }} />
        </div>
      </div>
      <div className="task-card-footer">
        <div className="task-people-avatars" aria-label="Task assignees">
          {task.assignments.slice(0, 5).map((person) => (
            <span className="project-avatar" key={person.user_id} title={person.name}>{initials(person.name)}</span>
          ))}
          {task.assignments.length === 0 && <span className="muted-cell">No assignees</span>}
        </div>
        <div className="task-card-actions">
          <span className="task-hours">{Number(task.estimated_hours).toFixed(1)}h</span>
        </div>
      </div>

      <TaskStatusEditor task={task} onTaskUpdate={onTaskUpdate} />

      <details className="task-subtasks">
        <summary>Subtasks <span>{task.subtasks.length}</span></summary>
        {task.subtasks.length > 0 ? (
          <div className="subtask-list">
            {task.subtasks.map((subtask) => (
              <div className="subtask-row" key={subtask.subtask_id}>
                <div className="subtask-copy">
                  <strong>{subtask.title}</strong>
                  <small>{subtask.assignee_name || 'Unassigned'} · {Number(subtask.estimated_hours).toFixed(1)}h</small>
                </div>
                <SubtaskProgress taskId={task.task_id} subtask={subtask} onRefresh={onRefresh} />
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note subtask-empty-note">No subtasks yet.</p>
        )}
        {task.can_edit && (
          addingSubtask ? (
            <form className="subtask-add-form" onSubmit={addSubtask}>
              {error && <div className="inline-alert" role="alert">{error}</div>}
              <label className="admin-field">
                <span>Subtask title</span>
                <input maxLength="200" value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} required />
              </label>
              <div className="subtask-add-row">
                <label className="admin-field">
                  <span>Assignee</span>
                  <select value={subtaskAssignee} onChange={(event) => setSubtaskAssignee(event.target.value)}>
                    <option value="">Unassigned</option>
                    {task.assignments.map((person) => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
                  </select>
                </label>
                <label className="admin-field">
                  <span>Estimate (hours)</span>
                  <input type="number" min="0.01" step="0.25" value={subtaskHours} onChange={(event) => setSubtaskHours(event.target.value)} required />
                </label>
              </div>
              <div className="subtask-add-actions">
                <button className="text-button" type="button" onClick={() => { setAddingSubtask(false); setError(''); }} disabled={saving}>Cancel</button>
                <button className="primary-action" type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add subtask'}</button>
              </div>
            </form>
          ) : (
            <button className="subtask-add-trigger" type="button" onClick={() => { setAddingSubtask(true); setError(''); }}>+ Add subtask</button>
          )
        )}
      </details>
      <MemberRequests task={task} allUsers={allUsers} onRefresh={onRefresh} />
      <TaskCollaboration task={task} />
    </article>
  );
}

const emptyTask = {
  project_id: '',
  project_name: '',
  title: '',
  description: '',
  priority: 'medium',
  status: 'not_started',
  estimated_hours: '1',
  progress_percent: 0,
  subtask_count: 0,
  start_date: '',
  due_date: '',
  owner_id: '',
  contributor_ids: [],
};

export default function TasksPanel({ user, onBack }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const canManageTasks = ['admin', 'project_lead'].includes(user.role);

  async function loadData(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setPageError('');
    try {
      const [taskData, projectData, optionData] = await Promise.all([
        request('/api/tasks'),
        request('/api/projects'),
        canManageTasks ? request('/api/projects/options').catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
      ]);
      setTasks(taskData.tasks || []);
      setProjects(projectData.projects || []);
      setAllUsers(optionData.users || []);
    } catch (error) {
      setPageError(error.message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const projectOptions = useMemo(() => {
    const options = new Map();
    for (const project of projects) options.set(Number(project.project_id), project);
    for (const task of tasks) {
      const id = Number(task.project_id);
      if (!options.has(id)) options.set(id, { project_id: id, project_name: task.project_name, status: 'active' });
    }
    return [...options.values()].sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [projects, tasks]);

  const manageableProjects = projectOptions.filter((project) =>
    !['completed', 'cancelled'].includes(project.status) &&
    (user.role === 'admin' || Number(project.lead_id) === Number(user.id)));

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesProject = projectFilter === 'all' || Number(task.project_id) === Number(projectFilter);
      const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
      const matchesSearch = !query || [
        task.title,
        task.description,
        task.project_name,
        ...task.assignments.map((person) => person.name),
      ].some((value) => String(value || '').toLowerCase().includes(query));
      return matchesProject && matchesStatus && matchesPriority && matchesSearch;
    });
  }, [tasks, search, projectFilter, statusFilter, priorityFilter]);

  async function loadProjectPeople(projectId) {
    const options = await request('/api/tasks/options?project_id=' + projectId);
    setPeople(options.users || []);
    return options.users || [];
  }

  async function changeProject(projectId) {
    const project = manageableProjects.find((item) => Number(item.project_id) === Number(projectId));
    if (!project) return;
    setOptionsLoading(true);
    setFormError('');
    try {
      const projectPeople = await loadProjectPeople(project.project_id);
      const owner = projectPeople.find((person) => Number(person.user_id) === Number(user.id)) || projectPeople[0];
      setDraft((current) => ({
        ...current,
        project_id: Number(project.project_id),
        project_name: project.project_name,
        owner_id: owner ? Number(owner.user_id) : '',
        contributor_ids: [],
      }));
    } catch (error) {
      setFormError(error.message);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function openCreateForm(projectId = null) {
    setFormError('');
    setPageError('');
    setNotice('');
    if (!manageableProjects.length) {
      setPageError('Create or lead a project before adding tasks.');
      return;
    }
    const selectedProject = manageableProjects.find((project) => Number(project.project_id) === Number(projectId)) || manageableProjects[0];
    setOptionsLoading(true);
    try {
      const projectPeople = await loadProjectPeople(selectedProject.project_id);
      const owner = projectPeople.find((person) => Number(person.user_id) === Number(user.id)) || projectPeople[0];
      setDraft({
        ...emptyTask,
        project_id: Number(selectedProject.project_id),
        project_name: selectedProject.project_name,
        owner_id: owner ? Number(owner.user_id) : '',
        contributor_ids: [],
      });
    } catch (error) {
      setPageError(error.message);
    } finally {
      setOptionsLoading(false);
    }
  }

  async function openEditForm(task) {
    setFormError('');
    setPageError('');
    setNotice('');
    setOptionsLoading(true);
    try {
      const projectPeople = await loadProjectPeople(task.project_id);
      const owner = task.assignments.find((assignment) => assignment.assignment_role === 'owner');
      setDraft({
        task_id: task.task_id,
        project_id: task.project_id,
        project_name: task.project_name,
        title: task.title,
        description: task.description || '',
        priority: task.priority,
        status: task.status,
        estimated_hours: String(task.estimated_hours),
        progress_percent: task.progress_percent,
        subtask_count: task.subtask_count,
        start_date: task.start_date || '',
        due_date: task.due_date || '',
        owner_id: owner?.user_id || '',
        contributor_ids: task.assignments
          .filter((assignment) => assignment.assignment_role === 'contributor')
          .map((assignment) => Number(assignment.user_id)),
      });
    } catch (error) {
      setPageError(error.message);
    } finally {
      setOptionsLoading(false);
    }
  }

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveTask(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    setNotice('');
    const isEditing = Boolean(draft.task_id);
    const payload = {
      project_id: Number(draft.project_id),
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      status: draft.status,
      estimated_hours: Number(draft.estimated_hours),
      start_date: draft.start_date || null,
      due_date: draft.due_date || null,
      owner_id: Number(draft.owner_id),
      contributor_ids: draft.contributor_ids.map(Number),
    };
    if (Number(draft.subtask_count) === 0) payload.progress_percent = Number(draft.progress_percent);
    try {
      if (isEditing) {
        delete payload.project_id;
        await request('/api/tasks/' + draft.task_id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      }
      setDraft(null);
      setNotice(isEditing ? 'Task updated.' : 'Task created.');
      await loadData(false);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(task, changes) {
    setPageError('');
    setNotice('');
    try {
      await request('/api/tasks/' + task.task_id, { method: 'PATCH', body: JSON.stringify(changes) });
      if (changes.status === 'in_review') setNotice('Sent “' + task.title + '” to the project lead for review.');
      else if (changes.status === 'completed' && task.status === 'in_review') setNotice('Approved “' + task.title + '”.');
      else if (task.status === 'in_review' && changes.status === 'in_progress') setNotice('Sent “' + task.title + '” back for changes.');
      else setNotice('Task updated.');
      await loadData(false);
    } catch (error) {
      setPageError(error.message);
    }
  }

  const openCount = tasks.filter((task) => task.status !== 'completed').length;
  const completedCount = tasks.filter((task) => task.status === 'completed').length;
  const overdueCount = tasks.filter((task) => task.due_date && task.due_date < localToday() && task.status !== 'completed').length;

  return (
    <main className="tasks-main">
      <div className="tasks-intro">
        <div>
          <p className="eyebrow eyebrow-light">TASKS</p>
          <h1>Keep the next steps clear</h1>
          <p>Plan assignments, follow due dates, and update work as it moves forward.</p>
        </div>
        <div className="tasks-summary" aria-label="Task totals">
          <div><strong>{tasks.length}</strong><span>Visible tasks</span></div>
          <div><strong>{openCount}</strong><span>Open</span></div>
          <div><strong>{completedCount}</strong><span>Completed</span></div>
          <div><strong>{overdueCount}</strong><span>Overdue</span></div>
        </div>
        <button className="secondary-action tasks-back-action" type="button" onClick={onBack}>Back to overview</button>
      </div>

      <div className="tasks-toolbar">
        <div className="task-filters">
          <label className="visually-hidden" htmlFor="task-search">Search tasks</label>
          <input id="task-search" type="search" placeholder="Search tasks, projects or people…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <label className="visually-hidden" htmlFor="task-project-filter">Filter by project</label>
          <select id="task-project-filter" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="all">All projects</option>
            {projectOptions.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_name}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="task-status-filter">Filter by status</label>
          <select id="task-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(taskStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="task-priority-filter">Filter by priority</label>
          <select id="task-priority-filter" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">All priorities</option>
            {Object.entries(priorityLabels).map(([priority, label]) => <option key={priority} value={priority}>{label}</option>)}
          </select>
        </div>
        <div className="task-toolbar-actions">
          {canManageTasks && (
            <button className="primary-action" type="button" onClick={() => openCreateForm()} disabled={optionsLoading || manageableProjects.length === 0}>
              {optionsLoading ? 'Loading…' : '+ New task'}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="success-notice" role="status">{notice}</div>}
      {pageError && <div className="inline-alert page-alert" role="alert">{pageError}</div>}
      {draft && (
        <TaskForm
          value={draft}
          user={user}
          projects={projects}
          people={people}
          saving={saving}
          optionsLoading={optionsLoading}
          error={formError}
          onChange={updateField}
          onProjectChange={changeProject}
          onCancel={() => { setDraft(null); setFormError(''); }}
          onSubmit={saveTask}
        />
      )}

      {optionsLoading && !draft && <div className="task-options-loading">Loading project members…</div>}
      {loading ? (
        <div className="tasks-loading"><span className="loading-spinner" />Loading tasks…</div>
      ) : visibleTasks.length === 0 ? (
        <div className="tasks-empty">
          <span className="task-empty-icon" aria-hidden="true">✓</span>
          <h2>{tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}</h2>
          <p>{tasks.length === 0
            ? (canManageTasks ? 'Create a task in one of your projects and assign an owner.' : 'Tasks assigned to your project will appear here.')
            : 'Try another search or filter.'}</p>
          {canManageTasks && tasks.length === 0 && manageableProjects.length > 0 && (
            <button className="primary-action" type="button" onClick={() => openCreateForm()}>Create your first task</button>
          )}
          {canManageTasks && manageableProjects.length === 0 && (
            <p className="form-hint">You need to be the lead of an active project before adding tasks. An administrator creates projects and assigns leads.</p>
          )}
        </div>
      ) : (
        <section className="tasks-grid" aria-label="Tasks">
          {visibleTasks.map((task) => (
            <TaskCard
              key={task.task_id}
              task={task}
              allUsers={allUsers}
              onEdit={openEditForm}
              onTaskUpdate={updateTask}
              onRefresh={() => loadData(false)}
            />
          ))}
        </section>
      )}
    </main>
  );
}
