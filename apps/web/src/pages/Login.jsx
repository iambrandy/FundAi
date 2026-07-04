import React, { useState } from "react";
import { login, signup } from "../api.js";
import { Cpu, LineChart, Shield, Zap, Sparkles, Check, ChevronRight } from "lucide-react";

export default function LoginPage({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [form, setForm] = useState({ email: "", password: "", fullName: "", role: "ADVISOR" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const data = await login(form.email, form.password);
        onAuth(data.user);
      } else {
        const data = await signup(form.email, form.password, form.fullName, form.role);
        onAuth(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="gateway-container">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .gateway-container {
          min-height: 100vh;
          background: #060913;
          color: #EAEDF5;
          font-family: 'Plus Jakarta Sans', sans-serif;
          display: flex;
          position: relative;
          overflow: hidden;
        }

        /* Ambient Glowing Background Blobs */
        .ambient-glow-1 {
          position: absolute;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(227, 168, 87, 0.08) 0%, transparent 70%);
          top: -100px;
          left: -100px;
          filter: blur(80px);
          animation: floatGlow 12s ease-in-out infinite alternate;
        }

        .ambient-glow-2 {
          position: absolute;
          width: 600px;
          height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(62, 207, 142, 0.06) 0%, transparent 75%);
          bottom: -150px;
          right: -100px;
          filter: blur(100px);
          animation: floatGlow 15s ease-in-out infinite alternate-reverse;
        }

        @keyframes floatGlow {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(40px, 30px) scale(1.1); }
        }

        /* Split-screen layout */
        .showcase-side {
          flex: 1.2;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 60px 80px;
          position: relative;
          z-index: 2;
          border-right: 1px solid rgba(255, 255, 255, 0.03);
          background: linear-gradient(135deg, rgba(10, 15, 28, 0.4) 0%, rgba(6, 9, 19, 0.2) 100%);
        }

        .form-side {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 60px;
          position: relative;
          z-index: 2;
          background: #080c18;
        }

        @media (max-width: 1024px) {
          .gateway-container {
            flex-direction: column;
            overflow-y: auto;
          }
          .showcase-side {
            padding: 40px;
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.03);
          }
          .form-side {
            padding: 40px 20px;
          }
        }

        /* Branding */
        .logo-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-box {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #e3a857 0%, #ff8c00 100%);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(227, 168, 87, 0.3);
        }

        .logo-box svg {
          color: #060913;
        }

        .brand-text {
          font-family: 'Outfit', sans-serif;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.02em;
          background: linear-gradient(to right, #eaedf5, #a8b2d1);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        /* Headline & Copy */
        .showcase-content {
          margin: 60px 0;
        }

        .headline {
          font-family: 'Outfit', sans-serif;
          font-size: 46px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.03em;
          margin-bottom: 24px;
          color: #eaedf5;
        }

        .headline span {
          background: linear-gradient(to right, #e3a857, #ffc87a);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .subheading {
          font-size: 16px;
          color: #8a93ac;
          line-height: 1.6;
          max-width: 520px;
          margin-bottom: 40px;
        }

        /* Features List */
        .features-grid {
          display: grid;
          gap: 20px;
          max-width: 540px;
        }

        .feature-item {
          display: flex;
          gap: 16px;
          background: rgba(19, 27, 46, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.02);
          border-radius: 12px;
          padding: 16px 20px;
          backdrop-filter: blur(10px);
          transition: transform 0.2s, border-color 0.2s;
        }

        .feature-item:hover {
          transform: translateY(-2px);
          border-color: rgba(227, 168, 87, 0.15);
        }

        .icon-circle {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: rgba(227, 168, 87, 0.08);
          border: 1px solid rgba(227, 168, 87, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #e3a857;
          flex-shrink: 0;
        }

        .feature-text h4 {
          font-size: 14.5px;
          font-weight: 600;
          color: #eaedf5;
          margin-bottom: 4px;
        }

        .feature-text p {
          font-size: 12.5px;
          color: #8a93ac;
          line-height: 1.45;
        }

        .showcase-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          color: #5b657e;
          border-top: 1px solid rgba(255, 255, 255, 0.03);
          padding-top: 24px;
        }

        /* Form styling */
        .glass-card {
          width: 100%;
          max-width: 420px;
          background: rgba(19, 27, 46, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 20px;
          padding: 44px;
          backdrop-filter: blur(15px);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
          position: relative;
        }

        .form-title {
          font-family: 'Outfit', sans-serif;
          font-size: 24px;
          font-weight: 700;
          margin-bottom: 8px;
          color: #eaedf5;
          letter-spacing: -0.01em;
        }

        .form-desc {
          font-size: 13.5px;
          color: #8a93ac;
          margin-bottom: 32px;
        }

        /* Form Controls */
        .tabs-row {
          display: flex;
          background: rgba(13, 20, 36, 0.8);
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 28px;
          border: 1px solid rgba(255, 255, 255, 0.02);
        }

        .tab-btn {
          flex: 1;
          background: transparent;
          border: none;
          color: #8a93ac;
          font-size: 13px;
          font-weight: 600;
          padding: 8px 12px;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.2s;
        }

        .tab-btn.active {
          background: #e3a857;
          color: #060913;
          box-shadow: 0 4px 12px rgba(227, 168, 87, 0.25);
        }

        .field-group {
          margin-bottom: 20px;
        }

        .field-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #8a93ac;
          margin-bottom: 8px;
        }

        .text-input, .select-input {
          width: 100%;
          background: rgba(13, 20, 36, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          color: #eaedf5;
          font-size: 14px;
          padding: 12px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .text-input:focus, .select-input:focus {
          border-color: #e3a857;
          box-shadow: 0 0 0 3px rgba(227, 168, 87, 0.15);
        }

        /* Buttons & Actions */
        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #e3a857 0%, #ff9e22 100%);
          border: none;
          border-radius: 8px;
          color: #060913;
          font-size: 14.5px;
          font-weight: 700;
          padding: 14px;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 10px;
        }

        .submit-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 20px rgba(227, 168, 87, 0.35);
        }

        .submit-btn:active {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        .divider {
          display: flex;
          align-items: center;
          text-align: center;
          margin: 24px 0;
          font-size: 11px;
          color: #4b556e;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .divider::before, .divider::after {
          content: '';
          flex: 1;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .divider:not(:empty)::before { margin-right: .75em; }
        .divider:not(:empty)::after { margin-left: .75em; }

        .bypass-btn {
          width: 100%;
          background: rgba(227, 168, 87, 0.04);
          border: 1px dashed rgba(227, 168, 87, 0.35);
          border-radius: 8px;
          color: #e3a857;
          font-size: 13px;
          font-weight: 600;
          padding: 12px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .bypass-btn:hover {
          background: rgba(227, 168, 87, 0.08);
          border-color: #e3a857;
          color: #eaedf5;
        }

        .bottom-toggle-text {
          margin-top: 24px;
          font-size: 13px;
          color: #8a93ac;
          text-align: center;
        }

        .toggle-link {
          color: #e3a857;
          cursor: pointer;
          font-weight: 600;
          text-decoration: underline;
        }

        .error-banner {
          background: rgba(255, 107, 107, 0.08);
          border: 1px solid rgba(255, 107, 107, 0.3);
          border-radius: 8px;
          color: #ff6b6b;
          font-size: 13px;
          padding: 10px 14px;
          margin-bottom: 20px;
        }
      `}</style>

      {/* Decorative Blobs */}
      <div className="ambient-glow-1" />
      <div className="ambient-glow-2" />

      {/* Left side: Premium Showcase */}
      <div className="showcase-side">
        <div className="logo-wrap">
          <div className="logo-box">
            <LineChart size={18} />
          </div>
          <span className="brand-text">FundAI Platform</span>
        </div>

        <div className="showcase-content">
          <h1 className="headline">
            Institutional-grade <span>portfolio adaptive</span> intelligence.
          </h1>
          <p className="subheading">
            FundAI combines multi-factor modeling with automated market regime classification to dynamically adapt portfolio allocations.
          </p>

          <div className="features-grid">
            <div className="feature-item">
              <div className="icon-circle">
                <Cpu size={18} />
              </div>
              <div className="feature-text">
                <h4>Regime-Adaptive Weights</h4>
                <p>Dynamically adjusts factor allocations between Value, Momentum, Quality, Growth, and Low Volatility.</p>
              </div>
            </div>

            <div className="feature-item">
              <div className="icon-circle">
                <Shield size={18} />
              </div>
              <div className="feature-text">
                <h4>Human-in-the-Loop Compliance</h4>
                <p>AI proposes and generates actionable rebalancing orders, requiring explicit advisor validation.</p>
              </div>
            </div>

            <div className="feature-item">
              <div className="icon-circle">
                <Zap size={18} />
              </div>
              <div className="feature-text">
                <h4>Low Volatility Protection</h4>
                <p>Incorporates downside semi-variance, maximum drawdown, and beta metrics to protect capital in bear markets.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="showcase-footer">
          <span>Advisory Framework MVP v0.2.0</span>
          <span>NSE Equity Universe</span>
        </div>
      </div>

      {/* Right side: Login Glass Card */}
      <div className="form-side">
        <div className="glass-card">
          <h2 className="form-title">Welcome Back</h2>
          <p className="form-desc">Connect to the advisor console to access client analytics.</p>

          <div className="tabs-row">
            <button
              className={`tab-btn ${mode === "login" ? "active" : ""}`}
              onClick={() => { setMode("login"); setError(null); }}
            >
              Sign In
            </button>
            <button
              className={`tab-btn ${mode === "signup" ? "active" : ""}`}
              onClick={() => { setMode("signup"); setError(null); }}
            >
              Create Account
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <form onSubmit={submit}>
            {mode === "signup" && (
              <>
                <div className="field-group">
                  <label className="field-label">Full Name</label>
                  <input
                    className="text-input"
                    placeholder="Ravi Mehta"
                    value={form.fullName}
                    onChange={set("fullName")}
                    required
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Account Role</label>
                  <select 
                    className="select-input" 
                    value={form.role} 
                    onChange={set("role")}
                    style={{ cursor: "pointer" }}
                  >
                    <option value="ADVISOR">Advisor (Multiple Clients)</option>
                    <option value="RETAIL">Retail Investor (Self-Serve)</option>
                  </select>
                </div>
              </>
            )}

            <div className="field-group">
              <label className="field-label">Email Address</label>
              <input
                className="text-input"
                type="email"
                placeholder="you@fundai.com"
                value={form.email}
                onChange={set("email")}
                required
              />
            </div>

            <div className="field-group" style={{ marginBottom: 24 }}>
              <label className="field-label">Secure Password</label>
              <input
                className="text-input"
                type="password"
                placeholder={mode === "signup" ? "At least 10 characters" : "••••••••••"}
                value={form.password}
                onChange={set("password")}
                required
                minLength={mode === "signup" ? 10 : 1}
              />
            </div>

            <button className="submit-btn" type="submit" disabled={loading}>
              {loading ? "Authenticating..." : (mode === "login" ? "Access Terminal" : "Register Account")}
              <ChevronRight size={16} />
            </button>
          </form>

          <div className="divider">Or Testing Sandbox</div>

          <button 
            className="bypass-btn" 
            type="button" 
            onClick={() => {
              onAuth({ id: "mock-test-id", email: "tester@fundai.com", role: "ADVISOR" });
            }}
          >
            <Sparkles size={14} /> Enter Test Sandbox (Offline Mode)
          </button>

          <p className="bottom-toggle-text">
            {mode === "login" ? "New to the platform? " : "Already registered? "}
            <span className="toggle-link" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}>
              {mode === "login" ? "Sign up here" : "Sign in here"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
