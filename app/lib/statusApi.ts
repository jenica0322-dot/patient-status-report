// Same-origin: Express serves Next + /api/* on one port (dev and prod).
export const API_BASE = "";

/** Patient picker row. id === mst_customer.pat_id when using external source. */
export interface Patient {
  id: number;
  name: string;
  created_at?: string | null;
  pat_id?: number | string;
  claim_pat_id?: number | string | null;
  corporation_flag?: number | string | null;
  corporation_id?: number | string | null;
  display_order_number?: number | string | null;
  customer_name?: string | null;
  customer_kana?: string | null;
  customer_sex?: string | null;
  customer_birthday?: string | null;
  customer_zip_code1?: string | null;
  customer_zip_code2?: string | null;
  customer_tel?: string | null;
  customer_address1?: string | null;
  customer_address2?: string | null;
  belong_area?: string | null;
  belong_area_name?: string | null;
  product_kind_code?: string | null;
}

export interface PatientArea {
  code: string;
  name: string;
}

export interface PatientsPage {
  items: Patient[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type FetchPatientsParams = {
  page?: number;
  limit?: number;
  q?: string;
  belong_area?: string;
};

// ===== Patients (read-only from mst_customer when PATIENTS_DB_SOURCE=users) =====
export async function fetchPatients(params: FetchPatientsParams = {}): Promise<PatientsPage> {
  const search = new URLSearchParams();
  if (params.page != null) search.set("page", String(params.page));
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.q) search.set("q", params.q);
  if (params.belong_area) search.set("belong_area", params.belong_area);
  const qs = search.toString();
  const r = await fetch(`${API_BASE}/api/patients${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("failed to load patients");
  return r.json();
}

export async function fetchPatientAreas(): Promise<PatientArea[]> {
  const r = await fetch(`${API_BASE}/api/patients/areas`, { cache: "no-store" });
  if (!r.ok) throw new Error("failed to load areas");
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

// ===== Status records (captured values) — patient_id stores pat_id =====
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

export function patientReportExportUrl(patientId: number, yearMonth: string) {
  return `${API_BASE}/api/status-report/export?patient_id=${patientId}&year_month=${encodeURIComponent(yearMonth)}`;
}

// ===== Report =====
export async function fetchPatientReport(patientId: number, yearMonth: string) {
  const r = await fetch(
    `${API_BASE}/api/status-report?patient_id=${patientId}&year_month=${encodeURIComponent(yearMonth)}`,
    { cache: "no-store" }
  );
  if (!r.ok) {
    let detail = "";
    try {
      const body = await r.json();
      detail = body?.detail || body?.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(
      detail
        ? `failed to load report (${r.status}): ${detail}`
        : `failed to load report (${r.status})`
    );
  }
  return r.json();
}
