# WAK Solutions Agent Dashboard — User Guide

This guide walks you through every screen in the WAK Solutions agent dashboard. It is written for customer service agents and team managers — no technical knowledge needed.

---

## Table of Contents

1. [Signing In](#1-signing-in)
2. [The Dashboard (Chat View)](#2-the-dashboard-chat-view)
3. [Inbox](#3-inbox)
4. [Reading and Replying to a Chat](#4-reading-and-replying-to-a-chat)
5. [Meetings](#5-meetings)
6. [Agents (Admin Only)](#6-agents-admin-only)
7. [Statistics](#7-statistics)
8. [Surveys](#8-surveys)
9. [Chatbot Config (Admin Only)](#9-chatbot-config-admin-only)
10. [Common Workflows](#10-common-workflows)
11. [Mobile Use](#11-mobile-use)

---

## 1. Signing In

![Screenshot](screenshots/01-login.png)

### What this page is for

This is the front door to the dashboard. Only authorised agents and admins can log in.

### How to sign in

1. Open the dashboard link in your browser.
2. Enter your **email address** in the Email field (e.g. `yourname@wak-solutions.com`).
3. Enter your **password**.
4. Click **Sign In**.

If your credentials are correct you will land on the Dashboard automatically. If you see an error message, double-check your email and password and try again. Contact your admin if you are locked out.

### Signing in with Face ID or Fingerprint (Biometric)

If you have already set up biometric login on this device, a **"Sign in with Face ID / Fingerprint"** button appears at the top of the form. Tap it and follow your device's prompt — no password needed.

> **To set up biometrics for the first time:** Sign in with your password, then click **Biometric** in the top navigation bar. Follow the on-screen prompt. After that, you can use Face ID or your fingerprint on this device.

### Tips

- The Email field can be left blank if you are the legacy admin account (password-only login).
- Each agent has their own email and password — do not share credentials.
- Sessions stay active for as long as you remain logged in. Use **Logout** in the header when you are done.

---

## 2. The Dashboard (Chat View)

![Screenshot](screenshots/02-dashboard.png)

### What this page is for

This is the main working screen for agents. On the left is a list of active conversations. On the right is the chat thread for whoever you have selected.

### The header bar

The green bar at the top is visible on every page. It shows:

- **WAK Solutions logo** — click to go back to the dashboard from any page.
- **Connection status** — a green pulsing dot means you are online and receiving updates. A yellow dot means the connection is being re-established.
- **Navigation links** — quick access to Inbox, Agents, Statistics, Meetings, Chatbot Config, Surveys, and the Guide. On mobile these collapse into a hamburger menu (☰).
- **Biometric** — set up Face ID / fingerprint login.
- **Logout** — ends your session.

### The conversation sidebar (left panel)

- Lists all open customer chats.
- Each card shows the customer's phone number, a short preview of the last message, and how long ago it arrived.
- Click any card to open that conversation on the right.
- On mobile, the sidebar fills the screen. Tap a conversation to open it. Tap the back arrow to return to the list.

### Tips

- The sidebar refreshes automatically every few seconds. You do not need to reload the page.
- If the sidebar is empty, there are no open chats at the moment.

---

## 3. Inbox

![Screenshot](screenshots/03-inbox.png)

### What this page is for

The Inbox is a structured view of everything that needs attention: unassigned customer chats, chats assigned to you, and upcoming meetings. Think of it as your to-do list for the day.

### The three tabs

| Tab | What it shows |
|---|---|
| **Shared Inbox** | Chats and meetings that are not yet assigned to any agent. Anyone can claim these. |
| **My Chats** | Chats and meetings that are assigned specifically to you. |
| **All** *(admin only)* | Every open chat and upcoming meeting across all agents. |

Each tab has a number badge showing how many items are inside.

### Chat cards

Each chat card shows:
- The customer's **phone number**
- A **status badge** (Open, In Progress, Resolved)
- The **escalation reason** (why the bot handed off to a human)
- How long ago the chat started
- If it is in the All tab: which agent it is assigned to, or "Unassigned"

### Meeting cards

Meeting cards have a blue border and a 📅 calendar icon to distinguish them from regular chats. Each shows:
- Customer phone number
- "Meeting" badge + status (Upcoming, In Progress, Completed)
- The scheduled date and time in KSA time
- The assigned agent (or "Unassigned")

Click **View** on a meeting card to see the full details and the meeting link.

### Claiming a chat

In the **Shared Inbox** tab, each unassigned chat has a green **Claim** button.

1. Click **Claim** on the chat you want to take.
2. The chat moves out of Shared Inbox and into **My Chats**, assigned to you.
3. Click **Open** to go directly to that conversation.

### Opening a chat

In **My Chats** or **All**, click **Open** to jump to the chat thread on the main dashboard.

### Linked meetings

If a customer has both an active chat AND a booked meeting, a blue pill appears at the bottom of their chat card:

> 📅 Meeting · 15 Apr 2025 · 10:00

Click that pill to see the meeting details without leaving the inbox.

### Refreshing

Click the **↺ refresh** button in the top-right corner to manually reload all items. The inbox also refreshes automatically every 15 seconds.

---

## 4. Reading and Replying to a Chat

![Screenshot](screenshots/04-chat-thread.png)

### What this page is for

This is the live chat view. The customer's messages appear on the left; the bot's and agent's replies appear on the right.

### Reading the conversation

- Messages are displayed in order from oldest to newest.
- Each message shows who sent it: **Customer**, **AI**, or the agent's name.
- Timestamps are shown for each message.

### Replying as an agent

1. Click the text input at the bottom of the chat.
2. Type your message.
3. Press **Enter** or click **Send**.

Your reply is sent to the customer via WhatsApp immediately. It appears in the chat thread labelled with your name.

### Taking over from the bot

The AI bot handles conversations automatically until a customer requests a human agent or a trigger condition is met. When a chat appears in the dashboard, the bot has already handed off and you are expected to take over.

Simply start typing — your messages go directly to the customer.

### Closing a conversation

When the issue is resolved:

1. Read through the conversation to confirm nothing is outstanding.
2. Click the **Close** or **Resolve** button (usually at the top of the chat panel).
3. The chat status changes to **Resolved** and it is removed from the active list.
4. A satisfaction survey may be sent to the customer automatically.

### Tips

- You can scroll up in the chat to read the full conversation history, including everything the bot said before you took over.
- If you need to pass the chat to a colleague, ask your admin to reassign it via the Agents tab or the inbox claim system.

---

## 5. Meetings

![Screenshot](screenshots/05-meetings.png)

### What this page is for

The Meetings page shows all video meetings that customers have booked. It also lets you manage which time slots are available for booking.

---

### Part A — Meeting list

#### Filters

At the top of the page, three filter buttons let you narrow the list:

| Button | What it shows |
|---|---|
| **All** | Every meeting ever created |
| **Upcoming** | Meetings that are Pending or In Progress |
| **Completed** | Meetings that have been marked as done |

#### What each row shows

| Column | Meaning |
|---|---|
| **Customer** | The customer's WhatsApp number |
| **Meeting Link** | A shortened link to the video room. Click to open it. |
| **Scheduled (AST)** | The booked date and time in KSA / Arabian Standard Time |
| **Agent** | Which agent is handling this meeting, or "Unassigned" |
| **Status** | Pending → In Progress → Completed |

#### Starting a meeting

When a meeting is **Pending** and the time has come:

1. Find the meeting row in the list (use the **Upcoming** filter to narrow it down).
2. Click **Start**.
3. The status changes to **In Progress** and the meeting is now assigned to you.
4. Click the meeting link to open the video room in a new tab.

#### Marking a meeting as complete

When the video call has ended:

1. Find the meeting row (status: In Progress).
2. Click **Mark Complete**.
3. A confirmation prompt appears: *"Mark this meeting as done and send the customer a survey?"*
4. Click **OK**.
5. The meeting status changes to **Completed** and a satisfaction survey is automatically sent to the customer via WhatsApp.

---

### Part B — Manage Availability

Below the meetings table is a weekly calendar grid showing which time slots are open, blocked, or already booked.

#### Reading the grid

| Colour | Meaning |
|---|---|
| **Green (Open)** | This slot is available for customers to book |
| **Red (Blocked)** | You have manually blocked this slot — customers cannot book it |
| **Blue (Booked)** | A customer has already booked this slot |

All times are in KSA time (UTC+3).

#### Blocking a slot

1. Find the slot you want to close off (e.g. Thursday 14:00).
2. Click it.
3. It turns red — **Blocked**.

#### Unblocking a slot

1. Click a red (Blocked) slot.
2. It turns green — **Open** again.

#### Navigating weeks

Use the **← left arrow** and **→ right arrow** buttons to move to the previous or next week. The date range shown in the middle updates as you navigate.

#### Tips

- Block slots during team meetings, prayer times, or holidays so customers cannot book those hours.
- Booked (blue) slots cannot be unblocked — they are already confirmed with a customer.
- Available hours are 07:00–00:00 daily, and 17:00–00:00 on Fridays (KSA).

---

## 6. Agents (Admin Only)

![Screenshot](screenshots/06-agents.png)

### What this page is for

Admins use this page to create and manage agent accounts, and to see a workload overview of the whole team.

---

### Part A — Agent table

Each row shows one agent with:

| Column | Meaning |
|---|---|
| **Agent** | Name and email address |
| **Role / Status** | Admin or Agent · Active or Inactive |
| **Chats Resolved** | Number of chats closed in the selected period |
| **Meetings** | Total meetings completed |
| **Rating** | Average survey score from customers (colour-coded: green ≥ 4, amber 2–3.9, red < 2) |
| **Last Login** | When the agent last signed in |
| **Actions** | Edit, Reset password, Deactivate/Activate |

#### Period filter

Above the table are four buttons:

> **Today** · **This Week** · **This Month** · **All Time**

Selecting a period updates the **Chats Resolved** count for every agent. Meetings completed and ratings always show all-time figures.

#### Creating a new agent

1. Click **New Agent** (top right).
2. Fill in: **Full Name**, **Email**, **Password**, and **Role** (Agent or Admin).
3. Click **Create Agent**.
4. A green confirmation box shows the new agent's password — copy it and share it with them securely. It is only shown once.

#### Editing an agent

1. Click the **✏ Edit** icon (pencil) in the Actions column for that agent.
2. Change the name, email, or role as needed.
3. Click **Save Changes**.

#### Resetting a password

1. Click the **🔑 Reset** icon (key) in the Actions column.
2. Enter a new password (minimum 6 characters).
3. Click **Set New Password**.
4. Share the new password with the agent securely.

#### Deactivating an agent

1. Click the **Deactivate** icon (person with X) in the Actions column.
2. The agent is immediately signed out and cannot log in again until reactivated.
3. You cannot deactivate yourself, and you cannot deactivate the last active admin.

#### Reactivating an agent

Click the **Activate** icon (person with tick) next to an inactive agent to restore their access.

---

### Part B — Workload Overview

Below the agent table is a second table showing real-time workload stats:

| Column | Meaning |
|---|---|
| **Active Chats** | Chats currently open and assigned to this agent |
| **Resolved Today** | Chats closed today |
| **Resolved This Week** | Chats closed since Monday |
| **Total Resolved** | All-time closed chats |
| **Meetings Done** | Total completed meetings |

Use this to spot if one agent is overloaded or if someone needs more chats assigned to them.

---

## 7. Statistics

![Screenshot](screenshots/07-statistics.png)

### What this page is for

Statistics gives you a bird's-eye view of how many customers the team has spoken to over time, with a daily chart and an AI-generated summary of conversations.

### Choosing a time period

Four buttons at the top let you pick the date range:

| Button | What it covers |
|---|---|
| **Today** | Since midnight |
| **This Week** | Since Monday |
| **This Month** | Since the 1st |
| **Custom** | Any start and end date you choose |

For Custom, two date pickers appear. Select your From and To dates and the chart updates automatically.

### Customers Contacted

A large number shows how many **unique customers** contacted the business in the selected period. Below it, a bar chart shows the breakdown day by day — hover over a bar to see the exact count.

### AI Conversation Summary

1. Click **Generate Summary**.
2. Wait a few seconds while the AI reads the conversations from the selected period.
3. A plain-English paragraph appears summarising what customers were asking about, common themes, and any notable patterns.
4. Click **Regenerate** to get a fresh take, or change the date range and generate again.

> **Tip:** Use this after a busy week to write a quick team update or spot recurring issues you can fix proactively.

### Survey Overview

A compact panel shows the active survey's performance:

- **Sent this week** — how many survey links were sent to customers
- **Submitted** — how many customers actually filled it in
- **Avg rating** — the average score out of 5

Click **View Full Results →** to jump to the Surveys page for the full breakdown.

---

## 8. Surveys

![Screenshot](screenshots/08-surveys.png)

### What this page is for

Surveys are sent to customers automatically after a chat or meeting is closed. This page lets you create surveys, manage which one is active, and view the results.

---

### The survey list

Each row shows a survey with:

| Column | Meaning |
|---|---|
| **Title** | The survey name |
| **Qs** | Number of questions |
| **Sent** | How many times it has been sent to customers |
| **Submitted** | How many customers filled it in |
| **Rate** | Submission rate (Submitted ÷ Sent) |
| **Status** | Active (green pulsing dot) or Inactive |

A **Default** badge marks the built-in survey — it cannot be deleted.

### Creating a new survey

1. Click **New Survey**.
2. Enter a **Title** (required) and an optional **Description**.
3. Click **Add Question** to add your first question.
4. Type the question text and choose its type:
   - **Rating (1–5)** — customer picks a number from 1 to 5
   - **Yes / No** — customer answers yes or no
   - **Free Text** — customer types a short answer
5. Add as many questions as you need.
6. Use the **↑ ↓ arrows** to reorder questions.
7. Click the **🗑 bin** icon to remove a question.
8. Click **Save Survey** when done.

### Editing a survey

1. Click the **✏ pencil** icon on any survey row.
2. Make your changes.
3. Click **Save Survey**.

### Activating a survey

Only one survey can be active at a time. The active survey is the one automatically sent to customers.

1. Click the **✓ tick** icon on the survey you want to activate.
2. The previous active survey is deactivated automatically.
3. The new survey shows a green "Active" badge.

### Deactivating a survey

Click the **✗ X** icon on the currently active survey. No survey will be sent to customers until you activate another one.

### Deleting a survey

Click the **🗑 bin** icon and confirm. The default survey cannot be deleted.

### Viewing results

1. Click the **📊 bar chart** icon on any survey.
2. The results view shows:
   - **Total Sent**, **Total Submitted**, **Response Rate** at the top
   - Per-question breakdowns:
     - Rating questions: average score + a bar chart of each rating (1–5)
     - Yes/No questions: yes and no counts with percentage bars
     - Free text questions: all customer answers listed
   - **Agent Satisfaction Breakdown**: average rating per agent

Click the **← back arrow** to return to the survey list.

---

## 9. Chatbot Config (Admin Only)

![Screenshot](screenshots/09-chatbot-config.png)

### What this page is for

This is where you control what the AI bot says and how it behaves in WhatsApp conversations. Changes take effect within 60 seconds — no restart needed.

---

### Business Identity

| Field | What to enter |
|---|---|
| **Business Name** | The company name the bot introduces itself as |
| **Industry / Description** | One line describing what the company does |
| **Tone** | Professional, Friendly, Formal, or Custom |

If you select **Custom** tone, a text box appears where you can describe the exact tone (e.g. *"warm, concise, and empathetic"*).

### Conversation Flow

#### Opening / Greeting Message

The very first message the bot sends to every new customer. This is mandatory — the bot sends it at the start of every new conversation.

#### Qualification Questions

An ordered list of questions the bot walks customers through before proceeding to help them.

**Adding a question:**
1. Click **Add Question**.
2. Type the question text.
3. Choose the answer type:
   - **Free text** — the customer can type anything
   - **Yes / No** — the customer answers yes or no
   - **Multiple choice** — you define specific options (click **Add choice** to add each one)
4. Drag the **⠿ grip handle** on the left to reorder questions.
5. Click the **🗑 bin** icon to remove a question.

#### Closing Message

What the bot says when wrapping up a conversation.

### Knowledge Base (FAQ)

A list of question-and-answer pairs. The bot uses these to answer common customer questions accurately.

**Adding a Q&A pair:**
1. Click **Add Q&A Pair**.
2. Type the **Question** (what customers typically ask).
3. Type the **Answer** (what the bot should say).
4. Click the **🗑 bin** to remove a pair.

### Escalation Rules

A list of conditions that trigger a handover to a human agent. When any of these are detected in a customer message, the chat is automatically escalated.

**Adding a rule:**
1. Click **Add Rule**.
2. Type the condition (e.g. *"Customer asks for a refund"* or *"Customer mentions a complaint about delivery"*).
3. Click the **🗑 bin** to remove a rule.

### Saving your changes

Click **Save & Apply** at the bottom of the page. The bot picks up the new configuration within **60 seconds** — no restart needed.

Click **Reset to Default** to revert the structured fields to the original WAK Solutions defaults.

### Advanced: Raw Prompt (for technical users)

Click **Advanced: Raw Prompt** at the bottom to expand a collapsible section.

- When **Raw Override is OFF** (default): the panel shows a **read-only preview** of the exact text the bot receives, compiled automatically from your structured fields above. This is useful to check what the bot actually sees.
- When **Raw Override is ON**: a warning banner appears (*"Structured fields are being ignored"*) and the text area becomes editable. You can type or paste any custom system prompt. What you type here is sent directly to the AI, bypassing all structured fields.

> **Tip for managers:** Leave Raw Override OFF and use the structured fields. The preview panel lets you confirm everything looks correct before saving. Raw override is for technical teams who need precise control.

---

## 10. Common Workflows

### Taking over a chat from the bot

1. Go to the **Inbox** → **Shared Inbox** tab.
2. Find the customer's chat card and click **Claim**.
3. Click **Open** (or find the conversation in the Dashboard sidebar).
4. Read the conversation history to understand the context.
5. Type your reply and send it.
6. When resolved, close the chat.

### Responding to an escalation

When a customer requests a human agent via WhatsApp:

1. You will receive a **push notification** on your device.
2. Open the dashboard and go to the **Inbox**.
3. The escalation appears in **Shared Inbox** (if unassigned) or **My Chats** (if it was routed to you).
4. Claim it (if unassigned), read the context, and reply to the customer.

### Closing a case

1. Read through the chat to confirm the issue is fully resolved.
2. Click **Resolve** / **Close** in the chat view.
3. The chat moves to resolved status.
4. A survey is automatically sent to the customer asking them to rate the service.

### Booking a meeting for a customer

Customers book their own meetings via a link sent by the bot. However, as an agent you can:

1. Go to **Meetings** → **Manage Availability**.
2. Make sure the relevant time slots are **Open** (green).
3. Ask the customer to use the booking link the bot sent them (they receive it in WhatsApp).
4. Once they book, the meeting appears in the Meetings table.

### Starting and completing a meeting

1. Go to **Meetings** → filter by **Upcoming**.
2. Find the meeting row.
3. Click **Start** when it's time. This assigns the meeting to you and marks it In Progress.
4. Click the meeting link to open the video room.
5. After the call ends, click **Mark Complete**.
6. The customer receives a survey automatically.

### Checking how the team is doing

1. Go to **Statistics**.
2. Select **This Week** or **This Month**.
3. Check the **Customers Contacted** count and daily bar chart.
4. Click **Generate Summary** to get an AI written overview of what customers were asking about.
5. Go to **Agents** to see individual resolved chat counts and survey ratings.
6. Go to **Surveys → Results** to see detailed satisfaction scores per question and per agent.

### Blocking time off in the calendar

1. Go to **Meetings** → scroll down to **Manage Availability**.
2. Navigate to the correct week using the arrow buttons.
3. Click each slot you want to close (they turn red / Blocked).
4. Customers will not be able to book those slots.

### Updating the chatbot instructions

1. Go to **Chatbot Config**.
2. Update the Greeting Message, Questions, FAQ, or Escalation Rules as needed.
3. Click **Save & Apply**.
4. The bot picks up the changes within 60 seconds.

---

## 11. Mobile Use

![Screenshot](screenshots/10-mobile-inbox.png)

The dashboard is fully usable on a phone browser or as an installed app (PWA).

### Navigation on mobile

On screens smaller than a laptop, the navigation links in the header are hidden. Instead, a **☰ hamburger menu** button appears in the top right.

1. Tap **☰** to open the slide-in menu.
2. Tap any page name to navigate there.
3. Tap outside the menu (the dark overlay) or tap **✕** to close it without navigating.

The active page is highlighted in green inside the mobile menu.

![Screenshot](screenshots/11-mobile-hamburger-menu.png)

### Chat view on mobile

- The sidebar (conversation list) fills the whole screen.
- Tap a conversation to open it — the chat fills the screen.
- Tap the **← back arrow** at the top left to return to the conversation list.

### Push notifications

To get alerts when new customers message or meetings are booked:

1. The first time you visit the dashboard, a banner may appear asking to enable notifications.
2. Click **Enable Notifications** and accept the browser prompt.
3. You will now receive push notifications on this device for new messages and meeting bookings.

> **iOS users:** You must add the dashboard to your Home Screen first. When you see the install prompt, tap **Share → Add to Home Screen**, then open it from your Home Screen. After that, enable notifications.

### Setting up biometric login on mobile

1. Sign in with your password.
2. Open the ☰ menu → tap **Biometric Setup**.
3. Follow your device's Face ID or fingerprint prompt.
4. Next time, tap **Sign in with Face ID / Fingerprint** on the login screen.

---

*WAK Solutions Agent Portal — Internal Guide*
