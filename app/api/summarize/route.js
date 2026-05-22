import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT = `あなたは一休.com（高級レストラン・ホテル予約サービス）のインサイドセールス担当者です。
以下の架電録音の文字起こしを分析し、Salesforce入力用の営業日報を以下のJSON形式で返してください。

【重要ルール】
- 会話に明示的に登場した情報のみを使用すること
- 不明・言及のない情報は「情報なし」と記載
- 推測・創作は絶対に禁止
- ikyu_interest_levelは必ず【前向き】【要アプローチ】【時期尚早】のいずれかで始めること

JSON形式:
{
  "company_name": "取引先・店舗名",
  "key_contact": "キーマンの名前と役職",
  "core_challenge": "顧客の核心的な課題",
  "ikyu_interest_level": "【前向き/要アプローチ/時期尚早】＋根拠",
  "next_action": "次回アクション・日時・持参資料"
}`;

export async function POST(request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'GEMINI_API_KEY が設定されていません。Vercel の Settings → Environment Variables で GEMINI_API_KEY を追加後、Redeploy してください。',
    }, { status: 500 });
  }

  try {
    const { transcript } = await request.json();
    if (!transcript?.trim()) {
      return NextResponse.json({ error: '文字起こしテキストが空です' }, { status: 400 });
    }

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\n【文字起こし】\n${transcript}` }] }],
        generationConfig: { response_mime_type: 'application/json' },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Gemini API エラー ${res.status}`);
    }

    const data    = await res.json();
    const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const summary = JSON.parse(raw);
    return NextResponse.json({ summary });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
