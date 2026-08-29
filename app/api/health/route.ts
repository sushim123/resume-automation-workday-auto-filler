import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-openai-key',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json(
    {
      status: 'online',
      timestamp: new Date().toISOString(),
      service: 'Workday AI Automation Next.js Server',
      version: '1.0.0'
    },
    { headers: corsHeaders }
  );
}
