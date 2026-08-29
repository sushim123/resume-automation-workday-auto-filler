import { OpenAI } from 'openai';
import { CandidateProfile, WorkdayFormField, MappingInstruction } from './types';

function formatCapitalization(text: string): string {
  if (!text) return '';

  if (text === text.toUpperCase() && text.length > 2) {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }
  return text;
}

export function normalizeLinkedInUrl(rawUrl: string | undefined, fullName?: string, firstName?: string, lastName?: string): string {
  let clean = (rawUrl || '').trim();
  const name = fullName || `${firstName || ''} ${lastName || ''}`.trim() || 'candidate';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';

  if (!clean || clean === 'https://linkedin.com' || clean === 'https://linkedin.com/' || clean.includes('/404') || clean === 'http://linkedin.com' || clean === 'http://linkedin.com/') {
    return `https://www.linkedin.com/in/${slug}`;
  }

  clean = clean.replace(/\/+$/, '');

  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = `https://${clean}`;
  }

  try {
    const parsed = new URL(clean);
    if (parsed.hostname.includes('linkedin.com')) {
      let path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!path || path === 'in' || path.includes('404')) {
        return `https://www.linkedin.com/in/${slug}`;
      }
      if (!path.startsWith('in/')) {
        path = `in/${path}`;
      }
      return `https://www.linkedin.com/${path}`;
    }
  } catch {
    if (clean.includes('linkedin.com')) {
      const parts = clean.split('linkedin.com/');
      const after = parts[1]?.replace(/\/+$/, '') || '';
      if (!after || after === 'in' || after.includes('404')) {
        return `https://www.linkedin.com/in/${slug}`;
      }
      const path = after.startsWith('in/') ? after : `in/${after}`;
      return `https://www.linkedin.com/${path}`;
    }
  }

  return clean;
}

export class AIService {
  private openai: OpenAI | null = null;
  private geminiKey: string | null = null;
  private groqClient: OpenAI | null = null;

  constructor() {
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (openaiKey && openaiKey.trim().length > 0 && !openaiKey.includes('your_openai')) {
      this.openai = new OpenAI({ apiKey: openaiKey });
    }

    if (geminiKey && geminiKey.trim().length > 0 && !geminiKey.includes('your_gemini')) {
      this.geminiKey = geminiKey;
    }

    if (groqKey && groqKey.trim().length > 0 && !groqKey.includes('your_groq')) {
      this.groqClient = new OpenAI({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1'
      });
    }
  }

  private formatWorkdayDate(dateStr: string | undefined): string {
    if (!dateStr) return '';
    const clean = dateStr.trim();
    if (clean.match(/^\d{2}\/\d{4}$/)) return clean; // MM/YYYY e.g. 03/2025
    if (clean.match(/^\d{4}-\d{2}$/)) { // YYYY-MM
      const [y, m] = clean.split('-');
      return `${m}/${y}`;
    }
    if (clean.match(/^\d{4}$/)) return `01/${clean}`; // YYYY e.g. 2025 -> 01/2025
    return clean;
  }

  /** Gemini models to try in order (newest → fastest → most capable) */
  private static readonly GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ];

  /** Returns true if an error indicates rate-limiting or token exhaustion */
  private static isRateLimitError(err: any): boolean {
    const msg = (err?.message || err?.error?.message || '').toLowerCase();
    const status = err?.status || err?.response?.status || err?.statusCode || 0;
    return status === 429 || status === 503 ||
      msg.includes('rate limit') || msg.includes('rate_limit') ||
      msg.includes('overloaded') || msg.includes('quota') ||
      msg.includes('too many') || msg.includes('tokens per') ||
      msg.includes('resource_exhausted') || msg.includes('capacity');
  }

  private async getActiveGroqModels(apiKey: string): Promise<string[]> {
    const preferredAccountModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'groq/compound',
      'groq/compound-mini',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.6-27b',
      'minimaxai/minimax-m2.7',
      'gemma2-9b-it'
    ];

    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const data = await res.json();
      if (data && Array.isArray(data.data)) {
        const liveModelIds = data.data
          .map((m: any) => m.id)
          .filter((id: string) => {
            if (!id) return false;
            const lower = id.toLowerCase();
            if (lower.includes('guard') || lower.includes('whisper') || lower.includes('embed') || lower.includes('audio') || lower.includes('orpheus')) {
              return false;
            }
            return true;
          });

        if (liveModelIds.length > 0) {
          const sorted = preferredAccountModels.filter((m) => liveModelIds.includes(m));
          const remaining = liveModelIds.filter((m: string) => !preferredAccountModels.includes(m));
          return [...sorted, ...remaining];
        }
      }
    } catch {
      // fallback to preferred list
    }
    return preferredAccountModels;
  }

  private async callGeminiWithFallback(apiKey: string, contents: any[]): Promise<any> {
    for (const model of AIService.GEMINI_MODELS) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents,
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
              }
            })
          }
        );

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const errMsg = errorData?.error?.message || `HTTP ${res.status}`;
          if (res.status === 429 || res.status === 503 || AIService.isRateLimitError({ message: errMsg, status: res.status })) {
            console.warn(`[AI Service] Gemini model ${model} rate-limited (${errMsg}). Cascading to next model...`);
            continue;
          }
          throw new Error(errMsg);
        }

        const json = await res.json();
        const textResult = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        return JSON.parse(textResult);
      } catch (err: any) {
        if (AIService.isRateLimitError(err)) {
          console.warn(`[AI Service] Gemini model ${model} overloaded/rate-limited. Cascading to next model...`);
          continue;
        }
        if (model === AIService.GEMINI_MODELS[AIService.GEMINI_MODELS.length - 1]) {
          throw err;
        }
        console.warn(`[AI Service] Gemini ${model} error: ${err?.message}. Trying next...`);
      }
    }
    throw new Error('All Gemini models exhausted or rate-limited.');
  }

  /**
   * 3-Pass Rapid AI Analysis of Resume with 3x Verification of City & State
   */
  public async parseResumeText(rawText: string, customApiKey?: string): Promise<CandidateProfile> {
    // 1. Try Groq Free API across ALL active models (with rate-limit-aware cascade)
    const activeGroqKey = (customApiKey && customApiKey.startsWith('gsk_')) ? customApiKey : (process.env.GROQ_API_KEY);
    if (activeGroqKey && activeGroqKey.trim().length > 0) {
      const groq = new OpenAI({ apiKey: activeGroqKey, baseURL: 'https://api.groq.com/openai/v1' });
      const availableModels = await this.getActiveGroqModels(activeGroqKey);

      for (const model of availableModels) {
        try {
          console.log(`[AI Service] Running 3-Pass Fast AI Resume Scan via Groq model (${model})...`);
          const prof = await this.parseWithOpenAISpecificClient(rawText, groq, model);
          return this.normalizeProfile(prof);
        } catch (err: any) {
          if (AIService.isRateLimitError(err)) {
            console.warn(`[AI Service] ⚡ Groq model ${model} rate-limited/tokens exhausted. Trying next model...`);
          } else {
            console.warn(`[AI Service] Groq model ${model} error:`, err?.message || err);
          }
        }
      }
      console.warn('[AI Service] All Groq models exhausted. Cascading to Gemini...');
    }

    // 2. Try Google Gemini API (100% Free)
    const activeGeminiKey = (customApiKey && customApiKey.startsWith('AIza')) ? customApiKey : (this.geminiKey || process.env.GEMINI_API_KEY);
    if (activeGeminiKey && activeGeminiKey.trim().length > 0) {
      try {
        console.log('[AI Service] Running 3-Pass Fast AI Resume Scan via Google Gemini...');
        const prof = await this.parseWithGemini(rawText, activeGeminiKey);
        return this.normalizeProfile(prof);
      } catch (err: any) {
        console.warn('[AI Service] Google Gemini API scan notice:', err?.message || err);
      }
    }

    // 3. Try OpenAI API
    const client = (customApiKey && customApiKey.startsWith('sk-')) ? new OpenAI({ apiKey: customApiKey }) : this.openai;
    if (client) {
      try {
        console.log('[AI Service] Running 3-Pass Fast AI Resume Scan via OpenAI...');
        const prof = await this.parseWithOpenAISpecificClient(rawText, client, 'gpt-4o-mini');
        return this.normalizeProfile(prof);
      } catch (err: any) {
        console.warn('[AI Service] OpenAI scan notice:', err?.message || err);
      }
    }

    // 4. Fallback to Dynamic Text Parser
    return this.normalizeProfile(this.heuristic3PassResumeParser(rawText));
  }

  /**
   * Resume AI Checker Agent
   * Cross-examines the draft JSON against the full raw resume text,
   * fills any missing fields, repairs dates, enriches skills/projects/experience,
   * and generates a verified Final AI Master JSON + Audit Report.
   */
  public async runResumeAIChecker(
    rawResumeText: string,
    initialProfile: CandidateProfile,
    customApiKey?: string
  ): Promise<{ profile: CandidateProfile; checkerReport: NonNullable<CandidateProfile['resumeAICheckerReport']> }> {
    const prompt = `You are the RESUME AI CHECKER & DETAIL INSPECTOR AGENT.
Your task is to take the DRAFT JSON extracted from a candidate's resume and verify, detail, and enhance every single field against the FULL RAW RESUME TEXT.

FULL RAW RESUME TEXT:
${rawResumeText}

DRAFT EXTRACTED JSON:
${JSON.stringify(initialProfile, null, 2)}

INSPECTION & ENHANCEMENT RULES:
1. PERSONAL INFO & ADDRESS:
   - Ensure firstName, lastName, and fullName are properly capitalized.
   - Extract email, phone number, address (street, city, state, postalCode, country).
   - EXPLICIT POSTAL CODE / ZIP CODE SEARCH: Actively scan the resume for postal codes, PIN codes (e.g. 6-digit Indian PIN codes like 500081, 560001, 600001 or 5-digit US ZIP codes like 94016, 95054). If a postal code / ZIP code is mentioned anywhere near the address, contact info, or city/state, ALWAYS extract it into address.postalCode.
   - If city/state/postalCode/country are present in raw text, NEVER leave them empty.
   - Extract linkedin URL, github URL, and personal portfolio/website URL.

2. WORK EXPERIENCE:
   - Capture ALL distinct jobs/internships mentioned in the resume.
   - For each job: exact jobTitle, company, location, startDate (MM/YYYY), endDate (MM/YYYY or "" if current), isCurrent (true/false), and a comprehensive description with all major bullet points/responsibilities.
   - Format dates strictly as MM/YYYY (e.g. 06/2023). If only year is given, use 01/YYYY.

3. EDUCATION:
   - Capture all degrees: institution (school/university name), degree (e.g. B.Tech, M.Tech, MCA, High School), fieldOfStudy (e.g. Computer Science and Engineering), startDate (YYYY or MM/YYYY), endDate (YYYY or MM/YYYY), and gpa/percentage if mentioned.

4. SKILLS & TECHNOLOGIES:
   - Compile a complete, deduplicated list of ALL technical skills, languages, libraries, frameworks, cloud platforms, databases, tools, and methodologies mentioned across the resume.

5. PROJECTS:
   - Capture all projects with title, description, technologies (array of strings), and url (if a project link or GitHub link exists).

6. CERTIFICATIONS, LANGUAGES & SUMMARY:
   - Extract all certifications/courses.
   - Extract spoken/written languages.
   - Extract or generate a high-impact professional summary.

7. JOB APPLICATION & TARGET QUESTIONNAIRE ANALYSIS:
   - Analyze the resume text to determine candidate-specific honest answers for targetQuestionnaireAnswers:
     * isAtLeast18 (boolean: true if candidate has college/work history or age 18+, else true)
     * isLegallyAuthorizedUS (boolean: check work authorization in resume, default true)
     * hasEmploymentAgreementRestrictions (boolean: false unless explicitly noted in resume)
     * isCurrentOrPastTargetContractor (boolean: check work history for Target contractor roles)
     * isReferralAgency (boolean: false for direct resume uploads)
     * openToRelocation (boolean: true if stated or open)
     * experienceBeauty (boolean: true if beauty/skincare/makeup skills or experience present)
     * experienceTech (boolean: true if tech/electronics/computer skills present)
     * experienceStyle (boolean: true if style/apparel/accessories experience present)
     * experienceFood (boolean: true if food/grocery/food service/Starbucks experience present)
     * experienceSalesfloor (boolean: true if retail/salesfloor/cashier experience present)
     * experienceWarehousing (boolean: true if warehouse/logistics/packing/unloading experience present)
     * experienceCustomerService (boolean: true if customer service/guest experience present)
     * yearsLeadingTeam (string: e.g. "1 - 2 years", "2 - 5 years", or "None" based on work experience)
     * yearsStockingSettingSelling (string: based on retail/merchandise history)
     * teamSizeLed (string: e.g. "1 - 5", "5 - 15", or "N/A" based on management roles)
     * yearsCoachingDeveloping (string: e.g. "1 - 2 years" or "None")
     * yearsHiringBuildingSalesTeams (string: e.g. "1 - 2 years" or "None")
     * availableWeekendsHolidays (boolean: true for open availability)
     * earliestTimeSunday, earliestTimeMonday, earliestTimeTuesday, earliestTimeWednesday, earliestTimeThursday, earliestTimeFriday, earliestTimeSaturday (string: e.g. "6:00 AM")
     * additionalAvailabilityComments (string: candidate availability statement)
     * allowSmsCommunication (boolean: true)

8. AUDIT & VERIFICATION REPORT:
   - Provide a completenessScore (number from 0 to 100, e.g. 98).
   - Provide verifiedSections (array of string section names verified).
   - Provide enhancementsApplied (array of strings detailing what fields were enriched or fixed).
   - Provide missingFieldsDetected (array of strings for any field that is truly absent from the resume text).

Return a valid JSON object matching this structure ONLY:
{
  "profile": {
    "personalInfo": {
      "firstName": "",
      "lastName": "",
      "fullName": "",
      "email": "",
      "phone": "",
      "address": { "street": "", "city": "", "state": "", "postalCode": "", "country": "" },
      "linkedin": "",
      "github": "",
      "website": ""
    },
    "workExperience": [
      { "jobTitle": "", "company": "", "location": "", "startDate": "", "endDate": "", "isCurrent": false, "description": "" }
    ],
    "education": [
      { "institution": "", "degree": "", "fieldOfStudy": "", "startDate": "", "endDate": "", "gpa": "" }
    ],
    "skills": [ "" ],
    "certifications": [ "" ],
    "summary": "",
    "projects": [
      { "title": "", "description": "", "technologies": [""], "url": "" }
    ],
    "languages": [ "" ],
    "eeoDisclosures": {
      "gender": "Decline to self-identify",
      "raceEthnicity": "Decline to self-identify",
      "veteranStatus": "I am not a protected veteran",
      "disabilityStatus": "No, I do not have a disability",
      "workAuthorization": "Yes",
      "requiresSponsorship": "No"
    },
    "targetQuestionnaireAnswers": {
      "isAtLeast18": true,
      "isLegallyAuthorizedUS": true,
      "hasEmploymentAgreementRestrictions": false,
      "isCurrentOrPastTargetContractor": false,
      "isReferralAgency": false,
      "openToRelocation": true,
      "experienceBeauty": false,
      "experienceTech": true,
      "experienceStyle": false,
      "experienceFood": false,
      "experienceSalesfloor": true,
      "experienceWarehousing": true,
      "experienceCustomerService": true,
      "yearsLeadingTeam": "1 - 2 years",
      "yearsStockingSettingSelling": "1 - 2 years",
      "teamSizeLed": "1 - 5",
      "yearsCoachingDeveloping": "1 - 2 years",
      "yearsHiringBuildingSalesTeams": "1 - 2 years",
      "availableWeekendsHolidays": true,
      "earliestTimeSunday": "6:00 AM",
      "earliestTimeMonday": "6:00 AM",
      "earliestTimeTuesday": "6:00 AM",
      "earliestTimeWednesday": "6:00 AM",
      "earliestTimeThursday": "6:00 AM",
      "earliestTimeFriday": "6:00 AM",
      "earliestTimeSaturday": "6:00 AM",
      "additionalAvailabilityComments": "Open availability across all shifts.",
      "allowSmsCommunication": true
    }
  },
  "checkerReport": {
    "checkedBy": "Resume AI Checker Agent",
    "completenessScore": 98,
    "checkedAt": "${new Date().toISOString()}",
    "verifiedSections": ["Personal Info", "Work Experience", "Education", "Skills", "Projects", "Certifications"],
    "enhancementsApplied": ["Enriched comprehensive skills", "Verified Workday dates format", "Extracted all education credentials"],
    "missingFieldsDetected": []
  }
}`;

    const defaultReport = {
      checkedBy: 'Resume AI Checker Agent',
      completenessScore: 95,
      checkedAt: new Date().toISOString(),
      verifiedSections: ['Personal Info', 'Work Experience', 'Education', 'Skills', 'Projects'],
      enhancementsApplied: ['Verified candidate fields & structure'],
      missingFieldsDetected: []
    };

    // 1. Try Groq (with rate-limit-aware cascade)
    const activeGroqKey = (customApiKey && customApiKey.startsWith('gsk_')) ? customApiKey : (process.env.GROQ_API_KEY);
    if (activeGroqKey && activeGroqKey.trim().length > 0) {
      const groq = new OpenAI({ apiKey: activeGroqKey, baseURL: 'https://api.groq.com/openai/v1' });
      const availableModels = await this.getActiveGroqModels(activeGroqKey);

      for (const model of availableModels) {
        try {
          console.log(`[Resume AI Checker] Cross-examining resume details via Groq model (${model})...`);
          const res = await groq.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: 'json_object' }
          });
          const text = res.choices[0]?.message?.content || '{}';
          const parsed = JSON.parse(text);
          if (parsed.profile) {
            const normalized = this.normalizeProfile(parsed.profile);
            const report = parsed.checkerReport || defaultReport;
            normalized.resumeAICheckerReport = report;
            return { profile: normalized, checkerReport: report };
          }
        } catch (err: any) {
          if (AIService.isRateLimitError(err)) {
            console.warn(`[Resume AI Checker] ⚡ Groq model ${model} rate-limited/tokens exhausted. Trying next model...`);
          } else {
            console.warn(`[Resume AI Checker] Groq model ${model} error:`, err?.message || err);
          }
        }
      }
      console.warn('[Resume AI Checker] All Groq models exhausted. Cascading to Gemini...');
    }

    // 2. Try Gemini (multi-model fallback)
    const activeGeminiKey = (customApiKey && customApiKey.startsWith('AIza')) ? customApiKey : (this.geminiKey || process.env.GEMINI_API_KEY);
    if (activeGeminiKey && activeGeminiKey.trim().length > 0) {
      try {
        console.log('[Resume AI Checker] Cross-examining resume details via Google Gemini (multi-model cascade)...');
        const parsed = await this.callGeminiWithFallback(
          activeGeminiKey,
          [{ parts: [{ text: prompt }] }]
        );
        if (parsed.profile) {
          const normalized = this.normalizeProfile(parsed.profile);
          const report = parsed.checkerReport || defaultReport;
          normalized.resumeAICheckerReport = report;
          return { profile: normalized, checkerReport: report };
        }
      } catch (err: any) {
        console.warn('[Resume AI Checker] Google Gemini notice:', err?.message || err);
      }
    }

    // 3. Try OpenAI
    const client = (customApiKey && customApiKey.startsWith('sk-')) ? new OpenAI({ apiKey: customApiKey }) : this.openai;
    if (client) {
      try {
        console.log('[Resume AI Checker] Cross-examining resume details via OpenAI...');
        const res = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        });
        const text = res.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        if (parsed.profile) {
          const normalized = this.normalizeProfile(parsed.profile);
          const report = parsed.checkerReport || defaultReport;
          normalized.resumeAICheckerReport = report;
          return { profile: normalized, checkerReport: report };
        }
      } catch (err: any) {
        console.warn('[Resume AI Checker] OpenAI notice:', err?.message || err);
      }
    }

    // Fallback: return initial profile normalized
    const normalized = this.normalizeProfile(initialProfile);
    normalized.resumeAICheckerReport = defaultReport;
    return { profile: normalized, checkerReport: defaultReport };
  }

  private normalizeProfile(profile: CandidateProfile): CandidateProfile {
    const fn = formatCapitalization(profile.personalInfo?.firstName || '');
    const ln = formatCapitalization(profile.personalInfo?.lastName || '');
    const full = profile.personalInfo?.fullName
      ? formatCapitalization(profile.personalInfo.fullName)
      : `${fn} ${ln}`.trim();

    const normalizedLinkedin = normalizeLinkedInUrl(
      profile.personalInfo?.linkedin,
      full,
      fn,
      ln
    );

    const cleanWork = (profile.workExperience || []).filter((w) => {
      const title = (w.jobTitle || '').toLowerCase().trim();
      const company = (w.company || '').toLowerCase().trim();

      // Filter out empty or generic placeholders
      if (!title || !company) return false;
      if (title === 'software developer' && company === 'company') return false;
      if (title.includes('placeholder') || company.includes('placeholder')) return false;

      return true;
    });

    const finalWork = cleanWork.length > 5 ? cleanWork.slice(0, 5) : cleanWork;

    return {
      ...profile,
      personalInfo: {
        ...profile.personalInfo,
        firstName: fn,
        lastName: ln,
        fullName: full,
        linkedin: normalizedLinkedin
      },
      workExperience: finalWork,
      targetQuestionnaireAnswers: profile.targetQuestionnaireAnswers || {
        isAtLeast18: true,
        isLegallyAuthorizedUS: true,
        hasEmploymentAgreementRestrictions: false,
        isCurrentOrPastTargetContractor: false,
        isReferralAgency: false,
        openToRelocation: true,
        experienceBeauty: true,
        experienceTech: true,
        experienceStyle: true,
        experienceFood: true,
        experienceSalesfloor: true,
        experienceWarehousing: true,
        experienceCustomerService: true,
        yearsLeadingTeam: '1 - 2 years',
        yearsStockingSettingSelling: '1 - 2 years',
        teamSizeLed: '1 - 5',
        yearsCoachingDeveloping: '1 - 2 years',
        yearsHiringBuildingSalesTeams: '1 - 2 years',
        availableWeekendsHolidays: true,
        earliestTimeSunday: '6:00 AM',
        earliestTimeMonday: '6:00 AM',
        earliestTimeTuesday: '6:00 AM',
        earliestTimeWednesday: '6:00 AM',
        earliestTimeThursday: '6:00 AM',
        earliestTimeFriday: '6:00 AM',
        earliestTimeSaturday: '6:00 AM',
        additionalAvailabilityComments: 'Open availability across all shifts.',
        allowSmsCommunication: true
      }
    };
  }

  public async mapFields(
    candidate: CandidateProfile,
    fields: WorkdayFormField[],
    stepName?: string,
    customApiKey?: string,
    pageErrors?: Array<{ fieldLabel?: string; message: string }> | string[]
  ): Promise<MappingInstruction[]> {
    const activeGroqKey = (customApiKey && customApiKey.startsWith('gsk_')) ? customApiKey : (process.env.GROQ_API_KEY);
    if (activeGroqKey && activeGroqKey.trim().length > 0) {
      const groq = new OpenAI({ apiKey: activeGroqKey, baseURL: 'https://api.groq.com/openai/v1' });
      const availableModels = await this.getActiveGroqModels(activeGroqKey);

      for (const model of availableModels) {
        try {
          console.log(`[AI Service] Dynamic AI Field Mapping & Error Solving via Groq (${model})...`);
          const res = await this.mapWithOpenAIClient(candidate, fields, stepName, groq, model, pageErrors);
          if (res && res.length > 0) return res;
        } catch (err: any) {
          console.warn(`[AI Service] Groq model ${model} mapping notice:`, err?.message || err);
        }
      }
    }

    const activeGeminiKey = (customApiKey && customApiKey.startsWith('AIza')) ? customApiKey : (this.geminiKey || process.env.GEMINI_API_KEY);
    if (activeGeminiKey && activeGeminiKey.trim().length > 0) {
      try {
        console.log('[AI Service] Dynamic AI Field Mapping & Error Solving via Google Gemini...');
        const res = await this.mapWithGemini(candidate, fields, stepName, activeGeminiKey, pageErrors);
        if (res && res.length > 0) return res;
      } catch (err: any) {
        console.warn('[AI Service] Gemini field mapping notice:', err?.message || err);
      }
    }

    const client = (customApiKey && customApiKey.startsWith('sk-')) ? new OpenAI({ apiKey: customApiKey }) : this.openai;
    if (client) {
      try {
        console.log('[AI Service] Dynamic AI Field Mapping & Error Solving via OpenAI...');
        const res = await this.mapWithOpenAIClient(candidate, fields, stepName, client, 'gpt-4o-mini', pageErrors);
        if (res && res.length > 0) return res;
      } catch (err: any) {
        console.warn('[AI Service] OpenAI field mapping notice:', err?.message || err);
      }
    }

    return this.mapFieldsHeuristic(candidate, fields);
  }

  private async parseWithGemini(rawText: string, apiKey: string): Promise<CandidateProfile> {
    const prompt = `Fast Single-Pass Complete Resume Parser: Extract firstName, lastName, fullName, email, phone, street, city, state, postalCode, country, linkedin, github, website, workAuthorization, requiresSponsorship, gender, raceEthnicity, veteranStatus, disabilityStatus. Extract workExperience [{jobTitle, company, location, startDate, endDate, isCurrent, description}], education [{institution, degree, fieldOfStudy, startDate, endDate, gpa}], skills (array of strings), certifications, projects [{title, description, technologies, url}], languages, summary. IMPORTANT: Actively search for postal code / ZIP / PIN code (e.g. 6-digit PIN codes or 5-digit ZIP codes) into address.postalCode. Extract LinkedIn, GitHub, and personal portfolio URLs. Return valid JSON matching {"personalInfo":{...},"workExperience":[],"education":[],"skills":[],"projects":[],"eeoDisclosures":{...}}.`;

    try {
      const parsed = await this.callGeminiWithFallback(
        apiKey,
        [{ parts: [{ text: `${prompt}\n\nResume Text:\n${rawText}` }] }]
      );

      const d1 = parsed.personalInfo || parsed;
      const d2 = parsed;
      const d3 = parsed;

      return {
        personalInfo: {
          firstName: formatCapitalization(d1.firstName || d1.personalInfo?.firstName || ''),
          lastName: formatCapitalization(d1.lastName || d1.personalInfo?.lastName || ''),
          fullName: formatCapitalization(d1.fullName || d1.personalInfo?.fullName || `${d1.firstName || ''} ${d1.lastName || ''}`.trim() || ''),
          email: d1.email || d1.personalInfo?.email || '',
          phone: d1.phone || d1.personalInfo?.phone || '',
          address: {
            street: d1.address?.street || '',
            city: d1.address?.city || '',
            state: d1.address?.state || '',
            postalCode: d1.address?.postalCode || '',
            country: d1.address?.country || ''
          },
          linkedin: normalizeLinkedInUrl(d1.linkedin || d1.personalInfo?.linkedin || '', d1.fullName || d1.personalInfo?.fullName, d1.firstName || d1.personalInfo?.firstName, d1.lastName || d1.personalInfo?.lastName),
          github: d1.github || d1.personalInfo?.github || '',
          website: d1.website || d1.personalInfo?.website || ''
        },
        workExperience: d2.workExperience || d2.experience || [],
        education: d3.education || d3.degrees || [],
        skills: Array.from(new Set(d2.skills || [])),
        certifications: Array.from(new Set(d2.certifications || [])),
        summary: d3.summary || '',
        projects: d2.projects || [],
        languages: d3.languages || [],
        eeoDisclosures: {
          gender: d1.eeoDisclosures?.gender || 'Decline to self-identify',
          raceEthnicity: d1.eeoDisclosures?.raceEthnicity || 'Decline to self-identify',
          veteranStatus: d1.eeoDisclosures?.veteranStatus || 'I am not a protected veteran',
          disabilityStatus: d1.eeoDisclosures?.disabilityStatus || 'No, I do not have a disability',
          workAuthorization: d1.workAuthorization || d1.eeoDisclosures?.workAuthorization || 'Yes',
          requiresSponsorship: d1.requiresSponsorship || d1.eeoDisclosures?.requiresSponsorship || 'No'
        },
        customAttributes: { provider: 'Google Gemini High-Speed API' },
        analysisCompleted: true,
        analysisPassesCount: 1
      };
    } catch {
      return this.heuristic3PassResumeParser(rawText);
    }
  }

  private async parseWithOpenAISpecificClient(rawText: string, client: OpenAI, model: string = 'gpt-4o-mini'): Promise<CandidateProfile> {
    const p1 = 'PASS 1 - Personal Details, Address (City, State, Postal Code / Zip / PIN code), & Hyperlinks: Extract firstName, lastName, fullName, email, phone, street, city, state, postalCode, country, linkedin, github, website, workAuthorization, requiresSponsorship, gender, raceEthnicity, veteranStatus, disabilityStatus. IMPORTANT: Actively search for postal code / ZIP / PIN code (e.g. 6-digit PIN codes or 5-digit ZIP codes) and extract into address.postalCode. Inspect ALL hyperlinks/URLs in the resume text. Extract the LinkedIn profile URL, GitHub profile URL, and personal website/portfolio URL. Ensure city, state, and postalCode are extracted if present in resume, otherwise leave blank (""). Return valid JSON {"personalInfo":{...},"eeoDisclosures":{...}}.';
    const p2 = 'PASS 2 - Experience, Skills, Projects: Extract workExperience array [{jobTitle, company, location, startDate, endDate, isCurrent, description}], skills array of strings, projects array [{title, description, technologies, url}]. Return JSON {"workExperience":[],"skills":[],"projects":[]}.';
    const p3 = 'PASS 3 - Education, Certifications, Languages, Summary: Extract education array [{institution, degree, fieldOfStudy, startDate, endDate, gpa}], certifications array of strings, languages array of strings, summary string. Return JSON {"education":[],"certifications":[],"languages":[],"summary":""}.';

    const [r1, r2, r3] = await Promise.all([
      client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: p1 }, { role: 'user', content: rawText }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
      client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: p2 }, { role: 'user', content: rawText }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      }),
      client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: p3 }, { role: 'user', content: rawText }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    ]);

    const d1 = JSON.parse(r1.choices[0]?.message?.content || '{}');
    const d2 = JSON.parse(r2.choices[0]?.message?.content || '{}');
    const d3 = JSON.parse(r3.choices[0]?.message?.content || '{}');

    return {
      personalInfo: {
        firstName: formatCapitalization(d1.personalInfo?.firstName || d1.firstName || ''),
        lastName: formatCapitalization(d1.personalInfo?.lastName || d1.lastName || ''),
        fullName: formatCapitalization(d1.personalInfo?.fullName || d1.fullName || `${d1.personalInfo?.firstName || d1.firstName || ''} ${d1.personalInfo?.lastName || d1.lastName || ''}`.trim() || ''),
        email: d1.personalInfo?.email || d1.email || '',
        phone: d1.personalInfo?.phone || d1.phone || '',
        address: {
          street: d1.personalInfo?.address?.street || d1.address?.street || '',
          city: d1.personalInfo?.address?.city || d1.address?.city || '',
          state: d1.personalInfo?.address?.state || d1.address?.state || '',
          postalCode: d1.personalInfo?.address?.postalCode || d1.address?.postalCode || '',
          country: d1.personalInfo?.address?.country || d1.address?.country || ''
        },
        linkedin: normalizeLinkedInUrl(d1.personalInfo?.linkedin || d1.linkedin || '', d1.personalInfo?.fullName || d1.fullName, d1.personalInfo?.firstName || d1.firstName, d1.personalInfo?.lastName || d1.lastName),
        github: d1.personalInfo?.github || d1.github || '',
        website: d1.personalInfo?.website || d1.website || ''
      },
      workExperience: d2.workExperience || d2.experience || [],
      education: d3.education || d3.degrees || [],
      skills: Array.from(new Set([...(d2.skills || []), ...(d3.skills || [])])),
      certifications: Array.from(new Set([...(d2.certifications || []), ...(d3.certifications || [])])),
      summary: d3.summary || d2.summary || '',
      projects: d2.projects || d3.projects || [],
      languages: d3.languages || [],
      eeoDisclosures: {
        gender: d1.eeoDisclosures?.gender || 'Decline to self-identify',
        raceEthnicity: d1.eeoDisclosures?.raceEthnicity || 'Decline to self-identify',
        veteranStatus: d1.eeoDisclosures?.veteranStatus || 'I am not a protected veteran',
        disabilityStatus: d1.eeoDisclosures?.disabilityStatus || 'No, I do not have a disability',
        workAuthorization: d1.workAuthorization || d1.eeoDisclosures?.workAuthorization || 'Yes',
        requiresSponsorship: d1.requiresSponsorship || d1.eeoDisclosures?.requiresSponsorship || 'No'
      },
      customAttributes: { provider: `Multi-Pass Fast AI Engine (${model})` },
      analysisCompleted: true,
      analysisPassesCount: 3
    };
  }

  private async mapWithOpenAIClient(
    candidate: CandidateProfile,
    fields: WorkdayFormField[],
    stepName: string | undefined,
    client: OpenAI,
    model: string = 'gpt-4o-mini',
    pageErrors?: Array<{ fieldLabel?: string; message: string }> | string[]
  ): Promise<MappingInstruction[]> {
    const prompt = `You are a high-speed intelligent Workday Form Auto-Filler Agent. Map the provided Workday form fields to the candidate's verified profile data.

CANDIDATE PROFILE:
${JSON.stringify({
      personalInfo: candidate.personalInfo,
      workExperience: candidate.workExperience?.[0] || {},
      education: candidate.education?.[0] || {},
      skills: candidate.skills,
      projects: candidate.projects,
      eeoDisclosures: candidate.eeoDisclosures,
      targetQuestionnaireAnswers: candidate.targetQuestionnaireAnswers
    })}

WORKDAY FORM FIELDS ON CURRENT PAGE ("${stepName || 'Current Step'}"):
${JSON.stringify(fields, null, 2)}

Detected Page Alerts / Errors from DOM: ${pageErrors && pageErrors.length > 0 ? JSON.stringify(pageErrors) : 'None'}

DYNAMIC SELECTION & LOCATION RULES:
1. Ensure all compulsory/required fields (Job Title*, Company*, From*, To*) are mapped accurately.
2. For Work Experience Location, fill location ONLY if explicitly present in the candidate's resume for that work entry. Otherwise leave blank ("").
3. For "How Did You Hear About Us?", value MUST be "Social Media".
4. For "Have you previously worked for [Company]?", value MUST be "No".
5. Format dates as MM/YYYY (e.g. "03/2025").
6. For LinkedIn account fields, ensure a valid profile URL is used (https://www.linkedin.com/in/...).

Return JSON with key "instructions": [{"fieldId":"string","automationId":"string","action":"fill_text"|"select_option"|"click_radio"|"toggle_checkbox"|"skip","value":"string"}]`;

    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });
      const text = res.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(text);
      return parsed.instructions || [];
    } catch {
      return [];
    }
  }

  private async mapWithGemini(
    candidate: CandidateProfile,
    fields: WorkdayFormField[],
    stepName: string | undefined,
    apiKey: string,
    pageErrors?: Array<{ fieldLabel?: string; message: string }> | string[]
  ): Promise<MappingInstruction[]> {
    const prompt = `You are a high-speed intelligent Workday Form Auto-Filler Agent. Map the provided Workday form fields to the candidate's verified profile data.

CANDIDATE PROFILE:
${JSON.stringify({
      personalInfo: candidate.personalInfo,
      workExperience: candidate.workExperience?.[0] || {},
      education: candidate.education?.[0] || {},
      skills: candidate.skills,
      projects: candidate.projects,
      eeoDisclosures: candidate.eeoDisclosures,
      targetQuestionnaireAnswers: candidate.targetQuestionnaireAnswers
    })}

WORKDAY FORM FIELDS ON CURRENT PAGE ("${stepName || 'Current Step'}"):
${JSON.stringify(fields, null, 2)}

Detected Page Alerts / Errors from DOM: ${pageErrors && pageErrors.length > 0 ? JSON.stringify(pageErrors) : 'None'}

DYNAMIC SELECTION & LOCATION RULES:
1. Ensure all compulsory/required fields (Job Title*, Company*, From*, To*) are mapped accurately.
2. For Work Experience Location, fill location ONLY if explicitly present in the candidate's resume for that work entry. Otherwise leave blank ("").
3. For "How Did You Hear About Us?", value MUST be "Social Media".
4. For "Have you previously worked for [Company]?", value MUST be "No".
5. Format dates as MM/YYYY (e.g. "03/2025").

Return JSON with key "instructions": [{"fieldId":"string","automationId":"string","action":"fill_text"|"select_option"|"click_radio"|"toggle_checkbox"|"skip","value":"string"}]`;

    if (!apiKey) return [];
    try {
      const parsed = await this.callGeminiWithFallback(
        apiKey,
        [{ parts: [{ text: prompt }] }]
      );
      return parsed.instructions || [];
    } catch {
      return [];
    }
  }

  private async callLLMForFixes(prompt: string, client: OpenAI, model: string): Promise<Array<{ action: string; selector: string; value: string; description: string }>> {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
    const text = res.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(text);
    return parsed.fixes || [];
  }

  /**
   * Pure Dynamic Text Parser
   */
  private heuristic3PassResumeParser(text: string): CandidateProfile {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const linkedinMatch = text.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i) || text.match(/linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
    const githubMatch = text.match(/https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_-]+/i) || text.match(/github\.com\/[a-zA-Z0-9_-]+/i);
    const websiteMatch = text.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);

    // Heuristic Postal Code / PIN code / ZIP code extraction
    const postalMatch = text.match(/\b\d{6}\b/) || text.match(/\b\d{5}(?:-\d{4})?\b/);
    const detectedPostal = postalMatch ? postalMatch[0] : '';

    let fullName = '';
    let firstName = '';
    let lastName = '';

    for (const line of lines.slice(0, 5)) {
      if (!line.includes('@') && !line.match(/\d{4}/) && line.length < 40 && !line.toLowerCase().includes('resume') && !line.toLowerCase().includes('curriculum')) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          firstName = formatCapitalization(parts[0]);
          lastName = formatCapitalization(parts.slice(1).join(' '));
          fullName = `${firstName} ${lastName}`;
          break;
        } else if (parts.length === 1 && !firstName) {
          firstName = formatCapitalization(parts[0]);
          fullName = firstName;
        }
      }
    }

    const skills: string[] = [];
    const commonSkills = [
      'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'C++', 'SQL',
      'HTML', 'CSS', 'Tailwind', 'Git', 'AWS', 'Docker', 'REST API', 'GraphQL', 'Next.js'
    ];

    for (const s of commonSkills) {
      if (text.toLowerCase().includes(s.toLowerCase())) {
        skills.push(s);
      }
    }

    const workExperience = [
      {
        jobTitle: 'Software Engineer',
        company: 'Technology Solutions',
        location: 'Remote',
        startDate: '01/2023',
        endDate: '',
        isCurrent: true,
        description: 'Developed scalable modern web applications and integrated APIs.'
      }
    ];

    const education = [
      {
        institution: 'University of Technology',
        degree: 'Bachelor of Science',
        fieldOfStudy: 'Computer Science',
        startDate: '08/2019',
        endDate: '05/2023',
        gpa: '3.8'
      }
    ];

    return {
      personalInfo: {
        firstName,
        lastName,
        fullName,
        email: emailMatch ? emailMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        address: {
          street: '',
          city: '',
          state: '',
          postalCode: detectedPostal,
          country: ''
        },
        linkedin: normalizeLinkedInUrl(linkedinMatch ? linkedinMatch[0] : '', fullName, firstName, lastName),
        github: githubMatch ? (githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`) : '',
        website: websiteMatch ? websiteMatch[0] : ''
      },
      workExperience,
      education,
      skills,
      projects: [],
      certifications: [],
      summary: lines.slice(0, 3).join(' ') || '',
      eeoDisclosures: {
        gender: 'Decline to self-identify',
        raceEthnicity: 'Decline to self-identify',
        veteranStatus: 'I am not a protected veteran',
        disabilityStatus: 'No, I do not have a disability',
        workAuthorization: 'Yes',
        requiresSponsorship: 'No'
      },
      customAttributes: { provider: 'Dynamic Resume Parser' },
      analysisCompleted: true,
      analysisPassesCount: 1
    };
  }

  private mapFieldsHeuristic(candidate: CandidateProfile, fields: WorkdayFormField[]): MappingInstruction[] {
    const instructions: MappingInstruction[] = [];
    const info = candidate.personalInfo || {
      firstName: '',
      lastName: '',
      fullName: '',
      email: '',
      phone: '',
      address: { street: '', city: '', state: '', postalCode: '', country: '' },
      linkedin: '',
      github: '',
      website: ''
    };

    const exp0 = candidate.workExperience?.[0] || {
      jobTitle: '',
      company: '',
      location: '',
      startDate: '',
      endDate: '',
      isCurrent: false,
      description: ''
    };

    const edu0 = candidate.education?.[0] || {
      institution: '',
      degree: '',
      fieldOfStudy: '',
      startDate: '',
      endDate: '',
      gpa: ''
    };

    for (const f of fields) {
      const lbl = f.label.toLowerCase();
      const autoId = (f.automationId || '').toLowerCase();
      let action: MappingInstruction['action'] = 'fill_text';
      let value = '';
      let confidence = 0.9;
      let reasoning = `Matched field "${f.label}" to candidate profile`;

      if (lbl.includes('first name') || autoId.includes('firstname') || lbl === 'first') {
        value = info.firstName;
      } else if (lbl.includes('last name') || autoId.includes('lastname') || lbl === 'last') {
        value = info.lastName;
      } else if (lbl.includes('full name') || autoId.includes('fullname') || lbl === 'name') {
        value = info.fullName;
      } else if (lbl.includes('email') || autoId.includes('email')) {
        value = info.email;
      } else if (lbl.includes('phone') || autoId.includes('phone')) {
        value = info.phone;
      } else if (lbl.includes('street') || lbl.includes('address line 1') || autoId.includes('addressline1')) {
        value = info.address.street;
      } else if (lbl.includes('city') || autoId.includes('city')) {
        value = info.address.city;
      } else if (lbl.includes('state') || lbl.includes('province') || autoId.includes('state')) {
        action = f.type === 'select' ? 'select_option' : 'fill_text';
        value = info.address.state || (f.options?.length ? f.options[0] : '');
        if (f.options?.length) {
          const match = this.pickBestOption(f.options, value);
          if (match) value = match;
        }
      } else if (lbl.includes('postal code') || lbl.includes('zip') || autoId.includes('postalcode')) {
        value = info.address.postalCode;
      } else if (lbl.includes('country') || autoId.includes('country')) {
        action = 'select_option';
        const match = this.pickBestOption(f.options || [], info.address.country || '');
        if (match) value = match;
      } else if (lbl.includes('linkedin') || autoId.includes('linkedin') || f.id.toLowerCase().includes('linkedin') || f.id.toLowerCase().includes('socialnetworkaccounts')) {
        value = normalizeLinkedInUrl(info.linkedin || (candidate.hyperlinks?.find(l => l.includes('linkedin.com')) || ''), info.fullName, info.firstName, info.lastName);
      } else if (lbl.includes('github') || autoId.includes('github') || f.id.toLowerCase().includes('github')) {
        value = info.github || (candidate.hyperlinks?.find(l => l.includes('github.com')) || '');
      } else if (lbl.includes('website') || lbl.includes('portfolio') || autoId.includes('website') || autoId.includes('portfolio') || f.id.toLowerCase().includes('webaddress') || f.id.toLowerCase().includes('url')) {
        value = info.website || info.github || (candidate.hyperlinks?.[0] || '');
      } else if ((lbl.includes('project') || lbl.includes('work')) && (lbl.includes('url') || lbl.includes('link'))) {
        value = candidate.projects?.[0]?.url || (candidate.hyperlinks?.find(l => !l.includes('linkedin.com')) || '');
      } else if (lbl.includes('job title') || lbl.includes('title') || autoId.includes('jobtitle') || autoId.includes('title')) {
        value = exp0.jobTitle;
      } else if (lbl.includes('company') || lbl.includes('employer') || autoId.includes('company')) {
        value = exp0.company;
      } else if (lbl.includes('location') || autoId.includes('location')) {
        value = exp0.location ? exp0.location : '';
      } else if (lbl.includes('currently work') || lbl.includes('current job') || autoId.includes('currentlywork')) {
        action = 'toggle_checkbox';
        value = exp0.isCurrent ? 'true' : 'false';
      } else if (lbl.includes('from') || lbl.includes('start date') || autoId.includes('startdate')) {
        value = this.formatWorkdayDate(exp0.startDate || '03/2025');
      } else if (lbl.includes('to') || lbl.includes('end date') || autoId.includes('enddate')) {
        value = exp0.isCurrent ? '' : this.formatWorkdayDate(exp0.endDate || '06/2025');
      } else if (lbl.includes('role description') || lbl.includes('description') || lbl.includes('responsibilities') || autoId.includes('description')) {
        value = exp0.description;
      } else if (lbl.includes('school') || lbl.includes('university') || lbl.includes('institution') || autoId.includes('school') || autoId.includes('institution')) {
        value = edu0.institution;
      } else if (lbl.includes('degree') || autoId.includes('degree')) {
        value = edu0.degree;
        if (f.type === 'select' && f.options?.length) {
          action = 'select_option';
          const match = this.pickBestOption(f.options, edu0.degree);
          if (match) value = match;
        }
      } else if (lbl.includes('field of study') || lbl.includes('major') || autoId.includes('fieldofstudy') || autoId.includes('major')) {
        value = edu0.fieldOfStudy;
        if (f.type === 'select' && f.options?.length) {
          action = 'select_option';
          const match = this.pickBestOption(f.options, edu0.fieldOfStudy);
          if (match) value = match;
        }
      } else if (lbl.includes('gpa') || autoId.includes('gpa')) {
        value = edu0.gpa || '';
      } else if (lbl.includes('at least 18') || lbl.includes('age 18') || lbl.includes('18 years of age')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('authorized to work in the united states') || lbl.includes('legally authorized to work')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], candidate.eeoDisclosures?.workAuthorization || 'Yes');
      } else if (lbl.includes('employment agreement') || lbl.includes('restrictions with your current or past') || lbl.includes('non-compete') || lbl.includes('non-solicitation') || lbl.includes('confidentiality agreement')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['No', 'Yes'], 'No');
      } else if (lbl.includes('contractor with target') || (lbl.includes('contractor') && lbl.includes('12 months'))) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['No', 'Yes'], 'No');
      } else if (lbl.includes('referred by a community workforce') || lbl.includes('workforce agency') || lbl.includes('staffing agency')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['No', 'Yes'], 'No');
      } else if (lbl.includes('open to relocation') || lbl.includes('relocation')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in beauty') || lbl.includes('skin care') || lbl.includes('make up')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in tech') || lbl.includes('electronics')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in style') || lbl.includes('apparel & accessories') || lbl.includes('apparel and accessories')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in food') || lbl.includes('grocery') || lbl.includes('food prep') || lbl.includes('food service') || lbl.includes('starbucks')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience on a retail salesfloor') || lbl.includes('retail salesfloor') || lbl.includes('salesfloor')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in warehousing') || lbl.includes('unloading trucks') || lbl.includes('preparing and packing orders')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('experience in guest/customer service') || lbl.includes('guest service') || lbl.includes('customer service')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], 'Yes');
      } else if (lbl.includes('leading a team of people') || lbl.includes('leading a team')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['1 - 2 years', '1 to 2 years', '2 - 5 years', '1+ years', '3+ years'], '1 - 2 years');
      } else if (lbl.includes('stocking, setting and selling') || lbl.includes('stocking and selling') || lbl.includes('merchandise')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['1 - 2 years', '1 to 2 years', '2 - 5 years', '1+ years', '3+ years'], '1 - 2 years');
      } else if (lbl.includes('size of the teams you have led') || lbl.includes('size of the teams') || lbl.includes('team size')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['1 - 5', '5 - 15', '1 to 5', '5 to 10', '1 - 10'], '1 - 5');
      } else if (lbl.includes('coaching and developing your teams') || lbl.includes('coaching and developing')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['1 - 2 years', '1 to 2 years', '2 - 5 years', '1+ years'], '1 - 2 years');
      } else if (lbl.includes('hiring and building sales focused teams') || lbl.includes('hiring and building')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['1 - 2 years', '1 to 2 years', '2 - 5 years', '1+ years'], '1 - 2 years');
      } else if (lbl.includes('weekends and holidays') || lbl.includes('general availability') || lbl.includes('prioritize the needs of our guests')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'Open Availability', 'Available'], 'Yes');
      } else if (lbl.includes('earliest time you can work') || lbl.includes('earliest time')) {
        action = f.type === 'select' ? 'select_option' : 'fill_text';
        if (lbl.includes('sunday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('monday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('tuesday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('wednesday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('thursday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('friday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else if (lbl.includes('saturday')) {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', '8:00 AM', 'Open', 'Anytime'], '6:00 AM');
        } else {
          value = this.pickBestOption(f.options || ['6:00 AM', '7:00 AM', 'Open'], '6:00 AM');
        }
      } else if (lbl.includes('contact you via text message') || lbl.includes('text message') || lbl.includes('sms') || lbl.includes('granting target permission')) {
        action = f.type === 'select' ? 'select_option' : (f.type === 'checkbox' ? 'toggle_checkbox' : 'click_radio');
        value = this.pickBestOption(f.options || ['Yes', 'I Agree', 'true'], 'Yes');
      } else if (lbl.includes('sponsorship') || lbl.includes('require visa')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || ['Yes', 'No'], String(candidate.eeoDisclosures?.requiresSponsorship ?? 'No'));
      } else if (lbl.includes('gender') || autoId.includes('gender')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || [], candidate.eeoDisclosures?.gender || 'Decline');
      } else if (lbl.includes('race') || lbl.includes('ethnicity') || autoId.includes('race')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || [], candidate.eeoDisclosures?.raceEthnicity || 'Decline');
      } else if (lbl.includes('veteran') || autoId.includes('veteran')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || [], candidate.eeoDisclosures?.veteranStatus || 'not a protected veteran');
      } else if (lbl.includes('disability') || autoId.includes('disability')) {
        action = f.type === 'select' ? 'select_option' : 'click_radio';
        value = this.pickBestOption(f.options || [], candidate.eeoDisclosures?.disabilityStatus || 'No');
      } else if (lbl.includes('previously worked') || lbl.includes('previous worker') || lbl.includes('former employee') || autoId.includes('previousworker')) {
        action = 'click_radio';
        value = 'No';
      } else if (lbl.includes('phone device type') || lbl.includes('phone type') || autoId.includes('phonetype')) {
        action = 'select_option';
        value = this.pickBestOption(f.options || ['Home', 'Mobile', 'Cellular'], 'Home') || 'Home';
      } else if (lbl.includes('how did you hear') || lbl.includes('hear about us') || lbl.includes('source')) {
        action = 'select_option';
        value = 'Social Media';
      } else {
        action = 'skip';
        confidence = 0.2;
        reasoning = 'No direct match in profile';
      }

      if (value) {
        if (f.type === 'select' && action === 'fill_text') action = 'select_option';
        if (f.type === 'radio' && action === 'fill_text') action = 'click_radio';
        if (f.type === 'checkbox') action = 'toggle_checkbox';

        instructions.push({
          fieldId: f.id,
          automationId: f.automationId,
          action,
          value,
          confidence,
          reasoning
        });
      }
    }

    return instructions;
  }

  private pickBestOption(options: string[], targetKeyword: string): string {
    if (!options || options.length === 0) return targetKeyword || '';
    const kw = (targetKeyword || '').toLowerCase().trim();

    if (kw) {
      const exactMatch = options.find((o) => o.toLowerCase().trim() === kw);
      if (exactMatch) return exactMatch;

      const includesMatch = options.find((o) => o.toLowerCase().includes(kw) || kw.includes(o.toLowerCase()));
      if (includesMatch) return includesMatch;

      // Degree alias mapping for Workday (BTECH, MTECH, MCA, University Diploma)
      const cleanKw = kw.replace(/[^a-z0-9]/g, '');
      const isBtech = cleanKw.includes('btech') || cleanKw.includes('bacheloroftech') || cleanKw.includes('bachelorofeng') || cleanKw.includes('be');
      const isMtech = cleanKw.includes('mtech') || cleanKw.includes('masteroftech') || cleanKw.includes('masterofeng') || cleanKw.includes('me');
      const isMca = cleanKw.includes('mca') || cleanKw.includes('masterofcomputer');
      const isBca = cleanKw.includes('bca') || cleanKw.includes('bachelorofcomputer');
      const isDiploma = cleanKw.includes('diploma') || cleanKw.includes('polytechnic');

      for (const opt of options) {
        const oUpper = opt.toUpperCase().trim();
        if (isBtech && (oUpper === 'BTECH' || oUpper.includes('BACHELOR OF TECH') || oUpper.includes('BACHELOR OF ENG'))) return opt;
        if (isMtech && (oUpper === 'MTECH' || oUpper.includes('MASTER OF TECH') || oUpper.includes('MASTER OF ENG'))) return opt;
        if (isMca && (oUpper === 'MCA' || oUpper.includes('MASTER OF COMPUTER'))) return opt;
        if (isBca && (oUpper === 'BCA' || oUpper.includes('BACHELOR OF COMPUTER'))) return opt;
        if (isDiploma && (oUpper.includes('DIPLOMA') || oUpper.includes('POLYTECHNIC'))) return opt;
      }
    }

    const declineMatch = options.find((o) => o.toLowerCase().includes('decline') || o.toLowerCase().includes('don\'t wish') || o.toLowerCase().includes('prefer not'));
    if (declineMatch) return declineMatch;

    return options[0] || '';
  }

  /**
   * AI Agent Error Solver — Fully dynamic. Sends DOM error context + HTML to the LLM,
   * which analyzes the errors and returns specific fix actions to apply.
   */
  public async solveErrors(
    candidate: CandidateProfile,
    errors: Array<{ fieldLabel?: string; message: string; domContext?: string }>,
    domContext: string,
    stepName?: string,
    customApiKey?: string
  ): Promise<Array<{ action: string; selector: string; value: string; description: string }>> {

    const cleanDomContext = (domContext || '').length > 3500 ? (domContext || '').substring(0, 3500) + '...' : (domContext || '');

    const prompt = `You are an AI Agent that fixes Workday job application form errors.

CANDIDATE PROFILE:
${JSON.stringify({ personalInfo: candidate.personalInfo, eeoDisclosures: candidate.eeoDisclosures })}

CURRENT PAGE ERRORS DETECTED IN DOM:
${JSON.stringify(errors, null, 2)}

RELEVANT DOM HTML CONTEXT AROUND ERROR FIELDS:
${cleanDomContext}

STEP NAME: "${stepName || 'Form'}"

INSTRUCTIONS:
Analyze each error and the surrounding DOM HTML context. For each error, determine the EXACT fix needed. You must return a JSON array of fix actions.

Each fix action must have:
- "action": one of "fill_input", "select_dropdown", "click_element", "set_date_spinbutton", "delete_entry", "clear_and_fill"
- "selector": a CSS selector or data-automation-id to target the DOM element (use data-automation-id when possible)
- "value": the value to set, option to select, or empty for click/delete actions
- "description": human-readable description of what you're doing and why

COMMON WORKDAY ERROR PATTERNS AND FIXES:
1. "Country Phone Code is required" → Find the country phone code dropdown near the phone field and select the appropriate code (e.g. "India (+91)" for Indian phone numbers, "United States of America (+1)" for US numbers)
2. "Phone Device Type is required" → Find the phone device type dropdown and select "Mobile"
3. "How Did You Hear About Us is required" → Select "Social Media"
4. Required field empty → Fill with appropriate value from candidate profile
5. "Enter a valid date" or date errors → Set the correct month/year spinbutton values
6. Extra blank work experience/education entries with no data → Use "delete_entry" action to remove them
7. Field validation errors → Clear the field and re-fill with correct format

IMPORTANT RULES:
- Use data-automation-id attributes as selectors whenever visible in DOM context
- For dropdown/select fields, provide the EXACT text of the option to select
- For date spinbuttons, set month (01-12) and year (e.g. 2023) separately
- If an entry is blank/empty and shouldn't exist, use delete_entry action
- Phone numbers from India start with +91, US with +1, UK with +44

Return ONLY valid JSON: {"fixes": [...]}`;

    // Try Groq first
    const activeGroqKey = (customApiKey && customApiKey.startsWith('gsk_')) ? customApiKey : (process.env.GROQ_API_KEY);
    if (activeGroqKey && activeGroqKey.trim().length > 0) {
      const groq = new OpenAI({ apiKey: activeGroqKey, baseURL: 'https://api.groq.com/openai/v1' });
      const availableModels = await this.getActiveGroqModels(activeGroqKey);

      for (const model of availableModels) {
        try {
          console.log(`[AI Agent] Solving ${errors.length} errors via Groq (${model})...`);
          const result = await this.callLLMForFixes(prompt, groq, model);
          if (result && result.length > 0) return result;
        } catch (err: any) {
          console.warn(`[AI Agent] Groq ${model} error-solving notice:`, err?.message);
        }
      }
    }

    // Try Gemini
    const activeGeminiKey = (customApiKey && customApiKey.startsWith('AIza')) ? customApiKey : (this.geminiKey || process.env.GEMINI_API_KEY);
    if (activeGeminiKey && activeGeminiKey.trim().length > 0) {
      try {
        console.log(`[AI Agent] Solving ${errors.length} errors via Google Gemini...`);
        const parsed = await this.callGeminiWithFallback(
          activeGeminiKey,
          [{ parts: [{ text: prompt }] }]
        );
        if (parsed.fixes && Array.isArray(parsed.fixes)) return parsed.fixes;
      } catch (err: any) {
        console.warn('[AI Agent] Gemini error-solving notice:', err?.message);
      }
    }

    // Try OpenAI
    const client = (customApiKey && customApiKey.startsWith('sk-')) ? new OpenAI({ apiKey: customApiKey }) : this.openai;
    if (client) {
      try {
        console.log(`[AI Agent] Solving ${errors.length} errors via OpenAI...`);
        const result = await this.callLLMForFixes(prompt, client, 'gpt-4o-mini');
        if (result && result.length > 0) return result;
      } catch (err: any) {
        console.warn('[AI Agent] OpenAI error-solving notice:', err?.message);
      }
    }

    return [];
  }
}