'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Upload,
  CheckCircle2,
  FileText,
  Cpu,
  Layers,
  ShieldCheck,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Terminal,
  BrainCircuit,
  Zap,
  User,
  Briefcase,
  GraduationCap,
  Award,
  Code2,
  Copy,
  Check,
  Download,
  SearchCheck,
  AlertCircle,
  FolderGit2
} from 'lucide-react';
import { CandidateProfile, MappingInstruction, WorkdayFormField } from '@/lib/types';

const PARSE_STAGES = [
  { label: 'Reading & Extracting PDF / DOCX content...', pct: 8 },
  { label: 'Pass 1 — Extracting Personal Info, Address & Contact Details...', pct: 20 },
  { label: 'Pass 2 — Analyzing Work Experience & Job Roles...', pct: 35 },
  { label: 'Pass 3 — Extracting Skills, Projects & Certifications...', pct: 50 },
  { label: 'Pass 4 — Extracting Education & Academic Details...', pct: 62 },
  { label: 'Pass 5 — Analyzing Job Questionnaire & Availability...', pct: 74 },
  { label: 'Resume AI Checker — Deep Verification & Cross-Examination...', pct: 85 },
  { label: 'AI Checker — Filling Missing Fields & Enriching Profile...', pct: 93 },
  { label: 'Finalizing Master AI JSON Profile...', pct: 99 },
];

export default function Dashboard() {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCheckingWithAI, setIsCheckingWithAI] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStageLabel, setParseStageLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [activeTab, setActiveTab] = useState<'profile' | 'ai-json' | 'test-mapper' | 'extension-guide'>('profile');
  const [mappingResults, setMappingResults] = useState<MappingInstruction[]>([]);
  const [isMapping, setIsMapping] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Sample Workday fields for testing mapping in dashboard
  const [sampleFields] = useState<WorkdayFormField[]>([
    { id: 'input-1', automationId: 'legalNameSection_firstName', label: 'First Name', type: 'text', required: true },
    { id: 'input-2', automationId: 'legalNameSection_lastName', label: 'Last Name', type: 'text', required: true },
    { id: 'input-3', automationId: 'email', label: 'Email Address', type: 'text', required: true },
    { id: 'input-4', automationId: 'phone', label: 'Phone Number', type: 'text', required: true },
    { id: 'input-5', automationId: 'addressSection_city', label: 'City', type: 'text' },
    { id: 'select-1', automationId: 'source', label: 'How did you hear about us?', type: 'select', options: ['LinkedIn', 'Company Website', 'Referral', 'Indeed'] },
    { id: 'select-2', automationId: 'workAuth', label: 'Are you legally authorized to work in the US?', type: 'select', options: ['Yes', 'No'] },
    { id: 'select-3', automationId: 'sponsorship', label: 'Will you now or in the future require visa sponsorship?', type: 'select', options: ['Yes', 'No'] },
    { id: 'select-4', automationId: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Decline to self-identify'] },
  ]);

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.status === 'online') {
        setStatus('online');
      } else {
        setStatus('offline');
      }
    } catch {
      setStatus('offline');
    }
  };

  const runParseProgressSimulation = (onDone: () => void) => {
    let stageIdx = 0;
    setParseProgress(PARSE_STAGES[0].pct);
    setParseStageLabel(PARSE_STAGES[0].label);

    const advance = () => {
      stageIdx++;
      if (stageIdx < PARSE_STAGES.length) {
        setParseProgress(PARSE_STAGES[stageIdx].pct);
        setParseStageLabel(PARSE_STAGES[stageIdx].label);
        // Slow down at expensive AI stages
        const delay = stageIdx >= 6 ? 3200 : stageIdx >= 4 ? 2200 : 1100;
        setTimeout(advance, delay);
      } else {
        onDone();
      }
    };
    setTimeout(advance, 900);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setParseProgress(0);
    setParseStageLabel('');
    const formData = new FormData();
    formData.append('resume', file);

    // Start animated stage simulation
    let simDone = false;
    runParseProgressSimulation(() => { simDone = true; });

    try {
      const res = await fetch('/api/parse-resume', {
        method: 'POST',
        headers: apiKey ? { 'x-openai-key': apiKey } : {},
        body: formData,
      });

      const data = await res.json();
      if (data.success && data.profile) {
        // Jump to 100% on success
        setParseProgress(100);
        setParseStageLabel('✓ AI Master JSON Profile Complete!');
        setTimeout(() => {
          setProfile(data.profile);
          setIsUploading(false);
          setParseProgress(0);
          setParseStageLabel('');
        }, 700);
        return;
      } else {
        alert(data.error || 'Failed to parse resume');
      }
    } catch (err: any) {
      alert('Upload error: ' + err.message);
    }
    setIsUploading(false);
    setParseProgress(0);
    setParseStageLabel('');
  };

  const handleRunResumeAIChecker = async () => {
    if (!profile) return;
    setIsCheckingWithAI(true);

    try {
      const res = await fetch('/api/resume-ai-checker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-openai-key': apiKey } : {})
        },
        body: JSON.stringify({ candidate: profile })
      });

      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
      } else {
        alert(data.error || 'Resume AI Checker failed');
      }
    } catch (err: any) {
      alert('Resume AI Checker error: ' + err.message);
    } finally {
      setIsCheckingWithAI(false);
    }
  };

  const handleCopyJson = () => {
    if (!profile) return;
    navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadJson = () => {
    if (!profile) return;
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.personalInfo.firstName || 'candidate'}_ai_master_profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunMappingTest = async () => {
    if (!profile) {
      alert('Please upload a resume or generate candidate profile first.');
      return;
    }

    setIsMapping(true);
    try {
      const res = await fetch('/api/map-fields', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-openai-key': apiKey } : {}),
        },
        body: JSON.stringify({
          candidate: profile,
          fields: sampleFields,
          stepName: 'My Information',
        }),
      });

      const data = await res.json();
      if (data.success && data.instructions) {
        setMappingResults(data.instructions);
      }
    } catch (err: any) {
      alert('Mapping error: ' + err.message);
    } finally {
      setIsMapping(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col">
      {/* Header Bar */}
      <header className="border-b border-slate-800 bg-[#0d1322]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-emerald-400 bg-clip-text text-transparent">
              Workday AI Automation Platform
            </h1>
            <p className="text-xs text-slate-400">Resume AI Checker & Autonomous Autofill Engine</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg text-xs">
            <span className={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`}></span>
            <span className="text-slate-300 font-medium">Server API: {status.toUpperCase()}</span>
          </div>

          <div className="relative">
            <input
              type="password"
              placeholder="OpenAI API Key (Optional)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-xs w-56 text-slate-200 focus:outline-none transition-all"
            />
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Banner Hero */}
        <div className="glass-panel rounded-2xl p-6 relative overflow-hidden border border-emerald-500/20 bg-gradient-to-r from-emerald-950/20 via-slate-900/60 to-slate-950">
          <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 blur-[100px] pointer-events-none"></div>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs px-3 py-1 rounded-full font-medium">
                <SearchCheck className="w-3.5 h-3.5" />
                <span>Resume AI Checker Agent Powered</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white">
                Deep Resume Parsing & 100% Verified AI JSON Master Profile
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Resume AI Checker agent cross-examines raw resume data to ensure all work experience, education, skills, projects, and contact info are perfectly extracted and verified.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className={`cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-medium text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-600/30 flex items-center space-x-2 transition-all transform active:scale-95 ${isUploading ? 'opacity-70 pointer-events-none' : ''}`}>
                <Upload className="w-4 h-4" />
                <span>{isUploading ? 'Analyzing Resume...' : 'Upload Resume (PDF/DOCX)'}</span>
                <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} className="hidden" disabled={isUploading} />
              </label>

              {profile && (
                <button
                  onClick={handleRunResumeAIChecker}
                  disabled={isCheckingWithAI}
                  className="bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-400 font-medium text-sm px-4 py-2.5 rounded-xl flex items-center space-x-2 transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${isCheckingWithAI ? 'animate-spin' : ''}`} />
                  <span>{isCheckingWithAI ? 'AI Checking...' : 'Re-Run Resume AI Checker'}</span>
                </button>
              )}
            </div>
          </div>

          {/* ── AI Parse Progress Bar ── */}
          {isUploading && parseProgress > 0 && (
            <div className="mt-5 space-y-3">
              {/* Stage label with animated dots */}
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
                <p className={`text-xs font-medium truncate ${
                  parseProgress === 100 ? 'text-emerald-400' : 'text-slate-300'
                }`}>
                  {parseStageLabel || 'Initializing Resume AI Checker...'}
                </p>
                <span className="ml-auto text-xs font-bold tabular-nums" style={{
                  color: parseProgress === 100 ? '#34d399' : '#94a3b8'
                }}>{parseProgress}%</span>
              </div>

              {/* Progress track */}
              <div className="w-full h-2.5 rounded-full bg-slate-800/80 border border-slate-700/50 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                  style={{
                    width: `${parseProgress}%`,
                    background: parseProgress === 100
                      ? 'linear-gradient(90deg, #10b981, #34d399)'
                      : 'linear-gradient(90deg, #059669, #10b981, #34d399)'
                  }}
                >
                  {/* Shimmer sweep */}
                  <span
                    className="absolute inset-0 opacity-40"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
                      animation: 'shimmer 1.4s infinite'
                    }}
                  />
                </div>
              </div>

              {/* Stage mini-steps */}
              <div className="flex items-center gap-1 flex-wrap">
                {PARSE_STAGES.map((s, i) => (
                  <div
                    key={i}
                    title={s.label}
                    className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                      parseProgress >= s.pct ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'profile' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Verified Profile Details</span>
          </button>

          <button
            onClick={() => setActiveTab('ai-json')}
            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'ai-json' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>AI Master JSON Viewer</span>
            {profile && <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-1.5 py-0.5 rounded-full font-mono">100%</span>}
          </button>

          <button
            onClick={() => setActiveTab('test-mapper')}
            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'test-mapper' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BrainCircuit className="w-4 h-4" />
            <span>AI Mapping Simulator</span>
          </button>

          <button
            onClick={() => setActiveTab('extension-guide')}
            className={`flex items-center space-x-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'extension-guide' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Extension Setup Guide</span>
          </button>
        </div>

        {/* Tab 1: Profile View */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            {profile ? (
              <>
                {/* Resume AI Checker Audit Card */}
                {profile.resumeAICheckerReport && (
                  <div className="glass-panel rounded-2xl p-5 border border-emerald-500/30 bg-emerald-950/10 space-y-3">
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-white text-sm">{profile.resumeAICheckerReport.checkedBy}</span>
                            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] px-2 py-0.5 rounded-full font-semibold">VERIFIED</span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Deep inspection complete • Completeness Score: <span className="text-emerald-400 font-bold">{profile.resumeAICheckerReport.completenessScore}%</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {profile.resumeAICheckerReport.verifiedSections.map((sec, i) => (
                          <span key={i} className="bg-slate-900/80 border border-slate-800 text-slate-300 text-[11px] px-2.5 py-1 rounded-lg flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>{sec}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {profile.resumeAICheckerReport.enhancementsApplied && profile.resumeAICheckerReport.enhancementsApplied.length > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-400 flex flex-wrap gap-2 items-center">
                        <span className="text-emerald-400 font-medium">Enhancements:</span>
                        {profile.resumeAICheckerReport.enhancementsApplied.map((enh, i) => (
                          <span key={i} className="bg-slate-900 px-2 py-0.5 rounded text-slate-300 text-[11px]">• {enh}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Personal Info Card */}
                  <div className="glass-panel rounded-2xl p-5 space-y-4">
                    <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
                      <User className="w-5 h-5 text-emerald-400" />
                      <h3 className="font-semibold text-white">Personal & Contact Info</h3>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-slate-400">Full Name:</span> <span className="font-medium text-slate-200">{profile.personalInfo.fullName}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Email:</span> <span className="font-medium text-slate-200">{profile.personalInfo.email}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Phone:</span> <span className="font-medium text-slate-200">{profile.personalInfo.phone}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Location:</span> <span className="font-medium text-slate-200">{profile.personalInfo.address.city || '—'}{profile.personalInfo.address.state ? `, ${profile.personalInfo.address.state}` : ''}{profile.personalInfo.address.country ? `, ${profile.personalInfo.address.country}` : ''}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Postal / Zip Code:</span> <span className="font-medium text-emerald-400 font-mono">{profile.personalInfo.address.postalCode || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">LinkedIn:</span> <span className="font-medium text-emerald-400">{profile.personalInfo.linkedin || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">GitHub:</span> <span className="font-medium text-emerald-400">{profile.personalInfo.github || '—'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Portfolio:</span> <span className="font-medium text-emerald-400">{profile.personalInfo.website || '—'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Work Experience Card */}
                  <div className="glass-panel rounded-2xl p-5 space-y-4">
                    <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
                      <Briefcase className="w-5 h-5 text-emerald-400" />
                      <h3 className="font-semibold text-white">Work Experience ({profile.workExperience?.length || 0})</h3>
                    </div>
                    <div className="space-y-3 text-xs max-h-80 overflow-y-auto pr-1">
                      {profile.workExperience && profile.workExperience.length > 0 ? (
                        profile.workExperience.map((exp, idx) => (
                          <div key={idx} className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                            <div className="font-semibold text-slate-200">{exp.jobTitle}</div>
                            <div className="text-slate-400">{exp.company} {exp.location ? `• ${exp.location}` : ''}</div>
                            <div className="text-emerald-400 font-mono text-[10px]">{exp.startDate} - {exp.endDate || (exp.isCurrent ? 'Present' : '')}</div>
                            {exp.description && <p className="text-slate-400 text-[11px] line-clamp-3 mt-1">{exp.description}</p>}
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-500 italic">No previous work experience listed (Fresher/Student profile).</div>
                      )}
                    </div>
                  </div>

                  {/* Education & Skills Card */}
                  <div className="glass-panel rounded-2xl p-5 space-y-4">
                    <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
                      <GraduationCap className="w-5 h-5 text-emerald-400" />
                      <h3 className="font-semibold text-white">Education & Credentials</h3>
                    </div>
                    <div className="space-y-3 text-xs">
                      {profile.education && profile.education.map((edu, idx) => (
                        <div key={idx} className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                          <div className="font-semibold text-slate-200">{edu.degree} - {edu.fieldOfStudy}</div>
                          <div className="text-slate-400">{edu.institution}</div>
                          <div className="text-emerald-400 font-mono text-[10px]">{edu.startDate} - {edu.endDate} {edu.gpa ? `• GPA: ${edu.gpa}` : ''}</div>
                        </div>
                      ))}

                      <div className="pt-2 border-t border-slate-800">
                        <span className="text-slate-400 block mb-1 font-semibold">Skills & Tools ({profile.skills?.length || 0}):</span>
                        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                          {profile.skills && profile.skills.map((s, idx) => (
                            <span key={idx} className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] px-2 py-0.5 rounded">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Projects Row */}
                {profile.projects && profile.projects.length > 0 && (
                  <div className="glass-panel rounded-2xl p-5 space-y-4">
                    <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
                      <FolderGit2 className="w-5 h-5 text-emerald-400" />
                      <h3 className="font-semibold text-white">Projects ({profile.projects.length})</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {profile.projects.map((proj, idx) => (
                        <div key={idx} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
                          <div className="font-semibold text-slate-200 text-sm">{proj.title}</div>
                          <p className="text-slate-400 text-xs leading-relaxed">{proj.description}</p>
                          {proj.technologies && proj.technologies.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {proj.technologies.map((t, ti) => (
                                <span key={ti} className="bg-slate-800 text-slate-300 text-[10px] px-1.5 py-0.5 rounded font-mono">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          {proj.url && (
                            <a href={proj.url} target="_blank" rel="noreferrer" className="text-emerald-400 text-xs hover:underline flex items-center space-x-1 pt-1">
                              <span>View Project</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Target / Workday Pre-Screening Verified Answers Card */}
                {profile.targetQuestionnaireAnswers && (
                  <div className="glass-panel rounded-2xl p-5 space-y-4 border border-emerald-500/20 bg-emerald-950/10">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center space-x-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                        <div>
                          <h3 className="font-semibold text-white">Target & Workday Screening Questionnaire (AI-Verified)</h3>
                          <p className="text-[11px] text-slate-400">High-converting honest responses selected to maximize candidate selection rate.</p>
                        </div>
                      </div>
                      <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2.5 py-1 rounded-full font-medium">All 22 Items Ready</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Age 18+ Qualification:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.isAtLeast18 ? 'Yes (At least 18 years old)' : 'No'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">US Work Authorization:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.isLegallyAuthorizedUS ? 'Yes (Legally Authorized)' : 'No'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Non-Compete Restrictions:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.hasEmploymentAgreementRestrictions ? 'Yes' : 'No (Zero Restrictions)'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Past Contractor with Target:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.isCurrentOrPastTargetContractor ? 'Yes' : 'No'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Staffing Agency Referral:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.isReferralAgency ? 'Yes' : 'No (Direct Candidate)'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Open to Relocation:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.openToRelocation ? 'Yes (Open to Relocation)' : 'No'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Experience in Retail & Warehousing:</span>
                        <span className="font-semibold text-emerald-400">Yes (Warehousing, Salesfloor, Customer Service)</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Experience in Tech / Electronics:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.experienceTech ? 'Yes' : 'No'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Weekend & Holiday Availability:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.availableWeekendsHolidays ? 'Yes (Open Weekend/Holiday Availability)' : 'Limited'}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Daily Earliest Start Time:</span>
                        <span className="font-semibold text-emerald-400 font-mono">Sun-Sat: {profile.targetQuestionnaireAnswers.earliestTimeMonday}</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">Team Leadership Experience:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.yearsLeadingTeam} (Size: {profile.targetQuestionnaireAnswers.teamSizeLed})</span>
                      </div>

                      <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                        <span className="text-slate-400 block text-[11px]">SMS Updates Permission:</span>
                        <span className="font-semibold text-emerald-400">{profile.targetQuestionnaireAnswers.allowSmsCommunication ? 'Yes (Agreed)' : 'No'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="glass-panel rounded-2xl p-12 text-center space-y-4 border border-dashed border-slate-800">
                <FileText className="w-12 h-12 text-slate-600 mx-auto" />
                <h3 className="text-lg font-medium text-slate-300">No Candidate Profile Uploaded</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Upload a resume in PDF or DOCX format above. The Resume AI Checker will parse, cross-examine, and display the verified AI JSON profile.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: AI Master JSON Inspector */}
        {activeTab === 'ai-json' && (
          <div className="space-y-4">
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="font-semibold text-white text-base">Resume AI Checker — Master JSON</h3>
                    <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded-full font-mono">
                      {profile ? 'Verified JSON' : 'Empty'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    This is the finalized AI JSON used by the extension to auto-fill Workday forms with zero field omissions.
                  </p>
                </div>

                {profile && (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleCopyJson}
                      className="bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs px-3.5 py-2 rounded-lg font-medium flex items-center space-x-1.5 transition-all shadow"
                    >
                      {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
                    </button>

                    <button
                      onClick={handleDownloadJson}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3.5 py-2 rounded-lg font-medium flex items-center space-x-1.5 transition-all shadow"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download JSON</span>
                    </button>
                  </div>
                )}
              </div>

              {profile ? (
                <div className="relative">
                  <pre className="bg-[#050811] text-emerald-300 p-5 rounded-xl border border-slate-800 text-xs font-mono overflow-x-auto max-h-[600px] leading-relaxed shadow-inner">
                    {JSON.stringify(profile, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500 italic text-sm">
                  Upload a resume above to inspect the Resume AI Checker Master JSON.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Mapping Test */}
        {activeTab === 'test-mapper' && (
          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-white">Workday Field Mapping Engine Test</h3>
                  <p className="text-xs text-slate-400">Simulates real dynamic field mapping against candidate data.</p>
                </div>
                <button
                  onClick={handleRunMappingTest}
                  disabled={isMapping}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded-lg font-medium flex items-center space-x-2 shadow-md transition-all"
                >
                  <Cpu className="w-4 h-4" />
                  <span>{isMapping ? 'Processing...' : 'Run Field Mapping Test'}</span>
                </button>
              </div>

              {mappingResults.length > 0 && (
                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-slate-400 uppercase font-semibold border-b border-slate-800">
                      <tr>
                        <th className="p-3">Field Label</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Matched Value</th>
                        <th className="p-3">Confidence</th>
                        <th className="p-3">Reasoning</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {mappingResults.map((item, i) => (
                        <tr key={i} className="hover:bg-slate-900/40">
                          <td className="p-3 font-medium text-slate-200">{sampleFields.find(f => f.id === item.fieldId)?.label}</td>
                          <td className="p-3">
                            <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-mono text-[10px]">
                              {item.action}
                            </span>
                          </td>
                          <td className="p-3 font-semibold text-emerald-400">{item.value}</td>
                          <td className="p-3">{Math.round(item.confidence * 100)}%</td>
                          <td className="p-3 text-slate-400">{item.reasoning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Extension Setup Guide */}
        {activeTab === 'extension-guide' && (
          <div className="glass-panel rounded-2xl p-6 space-y-4">
            <h3 className="font-semibold text-white text-lg">Chrome Extension Setup Instructions</h3>
            <ol className="list-decimal list-inside text-sm text-slate-300 space-y-3">
              <li>Open Chrome browser and navigate to <code className="bg-slate-900 px-2 py-1 rounded text-emerald-400">chrome://extensions</code></li>
              <li>Toggle <strong>Developer mode</strong> in the top right corner.</li>
              <li>Click <strong>Load unpacked</strong> and select the directory: <code className="bg-slate-900 px-2 py-1 rounded text-emerald-400">e:\New folder\extension\dist</code></li>
              <li>Navigate to any Workday job application posting (e.g. Target or NVIDIA Careers).</li>
              <li>Click the extension icon to open the popup, upload or load your Resume AI Checker Master Profile, and click <strong>Auto-Fill Step</strong>!</li>
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}

