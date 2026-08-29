import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Update password
export async function PUT(req: NextRequest) {
  try {
    const { email, oldPassword, newPassword } = await req.json();

    if (!email || !oldPassword || !newPassword) {
      return NextResponse.json({ error: 'Email, old password and new password are required.' }, { status: 400, headers: corsHeaders });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404, headers: corsHeaders });
    }

    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401, headers: corsHeaders });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { email },
      data: { password: hashedNew },
    });

    return NextResponse.json({ success: true, message: 'Password updated successfully.' }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Update password error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Update failed.' }, { status: 500, headers: corsHeaders });
  }
}
