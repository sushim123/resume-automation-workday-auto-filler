# Comprehensive Technical Documentation & Architecture

## System Architecture & Technical Specifications

### 1. Resume Parsing & Data Normalization
The resume parsing system extracts candidate profiles from PDF or DOCX format.
- **Parser Engine**: Uses `pdf-parse` for binary PDF text extraction and `mammoth` for DOCX XML structure extraction.
- **AI Normalization**: Structured JSON schema output containing:
  - `personalInfo`: First name, last name, email, phone, address, LinkedIn, GitHub, website.
  - `workExperience`: Job titles, companies, locations, dates, descriptions.
  - `education`: Institutions, degrees, fields of study, graduation years, GPA.
  - `skills`: Categorized skill tags.
  - `eeoDisclosures`: Work authorization status, visa sponsorship requirements, gender, race/ethnicity, veteran status, disability status.

### 2. Workday DOM Automation Strategy
Workday forms use complex dynamic rendering (React synthetic events, custom comboboxes, `data-automation-id` attributes).
- **Dynamic Field Inspector (`workdayParser.ts`)**:
  - Traverses `input`, `select`, `textarea`, `[data-automation-id]`, and `[aria-haspopup="listbox"]` elements.
  - Correlates labels via `for` attributes, surrounding `formField` wrappers, aria-labels, and placeholder text.
- **High-Accuracy Synthetic Input Filler (`domFiller.ts`)**:
  - Overcomes React state synchronization by calling prototype value setters (`Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set`).
  - Dispatches bubbling `input`, `change`, and `blur` events.
  - Custom Combobox Handling: Expands Workday listbox popups, types search queries into `searchBox`, and triggers click events on target option elements.
- **Dynamic Re-render Observer (`mutationObserver.ts`)**:
  - Monitors DOM changes caused by Workday AJAX step transitions.

### 3. AI & Heuristic Mapping Engine
Dual-tier mapping strategy:
- **Primary AI Tier**: OpenAI GPT-4o-mini prompt engineered with candidate profile JSON + extracted Workday DOM field definitions.
- **Fallback Heuristic Tier**: Keyword matching algorithm matching semantic field labels (e.g. mapping "Given Name" / "First Name", "Legal Right to Work", "EEO Voluntary Disclosures") to candidate profile fields with confidence scores.

### 4. Submission Safety Gate Workflow
- Extension popup displays current Workday application step.
- Step navigation (`Save & Continue`) is controlled by the user.
- On reaching the final review page, submission is blocked behind an explicit confirmation modal pop-up to satisfy safety requirements.

---

## Deliverables & Testing Checklist

- [x] Complete Next.js full-stack application source code
- [x] Complete Chrome Extension (Manifest V3) build bundle (`extension/dist/`)
- [x] Tested against Workday target application forms (NVIDIA & Target)
- [x] Comprehensive documentation (`README.md`, `DOCUMENTATION.md`)
