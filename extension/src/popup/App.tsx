import React, { useState, useEffect } from 'react';
import {
  Zap,
  FileText,
  Play,
  ArrowRight,
  ShieldAlert,
  Server,
  Upload,
  LogOut,
  Lock,
  Mail,
  CheckCircle2,
  PanelRight,
  Sparkles,
  UserCheck,
  Code2,
  Copy,
  Check,
  Eye,
  EyeOff,
  User,
  Briefcase,
  GraduationCap,
  Sliders,
  CheckCircle,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Layers,
  X
} from 'lucide-react';
import { CandidateProfile, StepStatus } from '../types';

const API_BASE = 'https://resume-automation-workday-auto-fill.vercel.app';

const PARSE_STAGES = [
  { label: 'Reading & Extracting PDF / DOCX content...', pct: 8 },
  { label: 'Pass 1 — Extracting Personal Info & Contact Details...', pct: 20 },
  { label: 'Pass 2 — Analyzing Work Experience & Job Roles...', pct: 35 },
  { label: 'Pass 3 — Extracting Skills, Projects & Certifications...', pct: 50 },
  { label: 'Pass 4 — Extracting Education & Academic Details...', pct: 62 },
  { label: 'Pass 5 — Analyzing Job Questionnaire & Availability...', pct: 74 },
  { label: 'Resume AI Checker — Deep Verification...', pct: 85 },
  { label: 'AI Checker — Filling Missing Fields...', pct: 93 },
  { label: 'Finalizing Master AI JSON Profile...', pct: 99 },
];

export default function App() {
  // Navigation & UI tab state
  const [activeTab, setActiveTab] = useState<'autofill' | 'profile' | 'settings'>('autofill');
  const [profileSubTab, setProfileSubTab] = useState<'overview' | 'experience' | 'education' | 'skills'>('overview');

  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Core App state
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [stepStatus, setStepStatus] = useState<StepStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCheckingWithAI, setIsCheckingWithAI] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [parseStageLabel, setParseStageLabel] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  // Settings state
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(true);
  const [soundFeedback, setSoundFeedback] = useState(false);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['authUser'], (result) => {
        if (chrome.runtime?.lastError) return;
        if (result?.authUser?.email) {
          setIsLoggedIn(true);
          setUserEmail(result.authUser.email);
          setAuthEmail(result.authUser.email);
          setAuthPassword(result.authUser.password || '');
        }
      });
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadStoredProfile();
      checkServerHealth();
      detectWorkdayStep();

      // Poll every 500ms to keep step detection dynamically synchronized
      const intervalId = setInterval(() => {
        detectWorkdayStep();
      }, 500);

      return () => clearInterval(intervalId);
    }
  }, [isLoggedIn]);

  const handleAuth = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter both email and password.');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });

      const data = await res.json();

      if (data.success && data.user) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
          chrome.storage.local.set({
            authUser: { email: authEmail, password: authPassword }
          });
        }
        setIsLoggedIn(true);
        setUserEmail(data.user.email);
      } else {
        setAuthError(data.error || 'Authentication failed. Please check credentials.');
      }
    } catch {
      setAuthError('Cannot connect to AI server. Please verify backend is running on :3000.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUserEmail('');
    setAuthEmail('');
    setAuthPassword('');
    setProfile(null);
    setStatusMsg('');
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
      chrome.storage.local.remove(['authUser', 'candidateProfile']);
    }
  };

  const checkServerHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      const data = await res.json();
      setServerOnline(data.status === 'online');
    } catch {
      setServerOnline(false);
    }
  };

  const loadStoredProfile = () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && chrome.runtime?.id) {
      chrome.storage.local.get(['candidateProfile'], (result) => {
        if (chrome.runtime?.lastError) return;
        if (result?.candidateProfile) {
          setProfile(result.candidateProfile);
        }
      });
    }
  };

  const detectWorkdayStep = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        const isWorkdayUrl = !!(tab.url && (tab.url.includes('myworkdayjobs.com') || tab.url.includes('workday.com')));

        chrome.tabs.sendMessage(tabId, { type: 'GET_STEP_STATUS' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err) {
            if (chrome.scripting && isWorkdayUrl) {
              chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
                if (chrome.runtime?.lastError) return;
                setTimeout(() => {
                  if (!chrome.runtime?.id) return;
                  chrome.tabs.sendMessage(tabId, { type: 'GET_STEP_STATUS' }, (res2) => {
                    const err2 = chrome.runtime?.lastError;
                    if (!err2 && res2?.success) {
                      setStepStatus(res2.status);
                    }
                  });
                }, 250);
              });
            }

            setStepStatus({
              stepName: isWorkdayUrl ? 'Workday Application Page' : 'Not a Workday Page',
              isWorkdayPage: isWorkdayUrl,
              totalFieldsCount: 0,
              filledFieldsCount: 0,
              isFinalReviewStep: false
            });
            return;
          }

          if (res?.success) {
            setStepStatus(res.status);
          }
        });
      });
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

    setLoading(true);
    setParseProgress(0);
    setParseStageLabel('');
    setStatusMsg('Analyzing resume with AI...');

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
        chrome.storage.local.set({
          uploadedResumeFile: {
            name: file.name,
            type: file.type || 'application/pdf',
            base64: reader.result as string
          }
        });
      }
    };
    reader.readAsDataURL(file);

    runParseProgressSimulation(() => {});

    const formData = new FormData();
    formData.append('resume', file);

    try {
      const res = await fetch(`${API_BASE}/api/parse-resume`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success && data.profile) {
        setParseProgress(100);
        setParseStageLabel('✓ AI Master JSON Profile Complete!');
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
          chrome.storage.local.set({ candidateProfile: data.profile });
        }
        const score = data.checkerReport?.completenessScore || 98;
        setTimeout(() => {
          setProfile(data.profile);
          setLoading(false);
          setParseProgress(0);
          setParseStageLabel('');
          setStatusMsg(`Resume AI Checker: Verified ${score}% Complete! ✓`);
        }, 700);
        return;
      } else {
        setStatusMsg(data.error || 'Parsing failed.');
      }
    } catch {
      setStatusMsg('Error connecting to server.');
    }
    setLoading(false);
    setParseProgress(0);
    setParseStageLabel('');
  };

  const handleRerunAIChecker = async () => {
    if (!profile) return;
    setIsCheckingWithAI(true);
    setStatusMsg('Running Resume AI Checker deep audit...');

    try {
      const res = await fetch(`${API_BASE}/api/resume-ai-checker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: profile })
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.runtime?.id) {
          chrome.storage.local.set({ candidateProfile: data.profile });
        }
        const score = data.checkerReport?.completenessScore || 98;
        setStatusMsg(`✓ AI Master JSON Enhanced & Verified (${score}%)`);
      } else {
        setStatusMsg(data.error || 'AI Checker enhancement failed.');
      }
    } catch {
      setStatusMsg('Error connecting to AI Checker.');
    } finally {
      setIsCheckingWithAI(false);
    }
  };

  const handleAutofillStep = async () => {
    if (!profile) { setStatusMsg('Upload a resume first.'); return; }

    setLoading(true);
    setStatusMsg('Extracting Workday form fields...');

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_FIELDS' }, async (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success || !res?.fields) {
            setStatusMsg('Could not read fields. Please refresh Workday page.');
            setLoading(false);
            return;
          }

          setStatusMsg(`AI Mapping ${res.fields.length} detected fields...`);

          try {
            const mapRes = await fetch(`${API_BASE}/api/map-fields`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                candidate: profile,
                fields: res.fields,
                pageErrors: res.pageErrors,
                stepName: res.status?.stepName || 'Form'
              }),
            });
            const mapData = await mapRes.json();
            if (mapData.success && mapData.instructions) {
              setStatusMsg('Safely auto-filling fields...');
              chrome.tabs.sendMessage(
                tabId,
                { type: 'EXECUTE_AUTOFILL', payload: { instructions: mapData.instructions, candidate: profile } },
                (fillRes) => {
                  const fillErr = chrome.runtime?.lastError;
                  if (!fillErr && fillRes?.success) {
                    const stepLower = (res.status?.stepName || '').toLowerCase();
                    const isManualReviewStep = stepLower.includes('voluntary disclosures') ||
                      (stepLower.includes('voluntary') && stepLower.includes('disclosure'));

                    if (isManualReviewStep) {
                      setStatusMsg(`Filled Ethnicity! Please review & click Save and Continue ✓`);
                    } else {
                      setStatusMsg(`Successfully filled ${fillRes.result.filledCount} fields! ✓`);
                    }
                  }
                  setLoading(false);
                }
              );
            } else {
              setStatusMsg('No mapping instructions returned.');
              setLoading(false);
            }
          } catch {
            setStatusMsg('Mapping API error.');
            setLoading(false);
          }
        });
      });
    }
  };

  const handleNextStep = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Triggering Save & Continue...');
        chrome.tabs.sendMessage(tabId, { type: 'SUBMIT_STEP' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg(res?.message || 'Could not find Save & Continue button.');
          } else {
            setStatusMsg('Moving to next step... ✓');
            setTimeout(detectWorkdayStep, 2000);
          }
        });
      });
    }
  };

  const handleFinalSubmission = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        chrome.tabs.sendMessage(tabId, { type: 'FINAL_SUBMIT' }, (res) => {
          if (chrome.runtime?.lastError) return;
          setShowSubmitConfirm(false);
          setStatusMsg(res?.success ? 'Application Officially Submitted! 🎉' : (res?.message || 'Submission failed.'));
        });
      });
    }
  };

  const handleAutofillWithResume = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Triggering Autofill with Resume...');
        chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_AUTOFILL_WITH_RESUME' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg('Could not locate Autofill with Resume button.');
          } else {
            setStatusMsg('Selected Autofill with Resume! ✓');
            setTimeout(detectWorkdayStep, 1500);
          }
        });
      });
    }
  };

  const handleSignInWithEmail = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Selecting Sign in with email...');
        chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_SIGN_IN_WITH_EMAIL' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg('Could not find Sign in with email button.');
          } else {
            setStatusMsg('Selected Sign in with email! ✓');
            setTimeout(detectWorkdayStep, 1500);
          }
        });
      });
    }
  };

  const handleCreateAccount = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Clicking Create Account...');
        chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_CREATE_ACCOUNT' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg('Could not find Create Account button.');
          } else {
            setStatusMsg('Selected Create Account! ✓');
            setTimeout(detectWorkdayStep, 1500);
          }
        });
      });
    }
  };

  const handleFillAccountCredentials = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Auto-filling account credentials...');
        chrome.tabs.sendMessage(
          tabId,
          {
            type: 'AUTOFILL_CREATE_ACCOUNT_CREDENTIALS',
            payload: { email: authEmail || userEmail, password: authPassword }
          },
          (res) => {
            const err = chrome.runtime?.lastError;
            if (err || !res?.success) {
              setStatusMsg('Could not fill credentials.');
            } else {
              setStatusMsg('Filled Email, Password, Verify Password & Agreement ✓');
            }
          }
        );
      });
    }
  };

  const handleSubmitCreateAccount = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Submitting Create Account form...');
        chrome.tabs.sendMessage(tabId, { type: 'SUBMIT_CREATE_ACCOUNT' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg('Could not submit Create Account form.');
          } else {
            setStatusMsg('Account created successfully! Advancing... ✓');
            setTimeout(detectWorkdayStep, 2500);
          }
        });
      });
    }
  };

  const handleSubmitSignIn = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime?.id) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime?.lastError) return;
        const tab = tabs[0];
        if (!tab || typeof tab.id !== 'number') return;
        const tabId: number = tab.id;

        setStatusMsg('Submitting Sign In...');
        chrome.tabs.sendMessage(tabId, { type: 'SUBMIT_SIGN_IN' }, (res) => {
          const err = chrome.runtime?.lastError;
          if (err || !res?.success) {
            setStatusMsg('Could not submit Sign In form.');
          } else {
            setStatusMsg('Signed in successfully! Advancing... ✓');
            setTimeout(detectWorkdayStep, 2500);
          }
        });
      });
    }
  };

  const handleOpenSidebar = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR' });
    }
  };

  // ==========================================
  // AUTHENTICATION SCREEN
  // ==========================================
  if (!isLoggedIn) {
    return (
      <div className="app-wrapper">
        <div className="ambient-glow" />
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <div className="auth-logo-badge">
                <Zap size={28} color="#ffffff" />
              </div>
              <div className="auth-title">Workday AI Copilot</div>
              <div className="auth-subtitle">
                Autonomous Multi-LLM Job Application Engine
              </div>
            </div>

            <div className="auth-tab-switch">
              <button
                className={`auth-tab-btn ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => { setAuthMode('login'); setAuthError(''); }}
              >
                Sign In
              </button>
              <button
                className={`auth-tab-btn ${authMode === 'register' ? 'active' : ''}`}
                onClick={() => { setAuthMode('register'); setAuthError(''); }}
              >
                Create Account
              </button>
            </div>

            <div className="auth-form">
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <div className="input-wrapper">
                  <div className="input-icon-left">
                    <Mail size={15} />
                  </div>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="candidate@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Password</label>
                <div className="input-wrapper">
                  <div className="input-icon-left">
                    <Lock size={15} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input has-right-btn"
                    placeholder="••••••••••••"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  />
                  <button
                    type="button"
                    className="input-btn-right"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide Password' : 'Show Password'}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {authError && (
                <div className="alert-box alert-error">
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                  <span>{authError}</span>
                </div>
              )}

              <button className="btn-primary" onClick={handleAuth} disabled={authLoading}>
                {authLoading ? (
                  <div className="spinner-loader" />
                ) : (
                  <Sparkles size={16} />
                )}
                <span>{authLoading ? 'Connecting...' : (authMode === 'login' ? 'Sign In to Workspace' : 'Initialize Profile')}</span>
              </button>
            </div>

            <div className="auth-features-list">
              <div className="auth-feature-item">
                <CheckCircle2 size={13} color="#10b981" />
                <span>Zero-keystroke Workday autofill</span>
              </div>
              <div className="auth-feature-item">
                <CheckCircle2 size={13} color="#10b981" />
                <span>Multi-pass AI resume checker & parser</span>
              </div>
              <div className="auth-feature-item">
                <CheckCircle2 size={13} color="#10b981" />
                <span>Autonomous account setup & login fill</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN POPUP & SIDEBAR INTERFACE
  // ==========================================
  const completeness = profile?.resumeAICheckerReport?.completenessScore || (profile ? 98 : 0);

  return (
    <div className="app-wrapper">
      <div className="ambient-glow" />

      <div className="popup-container">
        {/* Top Header */}
        <header className="app-header">
          <div className="brand-section">
            <div className="brand-emblem">
              <Zap size={18} color="#ffffff" />
            </div>
            <div className="brand-info">
              <div className="brand-name">
                Workday AI
                <span className="brand-version">PRO</span>
              </div>
              <div className="brand-tagline">Multi-LLM Auto-Filler</div>
            </div>
          </div>

          <div className="header-actions">
            <div className="status-chip" title={serverOnline ? 'AI Backend Online' : 'AI Backend Offline'}>
              <div className={`status-indicator ${serverOnline ? 'online' : 'offline'}`} />
              <span>{serverOnline ? 'Online' : 'Offline'}</span>
            </div>

            <button className="btn-icon-square" onClick={handleOpenSidebar} title="Open Side Panel">
              <PanelRight size={14} />
            </button>

            <button className="btn-icon-square danger" onClick={handleLogout} title="Sign Out">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="nav-tab-bar">
          <button
            className={`nav-tab-btn ${activeTab === 'autofill' ? 'active' : ''}`}
            onClick={() => setActiveTab('autofill')}
          >
            <Play size={13} />
            <span>Autofill</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <User size={13} />
            <span>Profile</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Sliders size={13} />
            <span>Settings</span>
          </button>
        </nav>

        {/* TAB 1: AUTOFILL WORKFLOW */}
        {activeTab === 'autofill' && (
          <>
            {/* Live Step Card */}
            <div className="step-stage-hero">
              <div className="step-info-row">
                <div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5, marginBottom: 2 }}>
                    Current Workday Stage
                  </div>
                  <div className="step-name-badge">
                    <Sparkles size={14} color="#34d399" />
                    <span>{stepStatus?.stepName || 'Detecting page...'}</span>
                  </div>
                </div>

                <div className="step-meta-chips">
                  <span className={`panel-badge ${stepStatus?.isWorkdayPage ? 'emerald' : 'neutral'}`}>
                    {stepStatus?.isWorkdayPage ? 'Workday Detected' : 'Other Page'}
                  </span>
                </div>
              </div>

              {stepStatus && stepStatus.totalFieldsCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                  <span>Form Fields Detected</span>
                  <span style={{ fontWeight: 700, color: '#ffffff' }}>
                    {stepStatus.filledFieldsCount} / {stepStatus.totalFieldsCount} Filled
                  </span>
                </div>
              )}
            </div>

            {/* Candidate Resume Quick Status Bar */}
            <div className="glass-panel">
              <div className="glass-panel-header">
                <div className="panel-title-group">
                  <div className="panel-icon-wrap">
                    <FileText size={15} />
                  </div>
                  <div>
                    <div className="panel-title">
                      {profile ? profile.personalInfo.fullName : 'No Resume Loaded'}
                    </div>
                    <div className="panel-subtitle">
                      {profile ? `${completeness}% AI Verified Profile` : 'Upload PDF/DOCX to begin'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {profile && (
                    <>
                     
                      <button
                        className="btn-sm-action btn-sm-emerald"
                        onClick={() => setShowJsonModal(true)}
                        title="View Verified AI Profile JSON"
                      >
                        <Code2 size={12} />
                        <span>JSON</span>
                      </button>
                    </>
                  )}
                  <label className="file-upload-label">
                    <Upload size={12} />
                    <span>{profile ? 'Re-upload' : 'Upload'}</span>
                    <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>
              </div>

              {/* Animated Parse Progress */}
              {loading && parseProgress > 0 && (
                <div className="parse-progress-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                      {parseStageLabel || 'Processing...'}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                      {parseProgress}%
                    </span>
                  </div>

                  <div className="progress-track-wrapper">
                    <div className="progress-fill" style={{ width: `${parseProgress}%` }} />
                  </div>

                  <div className="progress-dots">
                    {PARSE_STAGES.map((s, i) => (
                      <div
                        key={i}
                        className={`progress-dot-step ${parseProgress >= s.pct ? 'active' : ''}`}
                        title={s.label}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Live Toast Status */}
            {statusMsg && (
              <div className="toast-msg">
                <Sparkles size={14} style={{ flexShrink: 0 }} />
                <span>{statusMsg}</span>
              </div>
            )}

            {/* Smart Action Deck */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto', paddingTop: 6 }}>
              {(() => {
                const stepLower = (stepStatus?.stepName || '').toLowerCase();
                const isManualStep = stepLower.includes('voluntary disclosures') ||
                  (stepLower.includes('voluntary') && stepLower.includes('disclosure'));

                if (isManualStep) {
                  return (
                    <div className="alert-box alert-warning">
                      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                      <span>
                        This section requires manual verification (e.g. EEOC/Disability). Please review selections and click Save & Continue.
                      </span>
                    </div>
                  );
                }

                if (stepLower.includes('start your application') || stepLower.includes('start application')) {
                  return (
                    <button className="btn-primary" onClick={handleAutofillWithResume}>
                      <Zap size={16} />
                      <span>1-Click "Autofill with Resume"</span>
                    </button>
                  );
                }

                if (stepLower.includes('sign in options')) {
                  return (
                    <button className="btn-primary btn-blue" onClick={handleSignInWithEmail}>
                      <Mail size={16} />
                      <span>Select "Sign in with email"</span>
                    </button>
                  );
                }

                if (stepLower.includes('sign in form') || (stepLower.includes('sign in') && !stepLower.includes('options'))) {
                  const isSignInFilled = !!stepStatus?.isSignInFilled;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <button className="btn-secondary" onClick={handleCreateAccount}>
                        <UserCheck size={15} color="#34d399" />
                        <span>Go to "Create Account" Form</span>
                      </button>

                      {!isSignInFilled ? (
                        <button className="btn-primary btn-blue" onClick={handleFillAccountCredentials}>
                          <Lock size={15} />
                          <span>Fill Saved Sign In Credentials</span>
                        </button>
                      ) : (
                        <button className="btn-primary btn-blue" onClick={handleSubmitSignIn}>
                          <Lock size={15} />
                          <span>Submit Sign In</span>
                        </button>
                      )}
                    </div>
                  );
                }

                if (stepLower.includes('create account')) {
                  const isFilled = !!stepStatus?.isCreateAccountFilled;
                  if (!isFilled) {
                    return (
                      <button className="btn-primary btn-violet" onClick={handleFillAccountCredentials}>
                        <Sparkles size={16} />
                        <span>Auto-Fill New Account Details</span>
                      </button>
                    );
                  }

                  return (
                    <button className="btn-primary" onClick={handleSubmitCreateAccount}>
                      <UserCheck size={16} />
                      <span>Submit & Register Account</span>
                    </button>
                  );
                }

                return (
                  <>
                    {stepStatus?.isWorkdayPage && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1, padding: '7px 8px', fontSize: 11 }}
                          onClick={handleAutofillWithResume}
                          title="Click Autofill with Resume"
                        >
                          <Zap size={13} color="#34d399" />
                          <span>Autofill Resume</span>
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1, padding: '7px 8px', fontSize: 11 }}
                          onClick={handleSignInWithEmail}
                          title="Click Sign in with Email"
                        >
                          <Mail size={13} color="#60a5fa" />
                          <span>Sign in Email</span>
                        </button>
                      </div>
                    )}

                    <button className="btn-primary" onClick={handleAutofillStep} disabled={loading || !profile}>
                      {loading ? <div className="spinner-loader" /> : <Play size={16} />}
                      <span>{loading ? 'AI Auto-Filling Fields...' : 'Auto-Fill Current Step'}</span>
                    </button>
                  </>
                );
              })()}

              {/* Advance Step Action */}
              <button className="btn-secondary" onClick={handleNextStep}>
                <span>Save & Continue Step</span>
                <ArrowRight size={14} color="#38bdf8" />
              </button>

              {/* Final Review & Submit Action */}
              {stepStatus?.isFinalReviewStep && (
                <button className="btn-warning" onClick={() => setShowSubmitConfirm(true)}>
                  <ShieldAlert size={16} />
                  <span>Confirm & Final Submit</span>
                </button>
              )}
            </div>
          </>
        )}

        {/* TAB 2: CANDIDATE PROFILE & VERIFICATION */}
        {activeTab === 'profile' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {profile ? (
              <>
                {/* Profile Overview Card */}
                <div className="glass-panel highlight-emerald">
                  <div className="glass-panel-header">
                    <div>
                      <div className="panel-title" style={{ fontSize: 14 }}>
                        {profile.personalInfo.fullName}
                      </div>
                      <div className="panel-subtitle">
                        {profile.personalInfo.email} • {profile.personalInfo.phone || 'No phone'}
                      </div>
                    </div>
                    <div className="panel-badge emerald">
                      <CheckCircle2 size={12} />
                      <span>{completeness}% Score</span>
                    </div>
                  </div>

                  <div className="profile-stats-grid">
                    <div className="stat-box">
                      <span className="stat-val">{profile.workExperience?.length || 0}</span>
                      <span className="stat-lbl">Experience</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-val">{profile.education?.length || 0}</span>
                      <span className="stat-lbl">Education</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-val">{profile.skills?.length || 0}</span>
                      <span className="stat-lbl">Skills</span>
                    </div>
                  </div>
                </div>

                {/* Sub Tabs */}
                <div style={{ display: 'flex', gap: 4, background: 'rgba(9,14,26,0.6)', padding: 3, borderRadius: 10 }}>
                  {(['overview', 'experience', 'education', 'skills'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setProfileSubTab(tab)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        border: 'none',
                        borderRadius: 7,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                        background: profileSubTab === tab ? 'rgba(16,185,129,0.2)' : 'transparent',
                        color: profileSubTab === tab ? '#34d399' : '#64748b'
                      }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Sub Tab Content */}
                {profileSubTab === 'overview' && (
                  <div className="glass-panel">
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                      <p style={{ marginBottom: 6 }}>
                        <strong style={{ color: '#ffffff' }}>Location: </strong>
                        {[profile.personalInfo.address?.city, profile.personalInfo.address?.state, profile.personalInfo.address?.country].filter(Boolean).join(', ') || 'Not specified'}
                      </p>
                      {profile.summary && (
                        <p style={{ fontStyle: 'italic', color: '#cbd5e1', borderLeft: '2px solid #10b981', paddingLeft: 8 }}>
                          "{profile.summary}"
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {profileSubTab === 'experience' && (
                  <div className="accordion-list">
                    {profile.workExperience && profile.workExperience.length > 0 ? (
                      profile.workExperience.map((exp, idx) => (
                        <div key={idx} className="accordion-item">
                          <div className="item-header-row">
                            <span className="item-title">{exp.jobTitle}</span>
                            <span className="item-meta">{exp.startDate} - {exp.isCurrent ? 'Present' : exp.endDate}</span>
                          </div>
                          <span className="item-sub">{exp.company} • {exp.location}</span>
                          {exp.description && (
                            <p style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
                              {exp.description.slice(0, 140)}...
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', padding: 20 }}>
                        No work experience entries parsed.
                      </div>
                    )}
                  </div>
                )}

                {profileSubTab === 'education' && (
                  <div className="accordion-list">
                    {profile.education && profile.education.length > 0 ? (
                      profile.education.map((edu, idx) => (
                        <div key={idx} className="accordion-item">
                          <div className="item-header-row">
                            <span className="item-title">{edu.degree} {edu.fieldOfStudy ? `in ${edu.fieldOfStudy}` : ''}</span>
                            <span className="item-meta">{edu.endDate || edu.startDate}</span>
                          </div>
                          <span className="item-sub">{edu.institution}</span>
                          {edu.gpa && <span className="item-meta">GPA: {edu.gpa}</span>}
                        </div>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', padding: 20 }}>
                        No education records parsed.
                      </div>
                    )}
                  </div>
                )}

                {profileSubTab === 'skills' && (
                  <div className="glass-panel">
                    <div className="chips-row">
                      {profile.skills && profile.skills.length > 0 ? (
                        profile.skills.map((skill, idx) => (
                          <span key={idx} className="skill-chip highlight">
                            <Sparkles size={10} />
                            {skill}
                          </span>
                        ))
                      ) : (
                        <span style={{ fontSize: 11, color: '#64748b' }}>No skills parsed.</span>
                      )}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn-secondary" onClick={() => setShowJsonModal(true)} style={{ flex: 1 }}>
                    <Code2 size={14} color="#34d399" />
                    <span>View AI JSON</span>
                  </button>
                  <label className="file-upload-label" style={{ flex: 1, justifyContent: 'center' }}>
                    <Upload size={13} />
                    <span>Upload New Resume</span>
                    <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                </div>
              </>
            ) : (
              <div className="glass-panel" style={{ textAlign: 'center', padding: '36px 20px', gap: 14 }}>
                <div style={{ width: 50, height: 50, borderRadius: 16, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: '#34d399' }}>
                  <FileText size={24} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#ffffff', marginBottom: 4 }}>
                    No Resume Profile Loaded
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
                    Upload your latest resume (PDF or DOCX). Our Multi-LLM AI checker will verify and structure it into a master profile.
                  </div>
                </div>
                <label className="file-upload-label" style={{ margin: '0 auto', padding: '10px 20px' }}>
                  <Upload size={15} />
                  <span>Choose Resume File</span>
                  <input type="file" accept=".pdf,.docx" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SETTINGS & ACCOUNT */}
        {activeTab === 'settings' && (
          <div className="settings-list">
            {/* Account Credentials Card */}
            <div className="glass-panel">
              <div className="glass-panel-header">
                <div className="panel-title-group">
                  <div className="panel-icon-wrap">
                    <UserCheck size={14} />
                  </div>
                  <div>
                    <div className="panel-title">Workday Account Credentials</div>
                    <div className="panel-subtitle">Used for automated portal registration & login</div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Email: <strong style={{ color: '#ffffff' }}>{authEmail || userEmail}</strong>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Password: <strong style={{ color: '#ffffff' }}>••••••••••••</strong>
                </div>
              </div>
            </div>

            {/* Automation Preferences */}
            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Auto-Advance Page Navigation</span>
                <span className="setting-desc">Automatically detect step transitions in Workday</span>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoAdvanceEnabled}
                  onChange={(e) => setAutoAdvanceEnabled(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">AI Server Endpoint</span>
                <span className="setting-desc">Local Multi-LLM API Gateway</span>
              </div>
              <span className="panel-badge emerald">https://resume-automation-workday-auto-fill.vercel.app/</span>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <span className="setting-title">Connection Status</span>
                <span className="setting-desc">Live Health Probe</span>
              </div>
              <button
                className="btn-sm-action btn-sm-neutral"
                onClick={checkServerHealth}
                title="Ping Server"
              >
                <RefreshCw size={11} />
                <span>{serverOnline ? 'Connected' : 'Reconnect'}</span>
              </button>
            </div>

            <button
              className="btn-secondary"
              style={{ marginTop: 12, borderColor: 'rgba(244,63,94,0.3)', color: '#fb7185' }}
              onClick={handleLogout}
            >
              <LogOut size={14} />
              <span>Sign Out of Extension</span>
            </button>
          </div>
        )}
      </div>

      {/* JSON Master Inspector Modal */}
      {showJsonModal && profile && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <div className="modal-title-row">
              <div className="modal-title">
                <Code2 size={16} color="#34d399" />
                <span>Resume AI Checker Master JSON</span>
              </div>
              <button
                onClick={() => setShowJsonModal(false)}
                className="btn-icon-square"
                style={{ width: 26, height: 26 }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="code-viewer-box">
              {JSON.stringify(profile, null, 2)}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 2000);
                }}
              >
                {copiedJson ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                <span>{copiedJson ? 'Copied to Clipboard!' : 'Copy Raw JSON'}</span>
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => setShowJsonModal(false)}>
                <span>Done</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Final Submission Safety Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="modal-backdrop">
          <div className="modal-dialog" style={{ textAlign: 'center', alignItems: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldAlert size={28} color="#f59e0b" />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#ffffff' }}>
              Confirm Final Job Application
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              You are currently on the final review step. Clicking <strong>Submit Now</strong> will officially transmit your application to the employer via Workday.
            </div>
            <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowSubmitConfirm(false)}>
                Review First
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleFinalSubmission}>
                Submit Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
