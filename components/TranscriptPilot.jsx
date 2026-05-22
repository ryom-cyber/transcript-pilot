'use client';

import { useState, useCallback, useRef } from 'react';

const FIELDS = [
  { key: 'company_name',        label: '取引先名 / 店舗名',         emoji: '🏢' },
  { key: 'key_contact',         label: 'キーマン / 役職',           emoji: '👤' },
  { key: 'core_challenge',      label: '顧客の核心的な課題',         emoji: '💡' },
  { key: 'ikyu_interest_level', label: '一休に対する温度感',         emoji: '🌡️' },
  { key: 'next_action',         label: '次回アクション & 持参資料',  emoji: '📅' },
];

function temperatureClass(text) {
  if (!text) return '';
  if (text.includes('前向き'))         return 'positive';
  if (text.includes('要アプローチ'))   return 'needs-approach';
  if (text.includes('時期尚早'))       return 'premature';
  return '';
}

function formatClipboard(summary) {
  return FIELDS.map(f => `【${f.label}】\n${summary[f.key]}`).join('\n\n');
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function fmtBytes(b) {
  return b < 1024 * 1024 ? (b / 1024).toFixed(1) + ' KB' : (b / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function TranscriptPilot() {
  const [tab, setTab]                   = useState('upload');
  const [selectedFile, setSelectedFile] = useState(null);
  const [recState, setRecState]         = useState('idle'); // idle | active | preview
  const [recSeconds, setRecSeconds]     = useState(0);
  const [recBlobUrl, setRecBlobUrl]     = useState('');
  const [transcript, setTranscript]     = useState('');
  const [summary, setSummary]           = useState(null);
  const [step, setStep]                 = useState('input'); // input | transcribing | transcribed | summarizing | done
  const [error, setError]               = useState('');
  const [copied, setCopied]             = useState(false);
  const [isDragOver, setIsDragOver]     = useState(false);

  const fileInputRef   = useRef(null);
  const mediaRecRef    = useRef(null);
  const chunksRef      = useRef([]);
  const timerRef       = useRef(null);
  const recBlobRef     = useRef(null);

  /* ── FILE ── */
  const setFile = useCallback((f) => {
    if (f.size > 20 * 1024 * 1024) { setError('ファイルサイズは20MB以下にしてください'); return; }
    setSelectedFile(f); setError('');
  }, []);

  const clearFile = useCallback(() => setSelectedFile(null), []);

  const onDrop = useCallback((e) => {
    e.preventDefault(); setIsDragOver(false);
    const f = e.dataTransfer.files[0]; if (f) setFile(f);
  }, [setFile]);

  /* ── RECORDING ── */
  const startRecording = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
        .find(m => MediaRecorder.isTypeSupported(m)) || '';
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        recBlobRef.current = blob;
        setRecBlobUrl(URL.createObjectURL(blob));
        setRecState('preview');
      };
      mr.start(200);
      mediaRecRef.current = mr;
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
      setRecState('active');
    } catch {
      setError('マイクへのアクセスが拒否されました。ブラウザの権限設定を確認してください。');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') mediaRecRef.current.stop();
  }, []);

  const retryRecording = useCallback(() => {
    recBlobRef.current = null;
    setRecBlobUrl(''); setRecState('idle'); setRecSeconds(0);
  }, []);

  /* ── TRANSCRIBE ── */
  const runTranscribe = useCallback(async (file) => {
    setError(''); setStep('transcribing'); setTranscript(''); setSummary(null);

    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '文字起こしに失敗しました');
      setTranscript(data.text);
      setStep('transcribed');
    } catch (e) {
      setError(e.message); setStep('input');
    }
  }, []);

  const startTranscribeFile = useCallback(() => {
    if (selectedFile) runTranscribe(selectedFile);
  }, [selectedFile, runTranscribe]);

  const startTranscribeRec = useCallback(() => {
    if (!recBlobRef.current) return;
    const blob = recBlobRef.current;
    const ext  = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    const now  = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    runTranscribe(new File([blob], `録音_${stamp}.${ext}`, { type: blob.type }));
  }, [runTranscribe]);

  /* ── SUMMARIZE ── */
  const startSummarize = useCallback(async () => {
    if (!transcript.trim()) return;
    setError(''); setStep('summarizing');

    try {
      const res  = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'サマリー生成に失敗しました');
      setSummary(data.summary);
      setStep('done');
    } catch (e) {
      setError(e.message); setStep('transcribed');
    }
  }, [transcript]);

  /* ── COPY ── */
  const copySummary = useCallback(() => {
    if (!summary) return;
    navigator.clipboard.writeText(formatClipboard(summary));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [summary]);

  /* ── RESET ── */
  const resetAll = useCallback(() => {
    setSelectedFile(null); recBlobRef.current = null;
    setRecBlobUrl(''); setRecState('idle'); setRecSeconds(0);
    setTranscript(''); setSummary(null);
    setStep('input'); setError(''); setCopied(false); setTab('upload');
    clearInterval(timerRef.current);
    if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') mediaRecRef.current.stop();
  }, []);

  const isProcessing = step === 'transcribing' || step === 'summarizing';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">TP</div>
          <div>
            <div className="text-base font-bold text-gray-900 leading-tight">Transcript-Pilot</div>
            <div className="text-xs text-gray-400 mt-0.5">架電録音 自動文字起こし &amp; Salesforceサマリー生成</div>
          </div>
          <span className="ml-auto text-xs bg-indigo-50 text-indigo-600 font-semibold px-2.5 py-1 rounded-full">一休営業特化版</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-7 flex flex-col gap-5">

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-3 text-sm">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <div>
              <div className="font-semibold text-red-700">エラー</div>
              <div className="text-red-600 mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* STEP 1: 音声入力 */}
        {(step === 'input') && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">STEP 1 · 音声を入力</span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {[
                { id: 'upload', label: 'ファイルをアップロード', icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12' },
                { id: 'record', label: 'いま録音する',           icon: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z' },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-r last:border-r-0 border-gray-100
                    ${tab === t.id ? 'bg-white text-indigo-600' : 'bg-gray-50 text-gray-400 hover:text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon}/>
                  </svg>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Upload Panel */}
            {tab === 'upload' && (
              <div>
                {!selectedFile ? (
                  <div
                    className={`m-5 border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
                      ${isDragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40'}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={onDrop}
                  >
                    <input ref={fileInputRef} type="file" className="hidden"
                      accept=".mp3,.m4a,.wav,.mp4,.webm,audio/*"
                      onChange={e => { const f = e.target.files[0]; if (f) setFile(f); e.target.value = ''; }} />
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3 transition-colors ${isDragOver ? 'bg-indigo-100' : 'bg-gray-100'}`}>
                      <svg className={`w-7 h-7 ${isDragOver ? 'text-indigo-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                      </svg>
                    </div>
                    <div className="text-sm font-semibold text-gray-700">録音ファイルをドラッグ &amp; ドロップ</div>
                    <div className="text-xs text-gray-400 mt-1">またはクリックして選択</div>
                    <div className="text-xs text-gray-300 mt-2">MP3 / M4A / WAV / WebM · 最大 20MB</div>
                  </div>
                ) : (
                  <div className="mx-5 mt-4 mb-0 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center gap-3">
                    <svg className="w-5 h-5 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    <span className="text-sm font-semibold text-indigo-800 flex-1 truncate">{selectedFile.name}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0">{fmtBytes(selectedFile.size)}</span>
                    <button onClick={clearFile} className="w-5 h-5 rounded-full bg-gray-300 text-white text-xs flex items-center justify-center flex-shrink-0">✕</button>
                  </div>
                )}
                <div className="p-5 pt-4">
                  <button onClick={startTranscribeFile} disabled={!selectedFile}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                    </svg>
                    文字起こし開始
                  </button>
                </div>
              </div>
            )}

            {/* Record Panel */}
            {tab === 'record' && (
              <div>
                <div className="flex flex-col items-center py-8 px-6 gap-5">
                  {/* idle */}
                  {recState === 'idle' && (
                    <>
                      <button onClick={startRecording}
                        className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all">
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/>
                        </svg>
                      </button>
                      <div className="text-sm text-gray-500">マイクボタンを押して録音開始</div>
                    </>
                  )}

                  {/* active */}
                  {recState === 'active' && (
                    <>
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-sm font-bold text-red-500 tracking-widest">REC</span>
                      </div>
                      <div className="text-5xl font-light text-gray-900 tabular-nums tracking-widest">{fmtTime(recSeconds)}</div>
                      <div className="flex items-center gap-1 h-8">
                        {[8,18,26,12,22,9,24,16,20].map((h, i) => (
                          <div key={i} className="w-1 rounded-full bg-indigo-500 animate-bounce" style={{height:h, animationDelay:`${i*0.1}s`, animationDuration:'1s'}} />
                        ))}
                      </div>
                      <button onClick={stopRecording}
                        className="flex items-center gap-2 bg-red-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-red-600 transition-colors shadow">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
                        録音停止
                      </button>
                    </>
                  )}

                  {/* preview */}
                  {recState === 'preview' && (
                    <>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
                        </svg>
                        録音完了 &nbsp;<span className="text-gray-400 text-xs">{fmtTime(recSeconds)}</span>
                      </div>
                      <audio src={recBlobUrl} controls className="w-full max-w-md" />
                      <button onClick={retryRecording} className="text-sm text-gray-500 border border-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50">
                        録り直す
                      </button>
                    </>
                  )}
                </div>

                {recState === 'preview' && (
                  <div className="px-5 pb-5">
                    <button onClick={startTranscribeRec}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                      文字起こし開始
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: 文字起こし中 / 結果 */}
        {(step === 'transcribing' || step === 'transcribed' || step === 'summarizing' || step === 'done') && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${step === 'transcribing' ? 'bg-indigo-400' : 'bg-indigo-500'}`} />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">STEP 2 · 文字起こし結果</span>
              {transcript && <span className="ml-auto text-xs text-gray-400">{transcript.length.toLocaleString()} 文字</span>}
            </div>

            {step === 'transcribing' && (
              <div className="flex items-center gap-3 px-5 py-5 text-sm text-gray-500">
                <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin flex-shrink-0" />
                Gemini AIで文字起こし中... 音声の長さによっては数分かかります
              </div>
            )}

            {(step !== 'transcribing') && transcript && (
              <div className="p-5">
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  className="w-full min-h-40 max-h-72 resize-y bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-700 leading-relaxed outline-none focus:border-indigo-400 font-sans"
                />
                <div className="text-xs text-gray-400 mt-2">内容を確認・修正してから「Salesforceサマリーを生成」を押してください</div>
              </div>
            )}

            {step === 'transcribed' && (
              <div className="px-5 pb-5">
                <button onClick={startSummarize}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  Salesforceサマリーを生成
                </button>
              </div>
            )}

            {step === 'summarizing' && (
              <div className="flex items-center gap-3 px-5 pb-5 text-sm text-gray-500">
                <div className="w-5 h-5 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin flex-shrink-0" />
                Gemini AIでSalesforceサマリーを生成中...
              </div>
            )}
          </div>
        )}

        {/* STEP 3: サマリー */}
        {step === 'done' && summary && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">STEP 3 · Salesforce サマリー</span>
            </div>

            {FIELDS.map((f, i) => (
              <div key={f.key}
                className={`px-5 py-4 ${i > 0 ? 'border-t border-gray-50' : ''}
                  ${f.key === 'ikyu_interest_level' ? {
                    positive: 'bg-green-50 border-l-4 border-l-green-400',
                    'needs-approach': 'bg-yellow-50 border-l-4 border-l-yellow-400',
                    premature: 'bg-red-50 border-l-4 border-l-red-400',
                    '': '',
                  }[temperatureClass(summary[f.key])] || '' : ''}`}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-sm">{f.emoji}</span>
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{f.label}</span>
                </div>
                <div className="text-sm text-gray-800 leading-relaxed pl-5 whitespace-pre-wrap">{summary[f.key]}</div>
              </div>
            ))}

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={resetAll}
                className="flex items-center gap-1.5 bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                </svg>
                新しい架電を解析
              </button>
              <button onClick={copySummary}
                className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-bold transition-colors
                  ${copied ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                {copied ? (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>コピー完了</>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Salesforceへコピー</>
                )}
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
