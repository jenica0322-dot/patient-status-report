// app/context/PatientContext.tsx
// Tracks which patient is currently selected. Every capture/report screen
// is scoped to this patient - selecting one is the entry point of the app.

"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useMemo,
  useEffect,
} from "react";
import { Patient } from "../lib/statusApi";

interface PatientContextType {
  selectedPatient: Patient | null;
  selectPatient: (patient: Patient) => void;
  clearPatient: () => void;
}

const PatientContext = createContext<PatientContextType | undefined>(undefined);

export function PatientProvider({ children }: { children: ReactNode }) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('selectedPatient');
    if (stored) {
      try {
        setSelectedPatient(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const value = useMemo(
    () => ({
      selectedPatient,
      selectPatient: (patient: Patient) => {
        setSelectedPatient(patient);
        localStorage.setItem('selectedPatient', JSON.stringify(patient));
      },
      clearPatient: () => {
        setSelectedPatient(null);
        localStorage.removeItem('selectedPatient');
      },
    }),
    [selectedPatient]
  );

  return (
    <PatientContext.Provider value={value}>{children}</PatientContext.Provider>
  );
}

export function usePatient() {
  const context = useContext(PatientContext);
  if (!context) {
    throw new Error("usePatient must be used within a PatientProvider");
  }
  return context;
}
