import { NextRequest, NextResponse } from 'next/server';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { AIService } from '@/lib/aiService';

const aiService = new AIService();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-openai-key',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Extract all hyperlinks embedded in PDF annotations/actions
 */
function extractPdfHyperlinks(pdfBuffer: Buffer): string[] {
  const links: string[] = [];
  try {
    // Scan raw PDF buffer bytes for URI annotations like /URI (https://...)
    const rawStr = pdfBuffer.toString('latin1');

    // Pattern 1: /URI (https://...) or /URI(https://...)
    const uriPattern = /\/URI\s*\(([^)]+)\)/gi;
    let match;
    while ((match = uriPattern.exec(rawStr)) !== null) {
      const url = match[1].trim();
      if (url.startsWith('http') || url.startsWith('www.')) {
        links.push(url);
      }
    }

    // Pattern 2: /A <<...>> /URI (...)
    const altPattern = /\/URI\s*\(([^)]+)\)/gi;
    while ((match = altPattern.exec(rawStr)) !== null) {
      const url = match[1].trim();
      if ((url.startsWith('http') || url.startsWith('www.')) && !links.includes(url)) {
        links.push(url);
      }
    }
  } catch {
    // Silent fallback
  }
  return Array.from(new Set(links));
}

/**
 * Extract hyperlinks from text content using regex
 */
function extractTextHyperlinks(text: string): string[] {
  const links: string[] = [];
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    links.push(match[0].replace(/[.,;:!?)]+$/, '')); // Trim trailing punctuation
  }
  // Also extract www. links
  const wwwPattern = /www\.[^\s<>"{}|\\^`\[\]]+/gi;
  while ((match = wwwPattern.exec(text)) !== null) {
    const url = `https://${match[0].replace(/[.,;:!?)]+$/, '')}`;
    if (!links.includes(url)) links.push(url);
  }
  return Array.from(new Set(links));
}

/**
 * Looks up the postal code for a given city + state using OpenStreetMap Nominatim
 * (free, no API key required, works worldwide).
 */
async function lookupPostalCode(city: string, state: string, country?: string): Promise<string> {
  try {
    const parts = [city, state, country || ''].filter(Boolean).join(', ');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(parts)}&format=json&addressdetails=1&limit=5`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'WorkdayAIAutoFiller/1.0 (contact: support@workdayai.dev)',
        'Accept-Language': 'en'
      }
    });
    if (!res.ok) return '';
    const results = await res.json() as any[];
    // Find first result that has a postal code
    for (const r of results) {
      const pc = r.address?.postcode || r.address?.postal_code || '';
      if (pc && pc.trim()) {
        console.log(`[PostalLookup] Found postal code "${pc}" for "${parts}"`);
        return pc.trim();
      }
    }
    return '';
  } catch (err: any) {
    console.warn('[PostalLookup] Nominatim lookup failed:', err?.message || err);
    return '';
  }
}

export async function POST(req: NextRequest) {
  try {
    let rawText = '';
    let extractedHyperlinks: string[] = [];
    const customApiKey = req.headers.get('x-openai-key') || undefined;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('resume') as File | null;
      const textFromForm = formData.get('resumeText') as string | null;

      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.pdf')) {
          // Extract text content
          const parsedPdf = await pdfParse(buffer);
          rawText = parsedPdf.text;

          // Extract embedded hyperlinks from PDF annotations (clickable links)
          extractedHyperlinks = extractPdfHyperlinks(buffer);
        } else if (fileName.endsWith('.docx')) {
          const parsedDoc = await mammoth.extractRawText({ buffer });
          rawText = parsedDoc.value;
        } else {
          return NextResponse.json({ error: 'Unsupported file format. Please upload PDF or DOCX.' }, { status: 400, headers: corsHeaders });
        }
      } else if (textFromForm) {
        rawText = textFromForm;
      }
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.resumeText) {
        rawText = body.resumeText;
      }
    }

    if (!rawText || !rawText.trim()) {
      return NextResponse.json({ error: 'No resume file or resumeText content provided.' }, { status: 400, headers: corsHeaders });
    }

    // Also extract hyperlinks from text content (visible URLs)
    const textLinks = extractTextHyperlinks(rawText);
    extractedHyperlinks = Array.from(new Set([...extractedHyperlinks, ...textLinks]));

    // Append extracted hyperlinks to rawText so AI can see them
    if (extractedHyperlinks.length > 0) {
      rawText += '\n\n--- EXTRACTED HYPERLINKS FROM RESUME ---\n';
      rawText += extractedHyperlinks.join('\n');
    }

    // Step 1: Initial extraction
    const initialProfile = await aiService.parseResumeText(rawText, customApiKey);

    // Merge extracted hyperlinks into initialProfile
    initialProfile.hyperlinks = extractedHyperlinks;

    // Auto-fill LinkedIn, GitHub, Website from hyperlinks if not already set
    if (!initialProfile.personalInfo.linkedin) {
      const linkedinLink = extractedHyperlinks.find(l => l.includes('linkedin.com'));
      if (linkedinLink) initialProfile.personalInfo.linkedin = linkedinLink;
    }
    if (!initialProfile.personalInfo.github) {
      const githubLink = extractedHyperlinks.find(l => l.includes('github.com'));
      if (githubLink) initialProfile.personalInfo.github = githubLink;
    }
    if (!initialProfile.personalInfo.website) {
      const websiteLink = extractedHyperlinks.find(l =>
        !l.includes('linkedin.com') && !l.includes('github.com') &&
        !l.includes('mailto:') && !l.includes('google.com') &&
        (l.includes('portfolio') || l.includes('vercel') || l.includes('netlify') || l.includes('heroku') || l.includes('.dev') || l.includes('.io'))
      );
      if (websiteLink) initialProfile.personalInfo.website = websiteLink;
    }

    // Step 2: Pass to Resume AI Checker Agent for comprehensive verification & detail completion
    console.log('[API parse-resume] Invoking Resume AI Checker Agent for deep inspection...');
    const checkedResult = await aiService.runResumeAIChecker(rawText, initialProfile, customApiKey);
    const profile = checkedResult.profile;

    // Step 3: Postal Code Geo-Lookup — if AI didn't extract postal code, search by city + state
    const addr = profile.personalInfo.address;
    if (addr && !addr.postalCode && (addr.city || addr.state)) {
      console.log(`[API parse-resume] Postal code missing — looking up via OpenStreetMap for "${addr.city}, ${addr.state}"...`);
      const lookedUpPostal = await lookupPostalCode(addr.city || '', addr.state || '', addr.country || '');
      if (lookedUpPostal) {
        profile.personalInfo.address = { ...addr, postalCode: lookedUpPostal };
        console.log(`[API parse-resume] ✓ Postal code set to "${lookedUpPostal}" via geo-lookup`);
      }
    }

    return NextResponse.json({
      success: true,
      profile,
      checkerReport: checkedResult.checkerReport,
      rawTextLength: rawText.length,
      extractedHyperlinks
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Error in /api/parse-resume:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to parse resume.' }, { status: 500, headers: corsHeaders });
  }
}
