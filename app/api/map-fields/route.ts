import { NextRequest, NextResponse } from 'next/server';
import { AIService } from '@/lib/aiService';
import { MapFieldsRequest } from '@/lib/types';

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
    const body = (await req.json()) as MapFieldsRequest;
    const customApiKey = req.headers.get('x-openai-key') || undefined;

    const { candidate, fields, stepName, pageErrors } = body;

    if (!candidate || !fields || !Array.isArray(fields)) {
      return NextResponse.json({ error: 'Invalid payload. Candidate profile and fields array are required.' }, { status: 400, headers: corsHeaders });
    }

    const instructions = await aiService.mapFields(candidate, fields, stepName, customApiKey, pageErrors);

    return NextResponse.json({
      success: true,
      instructions,
      mappedCount: instructions.filter((i) => i.action !== 'skip').length,
      totalFields: fields.length
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Error in /api/map-fields:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to map fields.' }, { status: 500, headers: corsHeaders });
  }
}
