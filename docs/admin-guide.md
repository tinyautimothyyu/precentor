# Admin guide

What an admin does once the app is running: the first-time setup right after a deploy,
then the routine work (approving people, managing teams, tidying tags, checking
backups).

It applies to every setup: [AWS](aws-deploy.md), [a VPS](staging.md) or
[a home PC](home-server.md). Commands use the `dc` shortcut that each of those guides
sets up (Docker Compose with the right files); run them on the server.

Almost everything happens in Django admin at `https://<your domain>/admin/`. The app's
own pages are for browsing songs and building services. Admin is where accounts,
teams and clean-up live.

## Who can do what

| Action | Anonymous | Volunteer (approved) | Leader (approved) | Admin (staff) |
|---|---|---|---|---|
| Browse/search, view song details and lyrics | ✅ | ✅ | ✅ | ✅ |
| Download sheet files | ❌ | ✅ | ✅ | ✅ |
| Create songs, lyrics, sheets and services | ❌ | ❌ | ✅ (owned by their team) | ✅ |
| Edit or delete content | ❌ | ❌ | ✅ only their team's | ✅ any |
| Approve users, assign roles and teams | ❌ | ❌ | ❌ | ✅ |

Content belongs to a **team**, not to a person. When someone leaves, their team's songs
and services stay.

## First-time setup (once, right after the first deploy)

### 1. Create your admin account

```bash
dc exec web python manage.py createsuperuser
```

It asks for a username, an email (optional) and a password. Store the password in a
password manager. A superuser is automatically an **approved leader**, but has **no
team** yet.

### 2. Create your congregation and teams

**Do this before inviting anyone.** The signup form asks people to pick a congregation
and a team from what exists, so with none they can't choose.

In admin, open **Catalog → Congregations → Add congregation**:

- **Name**, e.g. "Grace Church".
- **Primary language** and any **additional languages**.
- **Bilingual display default** and **default sheet format**: what new services use
  unless a team changes it.
- Add the **teams** in the *Teams* rows at the bottom of the same page, e.g. "Sunday AM
  band" and "Youth". Names must be unique within a congregation. *Rotation schedule* is
  optional free text.

You can also add teams later under **Catalog → Teams**.

### 3. Give yourself a team

Open **Accounts → Memberships**, click your username, set **Congregation** and
**Team**, and save. Without a team you can browse and approve people, but you **can't
create services or mark preferred sheets**. You'll see "You must belong to a team to
create a service."

### 4. Check the basics

- `https://<your domain>/healthz` shows `{"status": "ok", "database": true}`.
- Log in to the app itself (not admin) with your superuser and open **Congregations**.
  Your congregation and teams are listed.
- Backups are scheduled: see [Backups](#backups) below.

Don't run `seed_demo` on a production server. It adds sample songs whose two PDFs are
empty placeholders that can't be opened. It's meant for test servers only.

### 5. Invite people

Send them `https://<your domain>/signup`. There they choose a username and password, and
**request** a role (Volunteer or Leader), a congregation and a team. Their account is
**pending** until you approve it. Until then they can only browse public song details.

## Routine work

### Approve new signups

Open **Accounts → Memberships** and filter by **is approved: No**.

1. **Check who it is.** Signups are open to anyone with the link. Only approve people
   you recognise.
2. **Check the requested role.** Anyone can *ask* to be a Leader. Leaders can create,
   edit and delete their team's songs, sheets and services, so give it only to people
   who prepare services. Everyone else is a Volunteer (they can browse and download).
   You can change the **Role** directly in the list.
3. **Check congregation and team.** Click the member to change them. Keep them
   consistent: the team must belong to the chosen congregation.
4. **Approve:** tick the **Is approved** box in the list and click **Save**, or select
   several rows and use the action **Approve selected members → Go**.

They see the change the next time they log in.

### Change someone's role or team

Same place: **Accounts → Memberships**, click the member. Moving someone to another
team changes what they can edit from then on. Content their old team owns stays with
that team.

### Remove someone's access

| You want to… | Do this |
|---|---|
| Take away downloads and editing, keep the account | Memberships → untick **Is approved** |
| Stop them logging in at all | **Authentication and Authorization → Users** → the user → untick **Active** |
| Delete the account | Users → the user → **Delete**. Their team's content stays |

Prefer **untick Active** over deleting. It's reversible and keeps the history.

### Reset a forgotten password

The app doesn't send email, so people can't reset their own password. Go to
**Authentication and Authorization → Users** → the user, use the password-change link
or button under **Password**, set a temporary password and tell them in person.

### Add another admin

**Users** → the user → tick **Staff status** *and* **Superuser status** → **Save**.

- Staff status alone lets them log in to admin but see nothing until given permissions.
  Superuser gives everything.
- Staff can edit any team's content in the app, but still need a **team** on their
  membership to create services.

Keep admins few. They can see and change everything, including other people's access.

### Tidy up tags

Leaders can create their own tags while adding songs. Over time you get near-duplicates
("Christmas", "christmas", "Xmas"). Under **Catalog → Tags**:

- **Recategorise** a custom tag straight from the list (*Category*: Theme, Scripture
  reference, Season, Language, Mood or Custom), then **Save**.
- **Merge duplicates:** search for them, tick two or more, choose **Merge selected tags
  into one → Go**. Their songs move to one tag and the others are deleted. The tag that
  stays is a non-custom one if any is selected, otherwise the oldest. Rename it
  afterwards if needed.

The *Songs* column shows how many songs use each tag, which helps decide what to merge.

### Fix content

Admins can edit anything under **Catalog**: songs (with their lyrics, sheets and
alignments inline), services and flows. For a single wrong field it's usually quicker
to ask the owning team's leader to fix it in the app.

### Backups

Each setup guide schedules a nightly database dump into `~/backups` (see
[staging.md step 9](staging.md#9-backups)). Once a month:

```bash
ls -lh ~/backups | tail -5     # recent db-YYYY-MM-DD.sql.gz files, not 0 bytes
df -h /                        # keep the disk under ~70% (see aws-deploy.md troubleshooting)
```

Copy a recent dump off the server now and then (e.g. `scp` it to your Mac). A backup
that only lives on the server is lost along with the server.

A **test restore** is the only way to know the backups work. Try one on a test server
or your own machine at least once, following the restore steps in staging.md step 9.

### Updates and outages

- **App updates** deploy themselves when a PR is merged ([aws-deploy.md](aws-deploy.md#day-to-day)).
  Nothing to do in admin. New migrations run on start.
- **If the site is down:** check `https://<your domain>/healthz`, then on the server
  `dc ps` and `dc logs --tail 50 web`. The setup guides' troubleshooting sections cover
  the common causes.

## Common questions

| Someone says… | Likely cause | Fix |
|---|---|---|
| "I signed up but can't download sheets" | Still pending | Approve them (Memberships) |
| "I can't add a song" | They're a Volunteer, or not approved | Change role to Leader if appropriate |
| "You must belong to a team to create a service" | No team on their membership | Set congregation and team (Memberships) |
| "I can't edit this song" | It belongs to another team | Expected. They can add their own translation or sheet, or ask that team |
| "My team isn't in the signup list" | The team doesn't exist yet | Add it under Catalog → Teams; they can pick it, or you set it when approving |
| "I forgot my password" | No email reset | Users → set a temporary password |
