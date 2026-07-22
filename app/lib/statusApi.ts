export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3099";

export interface Patient {
  id: number;
  name: string;
  created_at?: string;
}

// ===== Patients =====
export async function fetchPatients(): Promise<Patient[]> {
  const r = await fetch(`${API_BASE}/api/patients`, { cache: "no-store" });
  if (!r.ok) throw new Error("failed to load patients");
  return r.json();
}

export async function savePatient(patient: { id?: number; name: string }) {
  const r = await fetch(`${API_BASE}/api/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patient),
  });
  if (!r.ok) throw new Error("failed to save patient");
  return r.json();
}

export async function deletePatient(id: number) {
  const r = await fetch(`${API_BASE}/api/patients/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error("failed to delete patient");
  return r.json();
}

// ===== Status fields (master data) =====
export async function fetchStatusFields(screenKey: string) {
  const r = await fetch(`${API_BASE}/api/status-fields?screen_key=${encodeURIComponent(screenKey)}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("failed to load fields");
  return r.json();
}

export async function saveStatusField(field: any) {
  const r = await fetch(`${API_BASE}/api/status-fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(field),
  });
  if (!r.ok) throw new Error("failed to save field");
  return r.json();
}

export async function deleteStatusField(screen_key: string, field_key: string) {
  const r = await fetch(`${API_BASE}/api/status-fields/${screen_key}/${field_key}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error("failed to delete field");
  return r.json();
}

// ===== Status records (captured values) =====
export async function saveStatusRecord(params: {
  screen_key: string;
  patient_id: number;
  record_date?: string; // 'YYYY-MM-DD'
  record_year_month?: string; // 'YYYY-MM'
  values: Record<string, any>;
}) {
  const r = await fetch(`${API_BASE}/api/status-records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!r.ok) throw new Error("failed to save record");
  return r.json();
}

export async function fetchStatusRecords(params: {
  screen_key?: string;
  patient_id?: number;
  from?: string;
  to?: string;
  record_year_month?: string;
}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") search.append(k, String(v));
  });
  const r = await fetch(`${API_BASE}/api/status-records?${search.toString()}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("failed to load records");
  return r.json();
}

// ===== Report =====
export async function fetchPatientReport(patientId: number, yearMonth: string) {
  const r = await fetch(
    `${API_BASE}/api/status-report?patient_id=${patientId}&year_month=${encodeURIComponent(yearMonth)}`,
    { cache: "no-store" }
  );
  if (!r.ok) throw new Error("failed to load report");
  return r.json();
}
