const toast = document.querySelector('#toast');
let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

const authButton = document.querySelector('#authButton');
const authDialog = document.querySelector('#authDialog');
const authForm = document.querySelector('#authForm');
const authTitle = document.querySelector('#authTitle');
const authSubmit = document.querySelector('#authSubmit');
const authToggle = document.querySelector('#authToggle');
const authError = document.querySelector('#authError');
let registerMode = false;
const guildSelect = document.querySelector('#guildSelect');
const shortcutList = document.querySelector('#shortcutList');
const shortcutForm = document.querySelector('#shortcutForm');
let selectedGuild = '';
const commandNames = { invite: 'تقرير الدعوات', clear: 'مسح الرسائل', kick: 'طرد', ban: 'حظر', timeout: 'تايم أوت', untimeout: 'إزالة التايم أوت', lock: 'قفل الشات', unlock: 'فتح الشات', slowmode: 'السلو مود', warn: 'تحذير', role: 'إدارة الرتب' };
const commandSettings = document.querySelector('#commandSettings');
const loadSettings = async () => {
  if (!selectedGuild) return;
  const response = await fetch(`/api/settings?guild_id=${selectedGuild}`);
  const { settings } = await response.json();
  document.querySelector('#activityText').value = settings.activity?.text || '';
  document.querySelector('#activityType').value = settings.activity?.type || 'Watching';
  commandSettings.innerHTML = Object.entries(commandNames).map(([name, label]) => `<label><input type="checkbox" data-command="${name}" ${settings.enabledCommands?.[name] === false ? '' : 'checked'}> ${label}</label>`).join('');
};
const loadShortcuts = async () => {
  if (!selectedGuild) return;
  const response = await fetch(`/api/shortcuts?guild_id=${selectedGuild}`);
  const data = await response.json();
  shortcutList.innerHTML = Object.entries(data.shortcuts || {}).map(([name, command]) => `<div class="ticket-row"><strong>!${name}</strong><small>ينفذ /${command}</small><button type="button" data-remove-shortcut="${name}">حذف</button></div>`).join('') || '<small>لا توجد اختصارات بعد.</small>';
  shortcutList.querySelectorAll('[data-remove-shortcut]').forEach((button) => button.addEventListener('click', async () => {
    await fetch('/api/shortcuts', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guildId: selectedGuild, name: button.dataset.removeShortcut }) });
    await loadShortcuts();
  }));
};
authButton.addEventListener('click', () => { if (window.authenticated) window.location.href = '/auth/logout'; else authDialog.showModal(); });
authToggle.addEventListener('click', () => { registerMode = !registerMode; authTitle.textContent = registerMode ? 'إنشاء حساب' : 'تسجيل الدخول'; authSubmit.textContent = registerMode ? 'إنشاء الحساب' : 'دخول'; authToggle.textContent = registerMode ? 'لدي حساب بالفعل' : 'إنشاء حساب جديد'; });
authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.textContent = '';
  const response = await fetch(registerMode ? '/auth/register' : '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: accountUsername.value, password: accountPassword.value }) });
  const result = await response.json();
  if (!response.ok) return void (authError.textContent = result.error);
  authDialog.close();
  window.location.reload();
});
fetch('/api/me').then((response) => response.json()).then(async ({ authenticated, user }) => {
  window.authenticated = authenticated;
  if (authenticated) {
    authButton.textContent = `${user.username} · تسجيل الخروج`;
    document.querySelector('.avatar')?.remove();
    showToast(`مرحبًا ${user.username}`);
    return fetch('/api/guilds').then((response) => response.json()).then(async ({ guilds }) => {
      guildSelect.innerHTML = guilds.map((guild) => `<option value="${guild.id}">${guild.name}</option>`).join('') || '<option value="">لا توجد سيرفرات قابلة للإدارة</option>';
      selectedGuild = guilds[0]?.id || '';
      await loadShortcuts();
      return loadSettings();
    });
  }
}).catch(() => {});
guildSelect.addEventListener('change', () => { selectedGuild = guildSelect.value; loadShortcuts().catch(() => {}); loadSettings().catch(() => {}); });
document.querySelector('#saveSettings').addEventListener('click', async () => {
  if (!requireLogin() || !selectedGuild) return;
  const enabledCommands = Object.fromEntries([...commandSettings.querySelectorAll('[data-command]')].map((input) => [input.dataset.command, input.checked]));
  const response = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guildId: selectedGuild, settings: { enabledCommands, activity: { text: document.querySelector('#activityText').value, type: document.querySelector('#activityType').value } } }) });
  showToast(response.ok ? 'تم حفظ إعدادات الأوامر.' : 'تعذر حفظ إعدادات الأوامر.');
});
shortcutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!requireLogin() || !selectedGuild) return;
  const response = await fetch('/api/shortcuts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guildId: selectedGuild, name: document.querySelector('#shortcutName').value, command: document.querySelector('#shortcutCommand').value }) });
  const result = await response.json();
  if (!response.ok) return showToast(result.error || 'تعذر الحفظ');
  event.target.reset();
  await loadShortcuts();
  showToast('تمت إضافة الاختصار إلى البوت.');
});
const requireLogin = () => {
  if (window.authenticated) return true;
  showToast('سجّل دخولك بحساب Lumera أولًا للتحكم.');
  return false;
};
document.querySelector('#customize').addEventListener('click', () => { if (requireLogin()) document.querySelector('#commands').scrollIntoView({ behavior: 'smooth' }); });
document.querySelector('.notice button').addEventListener('click', (event) => event.currentTarget.closest('.notice').remove());
document.querySelectorAll('.nav a').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('.nav a').forEach((item) => item.classList.remove('active'));
  link.classList.add('active');
}));