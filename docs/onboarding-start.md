# Recording the onboarding starting point

The Tests tab can show what new signups do after the new onboarding: which starting point they pick
(**Import existing data / Try sample data / Create a company / Create an invoice**), whether they do
something real, whether they activate, whether they come back, and whether they pay.

Everything except the starting point is already derived from data the dashboard reads. The starting
point is the one thing only the main NorthBooks app knows, so it has to save it.

## 1. Add one column (Supabase SQL editor)

```sql
alter table public.profiles add column if not exists onboarding_start text;
-- no index needed; the dashboard reads it with the secret key (RLS doesn't apply)
```

Use any column name you like; put it in `.env.local` / Vercel:

```
ONBOARDING_START_COLUMN=onboarding_start
```

Restart the dashboard. The Tests tab shows a "column wasn't found" notice until the column exists.

## 2. Save the choice in the app (when they click a starting point)

Store a short, stable value. The dashboard maps anything containing these words, so any of these work:
`import`, `sample` (or `demo`), `company`, `invoice`.

```ts
// when the user picks a card on the new onboarding screen
await supabase
  .from("profiles")
  .update({ onboarding_start: "import" /* | "sample" | "company" | "invoice" */ })
  .eq("id", user.id)
  .is("onboarding_start", null);   // keep the FIRST choice; don't overwrite if they wander back
```

If you'd rather keep the full history of every choice, make a separate events table later —
the dashboard only needs the first choice per person.

## 3. (Recommended) also send a GA4 event, with no personal data

```ts
track("onboarding_start_selected", { choice: "import" });   // docs/ga4/analytics.ts
```

## What the Tests tab counts

| Step | Meaning |
|---|---|
| Signed up | Created an account in the window |
| Chose a starting point | `onboarding_start` is set |
| Did something | Created a company, products or projects, or did any core task |
| Activated | Created an invoice, tracked an expense or uploaded a bank statement |
| Came back within 7 days | Logged in on a later day within 7 days of signing up |
| Paid | Paying today |
| Disappeared | At least 7 days old, did nothing and never came back |

"Came back" and "Disappeared" only count signups at least 7 days old, because younger ones can still return.
Create the test with **What are you trying to move? → Better activation**, set its start date to the
day the new onboarding went live, and the dashboard compares people who signed up during it with the
same number of days before.
