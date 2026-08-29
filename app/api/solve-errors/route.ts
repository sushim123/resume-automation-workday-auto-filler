import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const customApiKey = req.headers.get('x-openai-key') || undefined;

    const { candidate, errors, domContext, stepName } = body;

    if (!candidate || !errors || !Array.isArray(errors) || errors.length === 0) {
      return NextResponse.json(
        { error: 'Invalid payload. Candidate profile and errors array are required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const fixes = await aiService.solveErrors(candidate, errors, domContext, stepName, customApiKey);

    return NextResponse.json({
      success: true,
      fixes,
      fixCount: fixes.length
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Error in /api/solve-errors:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to solve errors.' },
      { status: 500, headers: corsHeaders }
    );
  }
}
