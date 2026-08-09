const API_BASE = '/api';

const Api = {
  token: localStorage.getItem('erp_token') || null,
  setToken(t) { this.token = t; if (t) localStorage.setItem('erp_token', t); else localStorage.removeItem('erp_token'); },
  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(API_BASE + path, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      this.setToken(null);
      showLogin();
      throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'حدث خطأ غير متوقع');
    return data;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};

function money(n) { return (Number(n) || 0).toFixed(2) + ' ر.س'; }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; }
function todayISO(d) { const x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
