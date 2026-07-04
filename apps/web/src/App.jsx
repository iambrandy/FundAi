import React, { useState, useEffect } from "react";
import LoginPage from "./pages/Login.jsx";
import FundAITerminal from "./pages/PortfolioTerminal.jsx";
import { getStoredUser, clearToken } from "./api.js";

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
    }
  }, []);

  const handleAuth = (loggedInUser) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  if (!user) {
    return <LoginPage onAuth={handleAuth} />;
  }

  return <FundAITerminal user={user} onLogout={handleLogout} />;
}
