import { NextRequest, NextResponse } from 'next/server';
import { AIService } from '@/lib/aiService';
import { CandidateProfile } from '@/lib/types';

const aiService = new AIService();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-openai-key',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const customApiKey = req.headers.get('x-openai-key') || undefined;
    const body = await req.json().catch(() => ({}));

    const rawResumeText: string = body.rawResumeText || body.resumeText || '';
    const initialProfile: CandidateProfile = body.candidate || body.profile || null;

    if (!rawResumeText && !initialProfile) {
      return NextResponse.json(
        { success: false, error: 'Please provide either rawResumeText or candidate profile JSON.' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log('[API /api/resume-ai-checker] Running Resume AI Checker Agent...');
    const result = await aiService.runResumeAIChecker(
      rawResumeText || JSON.stringify(initialProfile),
      initialProfile || {
        personalInfo: { firstName: '', lastName: '', fullName: '', email: '', phone: '', address: { street: '', city: '', state: '', postalCode: '', country: '' }, linkedin: '', github: '', website: '' },
        workExperience: [],
        education: [],
        skills: [],
        certifications: [],
        summary: ''
      },
      customApiKey
    );

    return NextResponse.json(
      {
        success: true,
        profile: result.profile,
        checkerReport: result.checkerReport
      },
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('Error in /api/resume-ai-checker:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to run Resume AI Checker.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
