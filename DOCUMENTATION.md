# Workday AI Job Application Automation
## Project Documentation (Setup, Architecture, AI Strategy, Limitations)

---

## 📌 Executive Summary & Practical Workflow

This project is an AI-powered automation platform that automates multi-step job applications on **Workday ATS** (tested on NVIDIA, Target, and standard Workday portals). 

### How It Works (Step-by-Step Flow):
1. **Resume Upload**: The candidate uploads their resume (PDF or DOCX) in the web dashboard or Chrome extension.
2. **AI Text & Link Extraction**: The system extracts raw resume text, parses embedded clickable URLs (LinkedIn, GitHub, Portfolio), and extracts contact details.
3. **AI Validation & Master JSON Generation**: An **AI Resume Checker Agent** validates the data, fixes date formats (`MM/YYYY`), standardizes degree names, enriches missing fields, and completes missing postal codes via OpenStreetMap.
4. **Extension Field Mapping**: When the user opens a Workday application page, the Chrome Extension scans all form fields, sends the schema to the AI, and generates exact mapping instructions.
5. **Automated DOM Filling**: The extension executes native React event bypasses, types into search comboboxes, selects dropdown options, and dynamically adds multi-entry containers (work experience & education).
6. **Autonomous DOM Error Solver**: If Workday triggers validation errors (e.g., missing phone code, invalid date, empty required fields), the AI inspects the DOM error context, generates targeted fixes, and automatically heals the errors.
7. **Human-in-the-Loop Safety Gate**: On the final review page, the extension pauses and requires explicit candidate confirmation before submitting.

```
[ User Uploads Resume ] 
       │ (PDF / DOCX)
       ▼
[ AI Extraction & Link Parser ]
       │
       ▼
[ AI Resume Checker & JSON Validation ] ──► Standardizes dates, degrees, postal codes
       │
       ▼
[ Chrome Extension Scans Workday DOM ] ──► Detects inputs, comboboxes, dropdowns
       │
       ▼
[ AI Dynamic Field Mapping ] ────────────► Maps profile JSON to Workday fields
       │
       ▼
[ Automated Form Filler ] ───────────────► React event bypass, comboboxes, multi-entries
       │
       ▼
[ AI DOM Error Solver ] ─────────────────► Detects page errors, fixes & heals DOM
       │
       ▼
[ User Safety Confirmation ] ────────────► Final Submit
```

---

## 1. ⚙️ Setup & Installation

### Prerequisites
- **Node.js**: v18+ or v20+
- **Google Chrome** (or Edge/Brave)

### Step 1: Environment Variables
Create a `.env` file in the root folder:
```env
# AI Provider Keys (Groq, Gemini, or OpenAI)
GROQ_API_KEY=gsk_your_groq_key_here
GEMINI_API_KEY=AIza_your_gemini_key_here
OPENAI_API_KEY=sk_your_openai_key_here

# Database (PostgreSQL / Neon)
DATABASE_URL="postgresql://neondb_owner:npg_xqDNZM2V5HOP@ep-dark-queen-axogyqbx-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require"
```
*(Note: If no API key is provided, the platform automatically runs on its built-in rule-based heuristic engine!)*

### Step 2: Run Full-Stack Web App
```bash
# Install dependencies
npm install

# Setup database
npx prisma generate
npx prisma db push

# Start Next.js server (http://localhost:3000 or live Vercel URL)
npm run dev
```

### Step 3: Build & Load Chrome Extension
```bash
# Build extension bundle
npm run build:extension
```
1. Open Chrome and go to `chrome://extensions/`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the folder: `extension/dist`.
4. Pin the extension to your Chrome toolbar.

---

## 2. 🏗️ Architecture

```
workday-ai-automation/
├── app/                        # Next.js Full-Stack Application
│   ├── page.tsx                # Candidate Dashboard UI (Upload, JSON viewer, Mapper)
│   └── api/
│       ├── parse-resume/       # PDF/DOCX parser, hyperlink extractor & AI engine
│       ├── resume-ai-checker/  # Deep verification & JSON validator agent
│       ├── map-fields/         # AI & heuristic Workday field mapper
│       ├── solve-errors/       # Autonomous AI DOM error solver
│       └── health/             # Service health check endpoint
├── lib/
│   ├── aiService.ts            # AI Cascading Engine (Groq -> Gemini -> OpenAI -> Heuristics)
│   └── types.ts                # TypeScript interfaces (CandidateProfile, FormField, Fixes)
└── extension/                  # Chrome Extension (Manifest V3)
    ├── manifest.json           # Extension config & permissions
    └── src/
        ├── popup/App.tsx       # Side panel UI (Upload, auto-fill controls, profile editor)
        └── content/
            ├── workdayDetector.ts   # Detects active step (My Info, Experience, Review)
            ├── workdayParser.ts     # Scrapes form fields & extracts DOM error context
            ├── domFiller.ts         # High-accuracy React event filler & auto error healer
            └── mutationObserver.ts  # Watches dynamic AJAX page transitions
```

---

## 3. 🧠 AI Strategy & Validation Engine

### A. Multi-Pass Extraction & Validation Pipeline
1. **Pass 1 (Contact & Address)**: Extracts name, email, phone, street, city, state, postal code, and country.
2. **Pass 2 (Work Experience & Skills)**: Parses all job titles, company names, dates, responsibilities, projects, and technologies.
3. **Pass 3 (Education & Certifications)**: Extracts institutions, degrees, fields of study, graduation dates, and certifications.
4. **Geo-Location Auto-Enrichment**: If a postal code is missing, OpenStreetMap Nominatim automatically resolves the exact postal code using city and state.
5. **Resume AI Checker Agent**: Cross-examines the draft JSON against raw resume text, repairs malformed dates to `MM/YYYY`, normalizes degree aliases (e.g. `B.Tech` -> `Bachelor of Technology`), and produces an audit score (0-100).

### B. Multi-Provider AI Fallback (Zero Downtime)
To prevent failures from rate limits (HTTP 429), the engine automatically cascades:
1. **Groq API** (`llama-3.3-70b-versatile`): Ultra-fast inference (~400ms).
2. **Google Gemini** (`gemini-2.0-flash` / `1.5-flash`): High context window & free tier reliability.
3. **OpenAI** (`gpt-4o-mini`): High-accuracy semantic fallback.
4. **Deterministic Rule Engine**: Regex & semantic dictionary fallback when offline.

---

## 4. ⚡ DOM Automation & Error Solving Rules

### A. React Synthetic Event Synchronization
Workday forms use React. Standard JavaScript assignments (`input.value = "text"`) do not update React state.
- **Solution**: The extension uses native property descriptor setters:
  ```typescript
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  ```

### B. Custom Workday Combobox & Dropdown Handling
Workday listboxes are custom popups (`[aria-haspopup="listbox"]`).
- **Solution**: The extension clicks the dropdown trigger, writes the query into the popup search box, triggers filter events, and selects the matching option element.

### C. Multi-Entry Containers
For candidates with multiple jobs or degrees:
- The extension automatically clicks `+ Add`, waits for the DOM container to render, and fills each block independently without field overlap.

### D. Autonomous DOM Error Healing
When Workday shows red error alerts:
1. `workdayParser.ts` captures the error message and sanitizes the surrounding DOM container HTML.
2. `/api/solve-errors` prompts the AI agent with the candidate profile and DOM HTML.
3. The AI returns targeted fix actions (`select_dropdown`, `set_date_spinbutton`, `fill_input`, `delete_entry`).
4. `domFiller.ts` executes the fixes and re-validates the page automatically.

---

## 5. ⚠️ Limitations

1. **OS File Upload Dialog**: Browser security sandboxes prevent extensions from silently attaching local desktop files to `<input type="file">`. The extension scrolls to the file dropper and alerts the user to attach their resume file.
2. **CAPTCHAs / Bot Detection**: Third-party security challenges (Cloudflare / Arkose) require the candidate to complete the challenge manually before resuming.
3. **Unique Company Essays**: Company-specific essay questions ("Why do you want to work here?") are auto-generated from candidate skills and summary, but may need candidate personalization.
4. **Multi-Factor Authentication (MFA)**: One-time passwords (OTP) sent to email/phone during login must be entered by the user.

---

## 6. 🔒 Security & Privacy
- **Local Data Storage**: Candidate data is stored locally in `chrome.storage.local`.
- **No Credential Bypass**: Does not bypass Workday logins or password security.
- **Explicit Safety Gate**: The extension will **never** submit the final application without the user clicking the confirmation button.
