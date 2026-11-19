# Internal Project & Task Management System (IPTMS)

IPTMS uses React for the interface, Node.js/Express for the API, and MySQL for data. It includes sign-in, sign-out, session handling, an administrator people-and-teams area, and a role-aware landing page. The sign-in preview card is illustrative; its project numbers are not read from the database.

Project folders:

- `frontend/` — React application and Vite configuration.
- `backend/` — Express API, MySQL connection, authentication, and first-admin setup.

## Run locally with XAMPP MySQL

1. Install Node.js 20.19+ or 22.12+ and npm. The current Vite release requires one of those Node versions.
2. In XAMPP Control Panel, start **MySQL**. Apache is not needed for the React development server.
3. In this project folder, copy `.env.example` to `.env`.
4. Edit `.env` if needed. The defaults point to XAMPP MySQL at `127.0.0.1:3306`, database `iptms_db`, user `root`, and a blank password. Set `DB_PASSWORD` if your MySQL root account has a password.
5. Replace `SESSION_SECRET` with a long random value. In PowerShell, you can generate one with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. In PowerShell, install the JavaScript packages, then create the first administrator account:

   ```powershell
   npm install
   npm run create-admin
   ```

   The account details are entered in the terminal; the password is hidden while you type. This setup command only works while the `users` table is empty.

7. Start the app:

   ```powershell
   npm run dev
   ```

8. Open `http://localhost:5173` in your browser. The React app runs on port 5173 and the API on port 3001; Vite forwards `/api` requests to Node.

After signing in as an administrator, choose **Manage people** to create and edit accounts and teams. New account passwords must be at least 10 characters; the application stores a bcrypt hash. Administrators can set a role, department, designation, reset a password, and deactivate an account. Inactive accounts cannot sign in and are removed from active team, project, and task assignments. Reassign their owned projects before deactivating them.

The Teams tab creates and edits teams, chooses an active administrator or project lead, and assigns active users as members. Accounts are managed by administrators; public sign-up is not available.

The workspace overview shows live counts for projects, open and overdue tasks, and completed work. It also summarizes task statuses, project progress, and the next open tasks for projects or tasks the signed-in user can access.

The Projects area is available from the workspace dashboard. Only administrators create projects and assign the project lead. Members can be added as a whole team at once (choose a team and press **Add team**) and individual people can be ticked now or added later. Project leads edit the projects they lead and manage members, but cannot change the lead. Users see projects they lead or belong to. Project progress is calculated automatically as the average of each task's progress percent.

The Tasks area lets administrators and project leads create and edit tasks in projects they manage. Tasks have an owner, optional contributors, priority, status, estimated hours, progress, and dates. Project members can view project tasks. Assigned employees update each task's status and percent done from the task card. When the work is done they move it to **In review**; the project lead then chooses **Approve & complete** or **Send back** (returns it to In progress). Only the project lead or an administrator can mark a task Completed or reopen it.

Assigned employees can also use **Request a member** on a task and give a reason (for example, a skill they need). The project lead sees pending requests on the task card, chooses who to add, and approves or declines. Approved people are added to the project (if needed) and to the task as contributors. The requester and the added person are notified. Project leads and administrators can add subtasks, and task assignees can update subtask status and progress. Progress is calculated from subtask work when subtasks exist.

Each task card has a **Comments & files** section for its discussion and attachments. Users who can view the task can comment and upload files; users can edit their own comments and remove their own uploads. Administrators and the project lead can edit any comment or remove any attachment in their project. Attachments are limited to 10 MB and supported PDF, image, text, CSV, Office, or ZIP files. The database stores file details, while uploaded file contents are saved under `uploads/task-attachments/` in the project folder; this folder is ignored by Git.

The **Team activity** card opens a feed of project and task changes visible to the signed-in user, along with their private notifications. New project members, task assignees, and subtask assignees are notified, and task participants receive notifications when a comment is posted. Notifications can be marked read one at a time or all at once. Activity and notification records use the existing `activity_logs` and `notifications` tables; no schema changes are needed.

## Database expectations

The login API matches the XAMPP schema: `users` contains `user_id`, `name`, `email`, `password`, `role`, and `status`. Roles are `admin`, `project_lead`, or `employee`; active users have status `active`. Passwords are bcrypt hashes, and PHP bcrypt hashes using the `$2y$` prefix are accepted. Public registration is not included.

The API's `/api/health` endpoint reports whether the Node server can reach MySQL. Database connection settings are read from `.env` by `backend/db.js`.

## Production note

For local development, sessions use Express's in-memory store. Before deployment, configure a persistent session store and HTTPS cookies.
