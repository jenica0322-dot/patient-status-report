// app/context/AuthContext.tsx

"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useMemo,
  useEffect,
} from "react";

interface User {
  id: number;
  username: string;
}

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  login: (user: string, pass: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (token && storedUser) {
      setIsLoggedIn(true);
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const authValue = useMemo(
    () => ({
      isLoggedIn,
      user,
      login: async (username: string, password: string) => {
        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
          });

          if (response.ok) {
            const data = await response.json();
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            setIsLoggedIn(true);
            setUser(data.user);

            return true;
          } else {
            return false;
          }
        } catch (error) {
          console.error('Login error:', error);
          return false;
        }
      },
      logout: () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setIsLoggedIn(false);
        setUser(null);
      },
    }),
    [isLoggedIn, user]
  );

  return (
    <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
