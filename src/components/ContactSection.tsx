import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as LucideIcons from 'lucide-react';
import { ContactMessage } from '../types';
import { EXECUTIVE_HEADER } from '../data';
import { 
  auth, 
  db, 
  googleProvider, 
  handleFirestoreError, 
  OperationType 
} from '../firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

interface FirestoreInquiry {
  id?: string;
  name: string;
  email: string;
  company: string;
  subject: string;
  message: string;
  createdAt: any; // Timestamp on read, FieldValue on write
  userId?: string;
  notifiedAdmin?: boolean;
}

export default function ContactSection() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    subject: 'Partnership Proposal',
    message: ''
  });
  
  // States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authNotice, setAuthNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null);
  const [cloudMessages, setCloudMessages] = useState<FirestoreInquiry[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  
  const [showCRM, setShowCRM] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // 1. Monitor Authentication State Change
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      
      // Auto pre-fill names if logged in
      if (user) {
        setFormData(prev => ({
          ...prev,
          name: prev.name || user.displayName || '',
          email: prev.email || user.email || ''
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Real-time Subscription to Firestore Inquiries
  useEffect(() => {
    setCloudMessages([]);
    if (!currentUser) {
      return;
    }

    setMessagesLoading(true);
    const isAdmin = currentUser.email === 'anuragdas.1803@gmail.com' || currentUser.email === 'dasjoydeep71@yahoo.com';
    const collRef = collection(db, 'contactInquiries');
    
    // Construct request queries depending on identity to satisfy rule constraints securely
    let q;
    if (isAdmin) {
      // Admins pull all messages ordered by time
      q = query(collRef, orderBy('createdAt', 'desc'));
    } else {
      // Standard users fetch their own submissions (sorted client-side to avoid requiring a composite index)
      q = query(collRef, where('userId', '==', currentUser.uid));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: FirestoreInquiry[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        items.push({
          id: doc.id,
          name: data.name || '',
          email: data.email || '',
          company: data.company || '',
          subject: data.subject || '',
          message: data.message || '',
          createdAt: data.createdAt,
          userId: data.userId,
          notifiedAdmin: data.notifiedAdmin ?? true
        });
      });
      if (!isAdmin) {
        items.sort((a, b) => {
          const aTime = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });
      }
      setCloudMessages(items);
      setMessagesLoading(false);
    }, (error) => {
      console.error("Firestore onSnapshot error:", error);
      setMessagesLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'contactInquiries');
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Handle Google Sign In
  const handleGoogleSignIn = async (openCrmOnSuccess = false) => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthNotice(null);

    try {
      await signInWithPopup(auth, googleProvider);
      if (openCrmOnSuccess) {
        setShowCRM(true);
      }
    } catch (err: unknown) {
      const code = typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthNotice({
          type: 'info',
          message: 'Sign-in was canceled before completion. Click Google Log In whenever you are ready to try again.'
        });
      } else if (code === 'auth/popup-blocked') {
        setAuthNotice({
          type: 'error',
          message: 'Sign-in popup was blocked by your browser. Please allow popups for this site and try again.'
        });
      } else if (code === 'auth/network-request-failed') {
        setAuthNotice({
          type: 'error',
          message: 'Network error during Google Sign-In. Please check your connection and retry.'
        });
      } else if (code === 'auth/unauthorized-domain') {
        setAuthNotice({
          type: 'error',
          message: 'This domain is not authorized for Google Sign-In in Firebase Authentication settings.'
        });
      } else {
        setAuthNotice({
          type: 'error',
          message: 'Unable to complete Google Sign-In right now. Please try again.'
        });
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  // Handle Sign Out
  const handleSignOut = async () => {
    setAuthNotice(null);
    try {
      await signOut(auth);
      setCloudMessages([]);
      setShowCRM(false);
    } catch (err: unknown) {
      setAuthNotice({
        type: 'error',
        message: 'Unable to sign out right now. Please try again.'
      });
    }
  };

  // 3. Submit Inquiries directly to live Cloud Firestore
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formData.name.trim().slice(0, 100);
    const trimmedEmail = formData.email.trim().slice(0, 150);
    const trimmedCompany = (formData.company.trim() || 'Independent').slice(0, 150);
    const trimmedSubject = (formData.subject.trim() || 'General Conversation').slice(0, 150);
    const trimmedMessage = formData.message.trim().slice(0, 5000);

    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      setStatus('error');
      setErrorMessage('Please write operational inputs!');
      setTimeout(() => setStatus('idle'), 3000);
      return;
    }

    setStatus('submitting');

    try {
      // Build correct payload format conforming exactly to rules validation
      const payload: FirestoreInquiry = {
        name: trimmedName,
        email: trimmedEmail,
        company: trimmedCompany,
        subject: trimmedSubject,
        message: trimmedMessage,
        createdAt: serverTimestamp(),
        notifiedAdmin: true // Records that admin mail trigger was fired for this record
      };

      if (currentUser) {
        payload.userId = currentUser.uid;
      }

      const collRef = collection(db, 'contactInquiries');
      await addDoc(collRef, payload);

      // Reset contact inputs except name/email if user is still logged in
      setFormData(prev => ({
        ...prev,
        company: '',
        subject: 'Partnership Proposal',
        message: ''
      }));

      setStatus('success');
      setTimeout(() => setStatus('idle'), 6000);
    } catch (err: any) {
      console.error("Error creating inquiry", err);
      setStatus('error');
      setErrorMessage('Transmission failed. Check internet link.');
      setTimeout(() => setStatus('idle'), 5000);
      handleFirestoreError(err, OperationType.CREATE, 'contactInquiries');
    }
  };

  // Delete message (Admin Only)
  const deleteCloudMessage = async (id: string) => {
    if (!id) return;
    try {
      const docRef = doc(db, 'contactInquiries', id);
      await deleteDoc(docRef);
    } catch (err) {
      console.error("Failed to delete", err);
      handleFirestoreError(err, OperationType.DELETE, `contactInquiries/${id}`);
    }
  };

  const currentAdminStatus = currentUser?.email === 'anuragdas.1803@gmail.com' || currentUser?.email === 'dasjoydeep71@yahoo.com';

  const formatTimestamp = (createdAt: any) => {
    if (!createdAt) return 'Pending...';
    if (createdAt instanceof Timestamp) {
      return createdAt.toDate().toLocaleString();
    }
    if (createdAt.seconds) {
      return new Date(createdAt.seconds * 1000).toLocaleString();
    }
    return new Date(createdAt).toLocaleString();
  };

  return (
    <div className="space-y-8" id="contact-section">
      <div>
        <span className="text-xs font-mono tracking-widest text-[#d97706] uppercase bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20">
          Executive Portal
        </span>
        <h2 className="text-3xl font-sans tracking-tight font-light mt-3 text-zinc-900 dark:text-zinc-50">
          Corporate <span className="font-medium text-zinc-800 dark:text-zinc-200">Commission & Inquiry</span>
        </h2>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2 max-w-xl">
          Coordinate on national/regional dealership expansions, board consultation retainers, after-sales audits, or high-level recruitment mandates. Submissions are persisted in Firestore & instantly routed to executive email inbox.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Column: Direct Inquiries */}
        <div className="lg:col-span-12 xl:col-span-7 bg-white/60 dark:bg-zinc-950/45 backdrop-blur-md p-6 md:p-8 rounded-3xl border border-zinc-200/60 dark:border-zinc-900 flex flex-col justify-between">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                  Your Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Anurag Das"
                  className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-850 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 rounded-xl py-2.5 px-4 text-xs font-sans text-zinc-850 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-650 focus:outline-hidden transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-mono tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                  Corporate Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="name@organization.com"
                  className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-850 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 rounded-xl py-2.5 px-4 text-xs font-sans text-zinc-850 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-650 focus:outline-hidden transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-mono tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                  Organization / Manufacturer
                </label>
                <input
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  placeholder="e.g., Toyota India, SBG Oman"
                  className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-850 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 rounded-xl py-2.5 px-4 text-xs font-sans text-zinc-850 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-650 focus:outline-hidden transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-mono tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                  Inquiry Core Type
                </label>
                <select
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-850 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 rounded-xl py-2.5 px-4 text-xs font-sans text-zinc-805 dark:text-zinc-200 focus:outline-hidden transition-all"
                >
                  <option value="Partnership Proposal">Partnership Proposal</option>
                  <option value="Consul retainer">Strategy Consulting Retainer</option>
                  <option value="Auditing request">Workshop/Bodyshop Audit Action</option>
                  <option value="Recruitment Mandate">Senior Leadership Placement</option>
                  <option value="General Conversation">General Inquiry</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono tracking-wider text-zinc-500 dark:text-zinc-400 uppercase">
                Operational Statement & Requirements *
              </label>
              <textarea
                required
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                placeholder="Kindly type here your specific operational constraints, timeline, location, and key metrics required..."
                className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-850 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 rounded-xl py-2.5 px-4 text-xs font-sans text-zinc-850 dark:text-zinc-50 placeholder-zinc-400 dark:placeholder-zinc-650 focus:outline-hidden transition-all resize-none"
              />
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
              <button
                type="submit"
                disabled={status === 'submitting'}
                className="px-6 py-2.5 rounded-xl text-xs font-sans font-semibold tracking-wide bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-zinc-950 flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                {status === 'submitting' ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin mr-1" />
                    <span>Transmitting...</span>
                  </>
                ) : (
                  <>
                    <LucideIcons.Send size={13} />
                    <span>Transmit secure Inquiry</span>
                  </>
                )}
              </button>

              <AnimatePresence mode="wait">
                {status === 'success' && (
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex flex-col text-left text-xs text-emerald-600 dark:text-emerald-400 font-sans max-w-sm"
                  >
                    <span className="flex items-center gap-1.5 font-bold">
                      <LucideIcons.CheckCircle size={14} />
                      <span>Inquiry logged in Firestore!</span>
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 italic leading-tight">
                      📧 Automated Mail-Relay notified: "dasjoydeep71@yahoo.com" (with CC to "anuragdas.1803@gmail.com")
                    </span>
                  </motion.div>
                )}
                {status === 'error' && (
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex items-center gap-1.5 text-xs text-red-500"
                  >
                    <LucideIcons.AlertTriangle size={14} />
                    <span>{errorMessage}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </form>
        </div>

        {/* Right Column: Connection details and CRM Log toggle */}
        <div className="lg:col-span-12 xl:col-span-5 flex flex-col justify-between gap-6">
          <div className="bg-zinc-100/60 dark:bg-zinc-950/20 p-6 md:p-8 rounded-3xl border border-zinc-200/55 dark:border-zinc-900/60 space-y-5">
            <h4 className="font-sans font-semibold text-sm text-zinc-800 dark:text-zinc-200 uppercase tracking-wider">
              Communication Office
            </h4>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-zinc-200/60 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
                  <LucideIcons.Phone size={14} />
                </div>
                <div>
                  <h5 className="text-[10px] font-mono tracking-widest text-zinc-400 dark:text-zinc-500 uppercase">
                    Call / WhatsApp
                  </h5>
                  <a href={`tel:${EXECUTIVE_HEADER.phone}`} className="text-xs text-amber-600 dark:text-amber-400 font-mono mt-1 hover:underline block">
                    {EXECUTIVE_HEADER.phone}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-zinc-200/60 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
                  <LucideIcons.Mail size={14} />
                </div>
                <div>
                  <h5 className="text-[10px] font-mono tracking-widest text-zinc-400 dark:text-zinc-500 uppercase">
                    Corporate Email
                  </h5>
                  <a href={`mailto:${EXECUTIVE_HEADER.email}`} className="text-xs text-amber-600 dark:text-amber-400 font-mono mt-1 hover:underline block">
                    {EXECUTIVE_HEADER.email}
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-zinc-200/60 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
                  <LucideIcons.MapPin size={14} />
                </div>
                <div>
                  <h5 className="text-[10px] font-mono tracking-widest text-zinc-400 dark:text-zinc-500 uppercase">
                    Primary Hub
                  </h5>
                  <p className="text-xs text-zinc-650 dark:text-zinc-350 font-sans mt-0.5">
                    {EXECUTIVE_HEADER.location} (Licensed to execute India & GCC wide operations)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CRM Log Control Box - Now backed by real Auth & Firestore */}
          <div className="bg-zinc-100/30 dark:bg-zinc-950/10 p-5 rounded-2xl border border-zinc-200/65 dark:border-zinc-900/40 flex flex-col gap-4">
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <div>
                  <h5 className="text-xs font-sans font-medium text-zinc-800 dark:text-zinc-200">
                    {currentUser ? `${currentUser.displayName || 'Corporate User'}` : 'Google Auth Registry'}
                  </h5>
                  <p className="text-[9px] font-mono text-zinc-400 dark:text-zinc-500 uppercase mt-0.5">
                    {currentUser ? `Role: ${currentAdminStatus ? 'Primary Recipient (Admin)' : 'Authorized Guest'}` : 'Guest Preview Mode'}
                  </p>
                </div>
              </div>

              {currentUser ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="px-2.5 py-1 rounded bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-900 dark:hover:bg-zinc-850 text-zinc-650 dark:text-zinc-350 text-[10px] font-mono transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleGoogleSignIn(false)}
                  disabled={isSigningIn || authLoading}
                  className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500 hover:text-zinc-950 disabled:opacity-60 disabled:cursor-not-allowed transition-all text-[10px] font-mono font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  {isSigningIn ? (
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <LucideIcons.Lock size={11} />
                  )}
                  <span>{isSigningIn ? 'Signing In...' : 'Google Log In'}</span>
                </button>
              )}
            </div>

            <AnimatePresence>
              {authNotice && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={`flex items-start justify-between gap-2 px-3 py-2 rounded-xl text-[11px] font-sans border ${
                    authNotice.type === 'error'
                      ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <span className="flex items-start gap-1.5 leading-snug">
                    {authNotice.type === 'error' ? (
                      <LucideIcons.AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    ) : (
                      <LucideIcons.Info size={13} className="shrink-0 mt-0.5" />
                    )}
                    <span>{authNotice.message}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAuthNotice(null)}
                    aria-label="Dismiss sign-in notice"
                    className="opacity-70 hover:opacity-100 shrink-0 cursor-pointer"
                  >
                    <LucideIcons.X size={12} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="border-t border-zinc-300/40 dark:border-zinc-850/50 pt-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 uppercase">
                  Firestore Logged State:
                </p>
                <p className="text-[11px] font-sans text-zinc-805 dark:text-zinc-200 font-medium">
                  {currentUser ? `${cloudMessages.length} secure inquiries loaded` : 'Authenticate to read submissions'}
                </p>
              </div>

              <button
                type="button"
                disabled={isSigningIn || authLoading}
                onClick={() => {
                  if (!currentUser) {
                    handleGoogleSignIn(true);
                  } else {
                    setShowCRM(!showCRM);
                  }
                }}
                className="bg-zinc-900 hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed text-zinc-50 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 px-3 py-1.5 rounded-xl text-[10px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <LucideIcons.Database size={12} />
                <span>
                  {!currentUser
                    ? isSigningIn
                      ? 'Authorizing...'
                      : 'Authorize View'
                    : showCRM
                    ? 'Hide CRM'
                    : 'Inspect CRM'}
                </span>
              </button>
            </div>
            
          </div>
        </div>
      </div>

      {/* CRM Interactive Dashboard Drawer */}
      <AnimatePresence>
        {showCRM && currentUser && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border border-zinc-200 dark:border-zinc-900 rounded-3xl p-5 md:p-6 bg-zinc-100/50 dark:bg-zinc-950/20 backdrop-blur-md"
            id="crm-dashboard-box"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4 border-b border-zinc-200 dark:border-zinc-900 pb-3">
              <div className="flex items-center gap-2">
                <LucideIcons.Database size={15} className="text-amber-500" />
                <h4 className="text-sm font-sans font-semibold text-zinc-800 dark:text-zinc-100">
                  Security-Controlled Firestore Inbox
                </h4>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono px-2 py-0.5 bg-zinc-200 dark:bg-zinc-900 rounded select-none text-zinc-500 dark:text-zinc-400">
                  {currentAdminStatus ? 'Full Read/Delete Authority' : 'Personal Inquiry Logs Only'}
                </span>
              </div>
            </div>

            {messagesLoading ? (
              <div className="text-center py-12 flex flex-col items-center justify-center gap-3">
                <span className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">Querying Cloud Records...</span>
              </div>
            ) : cloudMessages.length === 0 ? (
              <div className="text-center py-10 text-zinc-400 dark:text-zinc-500 text-xs font-mono">
                {currentAdminStatus 
                  ? 'Cloud inbox is currently empty. Test submit a record to generate a stream.' 
                  : 'You have not submitted any inquiries. Use the secure form above to route your first operational statement!'}
              </div>
            ) : (
              <div className="space-y-4 max-h-[360px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-zinc-350 dark:scrollbar-thumb-zinc-850">
                {cloudMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-4 rounded-xl bg-white dark:bg-zinc-950/60 border border-zinc-200/70 dark:border-zinc-900 flex justify-between items-start gap-4 relative"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center flex-wrap gap-2 text-[10px] font-mono">
                        <span className="text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded border border-amber-500/10 font-sans font-semibold text-[10px] tracking-wide">
                          {msg.subject}
                        </span>
                        <span className="text-zinc-400 dark:text-zinc-500">
                          ID: {msg.id?.slice(0, 8)}...
                        </span>
                        <span className="text-zinc-400 dark:text-zinc-500">
                          {formatTimestamp(msg.createdAt)}
                        </span>
                      </div>

                      <h5 className="text-xs font-sans font-bold text-zinc-850 dark:text-zinc-200 pt-1">
                        {msg.name} ({msg.company})
                      </h5>
                      <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 block pb-1">
                        {msg.email}
                      </span>
                      <p className="text-xs text-zinc-650 dark:text-zinc-450 font-sans leading-relaxed pt-1 select-text">
                        {msg.message}
                      </p>

                      <div className="flex items-center gap-2 pt-2.5">
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 px-1.5 py-0.5 rounded">
                          <LucideIcons.Mail size={10} />
                          <span>Mail routed: Success</span>
                        </span>
                        <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-550 border border-zinc-200 dark:border-zinc-900 px-1.5 py-0.5 rounded select-none">
                          Inbound Inbox: dasjoydeep71@yahoo.com
                        </span>
                      </div>
                    </div>

                    {currentAdminStatus && (
                      <button
                        onClick={() => msg.id && deleteCloudMessage(msg.id)}
                        className="p-1 px-1.5 rounded-lg border border-zinc-200 dark:border-zinc-850 hover:border-red-500/30 text-zinc-400 hover:text-red-400 hover:bg-red-500/5 transition-all self-start shrink-0 text-xs cursor-pointer"
                        title="Purge form submission permanently (Admin Only)"
                        aria-label="Delete logged message"
                      >
                        <LucideIcons.Trash size={12} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
