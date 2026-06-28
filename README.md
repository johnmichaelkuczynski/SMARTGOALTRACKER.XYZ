# 🗓️ GOAL TRACKER

**A Calendar-Based To-Do Tracker with Honest Follow-Through Analytics**

---

## 🧩 Overview

Tally is a personal calendar app built around a single uncomfortable question: *of the things you said you were going to do, how many did you actually do?*

It works like Google Calendar — write down what you intend to do on a given day, set tasks to repeat daily, weekly, or monthly, and navigate by date through a month-grid calendar. But unlike Google Calendar, every day has **two columns** side by side: a **To Do** column for what you intended, and a **Completed** column for what actually happened. Items move from left to right as the day unfolds.

Tally also extends past the daily horizon — it tracks **medium-term goals** (e.g. publish a peer-reviewed article) and **long-term goals** (e.g. get a PhD), with the user deciding what chronologically counts as each. And it adds something Google Calendar refuses to: a running, honest completion percentage at the top of every page, plus deeper analytics that break down follow-through by time frame and importance level. No padding, no spin, no flattering summaries.

---

## 👥 Who It's For

- **Graduate students and researchers** -- need to track daily writing alongside multi-year dissertation goals and see whether the daily work is actually feeding the long-term work
- **Self-improvers and habit builders** -- need an unforgiving mirror that shows whether daily intentions are being honored over weeks and months, not just remembered
- **Project-driven professionals** -- need to hold both day-level execution and quarter/year-level milestones in one place, with deadlines that don't get lost
- **People who set goals and then forget them** -- need a system where long-term goals stay visible while daily tasks get done, instead of one displacing the other
- **Anyone tired of productivity apps that pretend** -- who wants raw completion percentages instead of streak badges, motivational quotes, and gamified nonsense

---

## ⚙️ Core Capabilities

- **Two-Column Day View** -- Every day shows a **To Do** column and a **Completed** column side by side. Items start on the left and move to the right when checked off, with smooth animation. Reopen any item to move it back. A mini month-calendar on the left indicates which days have tasks and which were fully completed.

- **On a Day vs By a Day Scheduling** -- Every task is scheduled either *on* a specific day (it appears that day only) or *by* a specific day (it has a deadline). "By" tasks get a dedicated **Due By** board that sorts every pending deadline from overdue → today → upcoming, so nothing slips just because it wasn't on today's list.

- **Recurring Tasks** -- Tasks can repeat **daily**, **weekly**, or **monthly**, with an optional end date. Each occurrence is completed independently, so a recurring habit can be done some days and missed others — and the analytics see all of it.

- **Medium-Term and Long-Term Goals** -- Goals are first-class tasks with their own page, separated into medium-term and long-term sections. The user picks the target date — Tally does not assume what counts as either. Each goal shows a progress bar based on time elapsed toward the target, days remaining, and a status of *In progress*, *Achieved*, or *Missed*.

- **Optional Importance Levels (1–10)** -- Any task — daily, medium-term, or long-term — can carry an importance rating from 1 to 10. It's optional by design. Set it when it matters; leave it off when it doesn't.

- **Running Completion Rate** -- A live overall completion percentage sits at the top of every page, alongside per-time-frame rates for daily, medium, and long. Recalculated on every change. No averaging tricks, no exclusions beyond what's analytically sound.

- **Three-Dimensional Analytics** -- A dedicated analytics page breaks down completion three ways: **overall**, **by time frame** (daily / medium / long), and **by importance level** (1 through 10). Importance-level analytics tell you whether the things you said mattered most actually got done — or whether you've been quietly burying your priorities.

- **Fair Analytics Math** -- Future-dated "on" tasks don't drag down the percentage (they can't be failed yet). "By" tasks count as missed only after their deadline passes without completion. Recurring tasks are counted per-occurrence, not per-template, so missing one Tuesday doesn't ruin the whole habit.

- **Local-First Persistence** -- Everything is saved to browser local storage. No accounts, no sign-up, no server-side anything. Open the page, start using it, your data stays with you.

- **Quick Add From Anywhere** -- A persistent **Add** button in the header opens a form for title, time frame, schedule type, date, optional recurrence, optional importance slider, and notes. Always one click away.

---

## 🎯 What Makes It Different

- **Two columns, not one** -- The single biggest departure from Google Calendar. The to-do column is intention; the completed column is reality. Holding both side by side, day after day, is what makes the completion rate at the top mean something.

- **It tells you the truth in percentages** -- Most calendar and habit apps reward you with streaks, stars, and emojis. Tally gives you a number. If your overall completion rate is 38%, that's what it says.

- **Long-term goals live in the same app** -- Calendar apps handle today. Goal apps handle "someday." Tally refuses to separate them, because the whole point is to see whether daily behavior is feeding multi-year ambition.

- **The user defines the time horizons** -- Tally has medium-term and long-term goals, but it does not declare what either means. Three months might be medium-term for one person and long-term for another. The user sets the date. The app holds it.

- **Optional importance, weaponized in analytics** -- Importance is voluntary, but the moment you start using it, the analytics surface a brutal question: *are you completing your 10s, or your 3s?* Most people discover they're great at the easy ones and quietly avoiding the hard ones.

- **"By a day" is a first-class scheduling mode** -- Google Calendar only lets you say what you're doing *on* a day. Tally lets you say what's due *by* a day, and surfaces every such item in one ranked list at the top of the **Due By** page, sorted by urgency.

- **Deadlines do not get forgotten** -- A "by" task remains visible on every applicable day until it's done or the deadline passes. It doesn't disappear because you scrolled past it.

- **No accounts, no cloud, no nonsense** -- All state lives in your browser. The app loads instantly, persists locally, and never asks for an email address.

- **Calm typography, considered color** -- The interface is built to feel like a private journal you actually want to open every morning, not an enterprise productivity dashboard. Warm ink-on-paper palette, serif headings, deliberate restraint.

---

## 🛠️ Stack

- **React + Vite** -- Frontend framework and build tool
- **TypeScript** -- Type-safe application logic throughout
- **Tailwind CSS + shadcn/ui** -- Design system and component primitives
- **date-fns** -- All date arithmetic, recurrence math, and formatting
- **Recharts** -- Completion-rate bar charts on the analytics page
- **Framer Motion** -- Layout animations for tasks moving between columns
- **Wouter** -- Lightweight client-side routing
- **LocalStorage** -- Single-key persistence under `tally:v1`

---

## 📂 Project Structure

```
artifacts/calendar-todo/
├── src/
│   ├── App.tsx                  # Router + layout shell
│   ├── components/
│   │   ├── AppLayout.tsx        # Header, nav, running stats, Add button
│   │   ├── AddTaskDialog.tsx    # Task creation form
│   │   └── TaskRow.tsx          # Single task item with check-off animation
│   ├── pages/
│   │   ├── DayView.tsx          # Two-column day view + mini calendar
│   │   ├── Upcoming.tsx         # "Due By" deadline board
│   │   ├── Goals.tsx            # Medium- and long-term goals
│   │   └── Analytics.tsx        # Completion-rate charts and breakdowns
│   ├── lib/
│   │   ├── types.ts             # Task, Completion, Timeframe, etc.
│   │   ├── storage.ts           # LocalStorage store + React subscription
│   │   ├── recurrence.ts        # Occurrence generation for repeating tasks
│   │   ├── analytics.ts         # Completion-rate computation
│   │   └── seed.ts              # First-run sample data
│   └── index.css                # Color tokens (light + dark)
```

---

## 🚀 Running Locally

From the project root:

```bash
pnpm install
pnpm --filter @workspace/calendar-todo run dev
```

Then open the URL printed in the console. The app initializes with a small set of sample tasks on first run; clear them from the **Analytics** page using *Clear all*, or restore them with *Reset to sample*.
