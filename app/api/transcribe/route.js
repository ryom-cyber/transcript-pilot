import { NextResponse } from 'next/server';

export const maxDuration = 120;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'GEMINI_API_KEY が設定されていません。Vercel の Settings → Environment Variables で GEMINI_API_KEY を追加後、Redeploy してください。',
    }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) return NextResponse.json({ error: 'ファイルがありません' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const base64      = Buffer.from(arrayBuffer).toString('base64');
    const mimeType    = normalizeMime(file.type, file.name);

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64 } },
            { text: 'この音声を日本語でできる限り正確に文字起こしてください。話者が複数いる場合は「営業：」「顧客：」のように話者を区別してください。文字起こし結果だけを返してください。' }
          ]
        }]
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API エラー ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function normalizeMime(type, name) {
  if (type && type !== 'application/octet-stream') return type;
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = { mp3:'audio/mp3', m4a:'audio/mp4', wav:'audio/wav', webm:'audio/webm', ogg:'audio/ogg', mp4:'audio/mp4' };
  return map[ext] || 'audio/mp3';
}
